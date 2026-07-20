import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadCandleStore, type CandleStore } from '@/backtest';
import { parseBhavcopy } from '@/delivery/bhavcopy';
import { bucketByRank, surgeAsOf, volumeSurgeAsOf, type DeliveryPoint } from '@/delivery/metrics';
import { cellStats, HORIZONS, type Horizon } from '@/events/eventStudy';
import { byCanonicalSymbol } from '@/universe/symbols';
import { prisma } from '@services/prisma';

/**
 * B13 — Delivery % study. Read-only.
 *
 *   bun run delivery:study [horizon] [--dir .cache/bhavcopy]
 *
 * Delivery % is the one number a price feed cannot give: the share of volume
 * that actually settled as delivery rather than being squared off intraday. It
 * is the best free proxy for institutional accumulation, and the architecture
 * review ranked it the highest alpha-per-effort source we had not touched.
 *
 * Unlike sentiment, it is **backtestable today** — the NSE archive serves files
 * back past 2021, covering the whole candle window.
 *
 * Design (the fair test):
 *  - Buckets are CROSS-SECTIONAL PER DAY (deciles across the universe on each
 *    date), so a decile spread cannot be a rising-tide artifact.
 *  - Three signals measured side by side: the raw LEVEL (the control — mostly
 *    structural), the SURGE vs the stock's own 20d baseline (the accumulation
 *    hypothesis), and surge conditioned on volume also rising (a delivery % can
 *    rise merely because volume collapsed).
 *  - Reports mean / CI / hit rate / **p90** per decile. p90 is the statistic:
 *    B11 and B12 both found levers that trim the left tail and nothing that
 *    finds large winners, which is what a 2R/3R target structure needs.
 */

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
const padE = (s: string | number, w: number) => String(s).padEnd(w);
const pad = (s: string | number, w: number) => String(s).padStart(w);

type Obs = { symbol: string; date: string; level: number; surge: number | null; volSurge: number | null };

const run = async () => {
  const horizonArg = Number(process.argv[2] ?? 5) as Horizon;
  const horizon: Horizon = (HORIZONS as readonly number[]).includes(horizonArg) ? horizonArg : 5;
  const dirIdx = process.argv.indexOf('--dir');
  const dir = dirIdx >= 0 ? process.argv[dirIdx + 1]! : '.cache/bhavcopy';

  console.log('Loading candles…');
  const store: CandleStore = await loadCandleStore();
  const benchByDate = new Map((store.benchmark ?? []).map((c) => [c.tradeDate, c.close]));
  const { map: instBySymbol } = byCanonicalSymbol(store.instruments, (i) => i.symbol);
  const closesBySymbol = new Map<string, Map<string, number>>();
  const datesBySymbol = new Map<string, string[]>();
  for (const [sym, inst] of instBySymbol) {
    const series = store.seriesById.get(inst.id) ?? [];
    closesBySymbol.set(sym, new Map(series.map((c) => [c.tradeDate, c.close])));
    datesBySymbol.set(sym, series.map((c) => c.tradeDate));
  }
  const universe = new Set(instBySymbol.keys());
  console.log(`Universe ${universe.size} · benchmark ${benchByDate.size} days.`);

  // ── Load the cached bhavcopy archive into per-symbol delivery series.
  const files = readdirSync(dir).filter((f) => f.endsWith('.csv')).sort();
  console.log(`Reading ${files.length} cached bhavcopy files from ${dir}…`);
  const bySymbol = new Map<string, DeliveryPoint[]>();
  let parsedRows = 0;
  for (const f of files) {
    const { rows } = parseBhavcopy(readFileSync(join(dir, f), 'utf8'));
    for (const r of rows) {
      if (!universe.has(r.symbol)) continue;
      parsedRows++;
      (bySymbol.get(r.symbol) ?? bySymbol.set(r.symbol, []).get(r.symbol)!).push({
        tradeDate: r.tradeDate,
        deliveryPct: r.deliveryPct,
        tradedQty: r.tradedQty,
      });
    }
  }
  for (const s of bySymbol.values()) s.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  console.log(`${parsedRows} universe delivery rows across ${bySymbol.size} symbols.`);
  if (bySymbol.size === 0) {
    console.error('\n  ❌ No universe symbols matched the bhavcopy archive — JOIN FAILURE, not a finding.');
    process.exitCode = 1;
    return;
  }

  // ── Build per-day observations (level, surge, volume surge).
  const byDate = new Map<string, Obs[]>();
  for (const [symbol, series] of bySymbol) {
    for (let i = 0; i < series.length; i++) {
      const p = series[i]!;
      const obs: Obs = {
        symbol,
        date: p.tradeDate,
        level: p.deliveryPct,
        surge: surgeAsOf(series, i, 20),
        volSurge: volumeSurgeAsOf(series, i, 20),
      };
      (byDate.get(p.tradeDate) ?? byDate.set(p.tradeDate, []).get(p.tradeDate)!).push(obs);
    }
  }

  /** Forward excess vs benchmark from the day AFTER the observation date. */
  const forwardExcess = (symbol: string, date: string, h: number): number | null => {
    const dates = datesBySymbol.get(symbol);
    const closes = closesBySymbol.get(symbol);
    if (!dates || !closes) return null;
    const i = dates.indexOf(date);
    // Signal known at date's close → entry at the next bar, same as the simulator.
    if (i < 0 || i + 1 + h >= dates.length) return null;
    const d0 = dates[i + 1]!;
    const d1 = dates[i + 1 + h]!;
    const c0 = closes.get(d0);
    const c1 = closes.get(d1);
    const b0 = benchByDate.get(d0);
    const b1 = benchByDate.get(d1);
    if (c0 == null || c1 == null || b0 == null || b1 == null || c0 <= 0 || b0 <= 0) return null;
    return (c1 / c0 - 1) * 100 - (b1 / b0 - 1) * 100;
  };

  /** Cross-sectional decile study for one signal. */
  const decileStudy = (
    label: string,
    valueOf: (o: Obs) => number | null,
    filter: (o: Obs) => boolean = () => true,
  ) => {
    const buckets = new Map<number, number[]>();
    for (const [date, obsAll] of byDate) {
      const obs = obsAll.filter((o) => filter(o) && valueOf(o) != null);
      if (obs.length < 30) continue; // too thin a cross-section to rank meaningfully
      const b = bucketByRank(obs, (o) => valueOf(o)!, 10);
      for (const o of obs) {
        const ex = forwardExcess(o.symbol, date, horizon);
        if (ex == null) continue;
        const d = b.get(o)!;
        (buckets.get(d) ?? buckets.set(d, []).get(d)!).push(ex);
      }
    }
    console.log(`\n=== ${label} · decile vs ${horizon}-day forward excess (cross-sectional per day) ===`);
    console.log(
      `  ${padE('decile', 8)} ${pad('n', 8)} ${pad('mean', 8)} ${pad('CI low', 8)} ${pad('CI high', 8)} ` +
        `${pad('hit%', 6)} ${pad('p90', 8)} ${pad('p10', 8)}`,
    );
    const stats: { d: number; mean: number; p90: number }[] = [];
    for (let d = 0; d < 10; d++) {
      const s = cellStats(buckets.get(d) ?? []);
      if (s.n === 0) continue;
      stats.push({ d, mean: s.meanExcess, p90: s.p90 });
      console.log(
        `  ${padE(`D${d + 1}${d === 0 ? ' (lo)' : d === 9 ? ' (hi)' : ''}`, 8)} ${pad(s.n, 8)} ${pad(pct(s.meanExcess), 8)} ` +
          `${pad(pct(s.ci95[0]), 8)} ${pad(pct(s.ci95[1]), 8)} ${pad(s.hitRatePct.toFixed(1), 6)} ` +
          `${pad(pct(s.p90), 8)} ${pad(pct(s.p10), 8)}`,
      );
    }
    if (stats.length >= 2) {
      const lo = stats[0]!;
      const hi = stats[stats.length - 1]!;
      console.log(
        `  → D10−D1 spread: mean ${pct(hi.mean - lo.mean)} · p90 ${pct(hi.p90 - lo.p90)}` +
          `   ${Math.abs(hi.mean - lo.mean) < 0.05 ? '(flat — no signal)' : ''}`,
      );
    }
  };

  decileStudy('1. DELIVERY LEVEL (control — largely structural)', (o) => o.level);
  decileStudy('2. DELIVERY SURGE vs own 20d baseline (the accumulation hypothesis)', (o) => o.surge);
  decileStudy(
    '3. DELIVERY SURGE, volume ALSO rising (surge > 1 is not accumulation on collapsing volume)',
    (o) => o.surge,
    (o) => (o.volSurge ?? 0) > 1,
  );

  console.log(
    `\n  ⚠️ Cross-sectional deciles per day, so a spread cannot be a rising-tide artifact.` +
      `\n     Entry is the NEXT bar after the observation date (bhavcopy publishes post-close),` +
      `\n     matching the simulator. Study only — no gate, sizing or costs; a promising decile` +
      `\n     is a hypothesis for the factor pipeline, not a result, and must clear the anchored` +
      `\n     walk-forward + portfolio gate. Survivorship (today's universe) applies.`,
  );
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

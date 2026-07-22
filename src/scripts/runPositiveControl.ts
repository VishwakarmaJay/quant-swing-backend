import { loadCandleStore } from '@/backtest';
import { HORIZONS, type Horizon } from '@/research/forwardLabels';
import { buildControlPanel, momentum12_1, reversal5d } from '@/research/positiveControl';
import { decileSpread, monotonicity, quantileSpread } from '@/research/quantiles';
import { rankIC } from '@/research/rankIC';
import { r, writeCsv } from '@/research/report';
import type { PanelRow } from '@/research/panelBuilder';
import { prisma } from '@services/prisma';

/**
 * Gate B — positive control (research layer, Task 6). Read-only.
 *   bun run research:control
 *
 * Runs 12-1 momentum (and, as a diagnostic fallback, 5-day reversal) through the
 * SAME rankIC + quantile harness the master measurement uses, on the full window.
 * Momentum is expected to show positive mean rank IC with broadly monotone
 * deciles. A soft failure is diagnostic, not a bug.
 */

const OUT = 'research-output';

const runSignal = (panel: PanelRow[], key: string) => {
  const icRows: (string | number)[][] = [];
  const decileRows: (string | number)[][] = [];
  const summary: { h: Horizon; meanIC: number; nwT: number; spreadEW: number | null; monoEW: number }[] = [];

  for (const h of HORIZONS) {
    const labelOf = (row: PanelRow) => row.fwd?.[h];
    const scoreOf = (row: PanelRow) => row.scores[key];
    const ic = rankIC(panel, scoreOf, labelOf, { minObs: 10, neweyWestLags: h });
    icRows.push([key, h, r(ic.meanIC), r(ic.stdIC), r(ic.icIR), r(ic.tStat), r(ic.neweyWestTStat), ic.nDates]);

    for (const weighting of ['EW', 'VW'] as const) {
      const cells = quantileSpread(panel, scoreOf, labelOf, weighting, { nDeciles: 10, minObs: 10 });
      for (const c of cells) decileRows.push([key, h, weighting, c.decile, c.nObs, r(c.meanRet, 4), r(c.medianRet, 4)]);
      if (weighting === 'EW') {
        summary.push({ h, meanIC: ic.meanIC, nwT: ic.neweyWestTStat, spreadEW: decileSpread(cells), monoEW: monotonicity(cells) });
      }
    }
  }
  return { icRows, decileRows, summary };
};

const run = async () => {
  console.log('Loading candle store…');
  const store = await loadCandleStore();
  console.log(`Universe ${store.instruments.length} · ${store.tradingDates.length} trading days.`);

  console.log('Building 12-1 momentum control panel…');
  const mom = buildControlPanel(store, momentum12_1, 'momentum_12_1');
  const momOut = runSignal(mom, 'momentum_12_1');

  console.log('Building 5-day reversal control panel…');
  const rev = buildControlPanel(store, reversal5d, 'reversal_5d');
  const revOut = runSignal(rev, 'reversal_5d');

  writeCsv(
    `${OUT}/positive_control.csv`,
    ['subject', 'horizon', 'meanIC', 'stdIC', 'icIR', 'tStat', 'neweyWestTStat', 'nDates'],
    [...momOut.icRows, ...revOut.icRows],
  );
  writeCsv(
    `${OUT}/positive_control_deciles.csv`,
    ['subject', 'horizon', 'weighting', 'decile', 'nObs', 'meanRet', 'medianRet'],
    [...momOut.decileRows, ...revOut.decileRows],
  );

  console.log('\n=== GATE B — 12-1 momentum (EW) ===');
  console.log('  horizon  meanIC   NW-t    D10−D1   monotone%');
  for (const s of momOut.summary) {
    console.log(
      `  ${String(s.h).padStart(5)}  ${s.meanIC.toFixed(4).padStart(8)} ${s.nwT.toFixed(2).padStart(6)}  ` +
        `${(s.spreadEW ?? NaN).toFixed(3).padStart(7)}   ${(s.monoEW * 100).toFixed(0).padStart(4)}%`,
    );
  }
  console.log('\n=== 5-day reversal (EW) — fallback control (expect NEGATIVE IC at h=1) ===');
  for (const s of revOut.summary) {
    console.log(
      `  ${String(s.h).padStart(5)}  ${s.meanIC.toFixed(4).padStart(8)} ${s.nwT.toFixed(2).padStart(6)}  ` +
        `${(s.spreadEW ?? NaN).toFixed(3).padStart(7)}   ${(s.monoEW * 100).toFixed(0).padStart(4)}%`,
    );
  }

  const momPos = momOut.summary.some((s) => s.meanIC > 0.01 && s.nwT > 2);
  const revNeg = revOut.summary.find((s) => s.h === 1)?.meanIC ?? 0;
  console.log('\n--- Gate B verdict ---');
  console.log(`  momentum shows positive IC: ${momPos ? 'YES' : 'NO'}`);
  console.log(`  reversal h=1 IC (expect <0): ${revNeg.toFixed(4)}`);
  console.log(momPos ? '  ✅ Gate B PASS (momentum control recovered)' : '  ⚠️ momentum weak — inspect reversal & escalate if both fail');
  console.log(`\nWrote ${OUT}/positive_control.csv and ${OUT}/positive_control_deciles.csv`);
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

import { loadCandleStore } from '@/backtest';
import { buildForwardLabels, HORIZONS, type Horizon } from '@/research/forwardLabels';
import { buildFactorPanel, joinLabels, COMPOSITE_KEY, type PanelRow } from '@/research/panelBuilder';
import { decileSpread, monotonicity, quantileSpread, type Weighting } from '@/research/quantiles';
import { dailyICSeries, rankIC } from '@/research/rankIC';
import { r, writeCsv } from '@/research/report';
import { residualizeLabels } from '@/research/residualize';
import { blockBootstrapCI, mean } from '@/research/statistics';
import { prisma } from '@services/prisma';
import { writeFileSync } from 'node:fs';

/**
 * Task 8 — the master measurement (research layer). Read-only.
 *   bun run research:measure
 *
 * Cross-sectional rank IC + EW/VW decile spreads for the composite and all 8
 * factors, over label variants {fwd, xs, resid}, horizons {1,3,5,10,21,63},
 * and splits {ALL, BULL, BEAR, SIDEWAYS, HIGH_VOL}. Rank IC is UNWEIGHTED (a
 * Spearman correlation); the weighting dimension is meaningful only for the
 * quantile spreads, so IC rows are emitted once under weighting='EW'.
 *
 * DAY CONVENTION — trading days; next-bar entry; overlapping horizons ⇒
 * Newey-West lags set to the horizon. resid = raw fwd residualised on
 * [beta, sector dummies, log-ADV].
 */

const OUT = 'research-output';
const SUBJECTS = [
  'trend',
  'momentum',
  'relativeStrength',
  'sectorRelativeStrength',
  'volume',
  'volatility',
  'fundamental',
  'sentiment',
  COMPOSITE_KEY,
] as const;
const LABEL_TYPES = ['fwd', 'xs', 'resid'] as const;
const REGIMES = ['ALL', 'BULL', 'BEAR', 'SIDEWAYS', 'HIGH_VOL'] as const;
const IC_MIN_OBS = 10;
const Q_MIN_OBS = 20;

type LabelType = (typeof LABEL_TYPES)[number];
const labelAccessor = (lt: LabelType, h: Horizon) => (row: PanelRow) => {
  const m = lt === 'fwd' ? row.fwd : lt === 'xs' ? row.xs : row.resid;
  return m?.[h];
};

const run = async () => {
  const t0 = Date.now();
  console.log('Loading candle store…');
  const store = await loadCandleStore();
  console.log(`Universe ${store.instruments.length} · ${store.tradingDates.length} trading days.`);

  console.log('Building full factor panel (heavy)…');
  const panel = buildFactorPanel(store);
  console.log(`Panel rows: ${panel.length}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  console.log('Joining forward labels…');
  joinLabels(panel, buildForwardLabels(store));

  console.log('Residualising fwd per horizon…');
  for (const h of HORIZONS) residualizeLabels(panel, store, h);

  // Precompute regime subsets once.
  const subsets: Record<string, PanelRow[]> = { ALL: panel };
  for (const rg of REGIMES) if (rg !== 'ALL') subsets[rg] = panel.filter((row) => row.regime === rg);

  const icRows: (string | number)[][] = [];
  const qRows: (string | number)[][] = [];
  const flagged: { subject: string; labelType: string; horizon: number; meanIC: number; nwT: number; monoEW: number; monoVW: number; ciLow: number; ciHigh: number }[] = [];

  console.log('Computing IC + quantiles…');
  for (const subject of SUBJECTS) {
    const scoreOf = (row: PanelRow) => row.scores[subject];
    for (const lt of LABEL_TYPES) {
      for (const rg of REGIMES) {
        const subset = subsets[rg]!;
        for (const h of HORIZONS) {
          const labelOf = labelAccessor(lt, h);
          const ic = rankIC(subset, scoreOf, labelOf, { minObs: IC_MIN_OBS, neweyWestLags: h });
          icRows.push([subject, lt, h, 'EW', rg, r(ic.meanIC), r(ic.stdIC), r(ic.icIR), r(ic.tStat), r(ic.neweyWestTStat), ic.nDates]);

          const cellsByW: Record<Weighting, ReturnType<typeof quantileSpread>> = { EW: [], VW: [] };
          for (const w of ['EW', 'VW'] as Weighting[]) {
            const cells = quantileSpread(subset, scoreOf, labelOf, w, { nDeciles: 10, minObs: Q_MIN_OBS });
            cellsByW[w] = cells;
            for (const c of cells) qRows.push([subject, lt, h, w, rg, c.decile, c.nObs, r(c.meanRet, 4), r(c.medianRet, 4)]);
          }

          // Summary bar (evaluated on ALL-dates): meanIC ≥ 0.02 AND NW-t ≥ 3.0.
          if (rg === 'ALL' && ic.meanIC >= 0.02 && ic.neweyWestTStat >= 3.0) {
            const ics = dailyICSeries(subset, scoreOf, labelOf, IC_MIN_OBS).map((d) => d.ic);
            const ci = blockBootstrapCI(ics, mean, { block: Math.max(20, h), reps: 5000, seed: 7 });
            flagged.push({
              subject,
              labelType: lt,
              horizon: h,
              meanIC: ic.meanIC,
              nwT: ic.neweyWestTStat,
              monoEW: monotonicity(cellsByW.EW),
              monoVW: monotonicity(cellsByW.VW),
              ciLow: ci.ciLow,
              ciHigh: ci.ciHigh,
            });
          }
        }
      }
    }
    console.log(`  ${subject} done (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }

  writeCsv(
    `${OUT}/rank_ic.csv`,
    ['subject', 'labelType', 'horizon', 'weighting', 'regime', 'meanIC', 'stdIC', 'icIR', 'tStat', 'neweyWestTStat', 'nDates'],
    icRows,
  );
  writeCsv(
    `${OUT}/quantile_spread.csv`,
    ['subject', 'labelType', 'horizon', 'weighting', 'regime', 'decile', 'nObs', 'meanRet', 'medianRet'],
    qRows,
  );

  // measurement_summary.md
  const lines: string[] = [];
  lines.push('# Task 8 — Measurement Summary\n');
  lines.push(`Full window: ${store.tradingDates[0]} → ${store.tradingDates.at(-1)} · universe ${store.instruments.length} · panel rows ${panel.length}.\n`);
  lines.push('Rank IC is unweighted (Spearman). Bar: `meanIC ≥ 0.02 AND neweyWestTStat ≥ 3.0` on ALL-dates. Newey-West lags = horizon.\n');
  lines.push('## Cells clearing the bar\n');
  if (flagged.length === 0) {
    lines.push('**None.** No `(subject, labelType, horizon)` cleared `meanIC ≥ 0.02 AND NW-t ≥ 3.0` in any variant.\n');
  } else {
    lines.push('| subject | label | h | meanIC | NW-t | mono EW | mono VW | IC 95% CI |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const f of flagged.sort((a, b) => b.nwT - a.nwT)) {
      lines.push(
        `| ${f.subject} | ${f.labelType} | ${f.horizon} | ${f.meanIC.toFixed(4)} | ${f.nwT.toFixed(2)} | ` +
          `${(f.monoEW * 100).toFixed(0)}% | ${(f.monoVW * 100).toFixed(0)}% | [${f.ciLow.toFixed(4)}, ${f.ciHigh.toFixed(4)}] |`,
      );
    }
    lines.push('');
  }
  lines.push('## Interpretation rule\n');
  lines.push('- Nothing clears the bar in any variant → the features contain **no cross-sectional predictive information**.');
  lines.push('- Anything clears in **both EW and VW on residualised returns** (mono high, CI excludes 0) → **signal exists**, proceed to Task 9.');
  lines.push('- A cell that clears only in `fwd`/`xs` but collapses under `resid`/VW is likely a beta or size artifact, not alpha.\n');
  writeFileSync(`${OUT}/measurement_summary.md`, lines.join('\n'), 'utf8');

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)}s.`);
  console.log(`IC rows ${icRows.length} · quantile rows ${qRows.length} · flagged ${flagged.length}.`);
  console.log(`Wrote ${OUT}/rank_ic.csv, ${OUT}/quantile_spread.csv, ${OUT}/measurement_summary.md`);
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

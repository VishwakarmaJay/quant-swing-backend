import dayjs from 'dayjs';

import {
  buildFeatureBundle,
  buildStockContext,
  factors,
  loadBenchmarkCandles,
  loadSectorPeerReturns,
} from '@/factors';
import {
  PortfolioManager,
  portfolioConfigFromEnv,
  type ApprovedSignal,
  type PortfolioCandidate,
} from '@/portfolio';
import { detectMarketRegime, type MarketRegime } from '@/regime';
import { computeSignalLevels, type SignalMathConfig } from '@/signal';
import { createProductionStrategy } from '@/strategy';
import { prisma } from '@services/prisma';

import { computeRunVersions, type RunVersions } from './versions';

export type PipelineRejection = {
  instrumentId: string;
  symbol: string;
  /** strategy | signal-math | portfolio */
  stage: string;
  reason: string;
  detail: string;
};

export type PipelineSignal = ApprovedSignal & { instrumentId: string };

export type PipelineRun = {
  runId: string;
  asOf: string;
  regime: MarketRegime;
  regimeDetail: string;
  approved: PipelineSignal[];
  rejections: PipelineRejection[];
  versions: RunVersions;
};

/**
 * Runs the full decision pipeline over the equity universe as of `asOf`:
 * regime → factors → WeightedStrategy → signal math → PortfolioManager. Pure of
 * side effects except DB reads — persistence is a separate step. Every dropped
 * candidate is captured with the stage + reason it fell out.
 */
export const runPipeline = async (
  asOf: Date = new Date(),
  opts?: { vix?: number | null; signalConfig?: SignalMathConfig },
): Promise<PipelineRun> => {
  const runId = crypto.randomUUID();
  const asOfIso = dayjs(asOf).format('YYYY-MM-DD');

  const regime = await detectMarketRegime(asOf, { vix: opts?.vix ?? null });
  const benchmarkCandles = await loadBenchmarkCandles(asOf);
  const sectorPeerReturns = await loadSectorPeerReturns(asOf);
  // ROADMAP B2: the graduated production strategy — OOS-validated combined config
  // (SRS composite weight 0.25 + BULL pullback+resumption entry), not the baseline.
  const strategy = createProductionStrategy();

  const instruments = await prisma.instrument.findMany({
    where: { instrumentType: 'EQ' },
    orderBy: { name: 'asc' },
  });

  const rejections: PipelineRejection[] = [];
  const candidates: PortfolioCandidate[] = [];
  const instrumentIdBySymbol = new Map<string, string>();

  for (const inst of instruments) {
    const symbol = inst.symbol.replace(/-EQ$/, '');
    instrumentIdBySymbol.set(symbol, inst.id);

    const ctx = await buildStockContext(inst.id, asOf, { benchmarkCandles, sectorPeerReturns });
    if (!ctx) continue;

    const bundle = buildFeatureBundle(ctx, factors);
    const strat = strategy.evaluate(bundle, regime.regime);
    if (!strat.passed) {
      rejections.push({
        instrumentId: inst.id,
        symbol,
        stage: 'strategy',
        reason: strat.rejectionReason ?? 'unknown',
        detail: strat.explanations[0] ?? '',
      });
      continue;
    }

    const math = computeSignalLevels(ctx.candles, opts?.signalConfig);
    if (!math.ok) {
      rejections.push({ instrumentId: inst.id, symbol, stage: 'signal-math', reason: math.reason, detail: math.detail });
      continue;
    }

    candidates.push({
      symbol,
      sector: inst.sector,
      regime: regime.regime,
      compositeScore: strat.compositeScore,
      agreementScore: strat.agreementScore,
      levels: math,
    });
  }

  const pm = new PortfolioManager(portfolioConfigFromEnv());
  const decision = pm.manage(candidates);
  for (const r of decision.rejected) {
    rejections.push({
      instrumentId: instrumentIdBySymbol.get(r.symbol) ?? '',
      symbol: r.symbol,
      stage: 'portfolio',
      reason: r.reason,
      detail: r.detail,
    });
  }

  const approved: PipelineSignal[] = decision.approved.map((a) => ({
    ...a,
    instrumentId: instrumentIdBySymbol.get(a.symbol) ?? '',
  }));

  return {
    runId,
    asOf: asOfIso,
    regime: regime.regime,
    regimeDetail: regime.explanations[0] ?? '',
    approved,
    rejections,
    versions: await computeRunVersions(),
  };
};

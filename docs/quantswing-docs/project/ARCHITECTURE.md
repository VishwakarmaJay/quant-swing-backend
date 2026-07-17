# Architecture

**Status: FROZEN (spec v2.0 §1–§32).** Changes only via research protocol evidence.

## Pipeline (definitive)
```
Providers (Angel One · NSE/BSE XML · Screener.in · RSS)
   ↓
DataQualityService → Normalized StockContext
   ↓
Feature Extraction (Factors) → FeatureBundle (immutable record)
   ↓
Strategy → TradeCandidate
   ↓
PortfolioManager → ApprovedSignal | Rejection(reason)
   ↓
Persistence (snapshot + schema/weights/engine/data versions + regime)
   ↓
Delivery (Telegram, explainable)
```

## Separation of concerns
- **Factors** = feature extraction. Independent, plug-and-play, registered in the factor registry at the composition root.
- **Strategy** = "is this a good trade?" (gates, scoring). v1: `WeightedStrategy` only.
- **PortfolioManager** = "can WE take it now?" (kill switch, sizing, sector caps, exposure).
- **DataQualityService** = factors never see bad data; attaches dataQualityScore.

## Key contracts
```typescript
interface Factor {
  readonly name: string;
  readonly category: FactorCategory; // TREND/MOMENTUM/RS/VOLUME/VOLATILITY/SENTIMENT/FUNDAMENTAL
  evaluate(ctx: StockContext): FactorResult;
}

interface FactorResult {
  readonly score: number;
  readonly agreementContribution: number;
  readonly explanations: readonly string[];
  readonly metrics: Readonly<Record<string, unknown>>;
  readonly executionTimeMs: number;
}

interface FeatureBundle { // deep-frozen (Object.freeze) — immutable
  readonly symbol: string;
  readonly asOf: string; // ISO date, injected — never wall clock
  readonly results: Readonly<Record<string, FactorResult>>;
  readonly dataQualityScore: number;
}

interface Strategy {
  evaluate(factors: FeatureBundle, regime: MarketRegime): Signal;
}

type PortfolioDecision = ApprovedSignal | Rejection; // discriminated union
interface Rejection { readonly symbol: string; readonly reason: RejectionReason; readonly detail: string; }
```

## Reproducibility
Every signal snapshot stores: snapshot_schema_version, weights_version, engine_version (git sha),
market_regime, instrument_master_version, constituent_snapshot_date, factor_config_checksum.

## Failure isolation principle
One dependency failing must not fail the pipeline — except PostgreSQL (fail fast:
reproducibility depends on persistence). See engineering/OBSERVABILITY.md.

Full detail: spec of record + `ADR/`.

# CLAUDE_CONTEXT.md — paste-first context for AI dev sessions

## Project
QuantSwing — deterministic quantitative research + trade decision support platform,
Indian equities (NSE/BSE). Bun + TypeScript (strict) + Express, PostgreSQL (Prisma),
Redis + BullMQ (jobs/cache/rate limiting; soft dependency — watchdog inline fallback,
Postgres is the only fail-fast dependency), FinBERT sidecar (FastAPI :8001),
Angel One Smart API, Telegram delivery. Long-only swing (2–7 days),
₹5K capital, manual order placement. NO LLM in the pipeline.

## Pipeline (frozen)
Providers → DataQualityService → Factors → FeatureBundle(immutable) → Strategy
→ PortfolioManager → Signal|Rejection → Persistence(versioned snapshot) → Telegram.

## Hard constraints (never violate)
- Architecture FROZEN (spec v2.0 §1–§32). No new factors/heuristics without
  RESEARCH_PROTOCOL.md hypothesis + out-of-sample evidence.
- Determinism: same input → byte-identical FactorResult. No randomness, no wall-clock
  reads inside factors (asOf date is injected).
- All numerics in configuration; nothing hardcoded.
- Secrets env-only. Never logged, never in DB.
- Every external call: timeout + retry per spec §28. No empty catches.
- Factors never import strategy/portfolio packages (dependency direction).
- Snapshots append-only, all version fields stamped.

## Key contracts
Factor.evaluate(StockContext) → FactorResult(score, agreementContribution,
explanations, metrics, executionTimeMs). FeatureBundle is a deep-frozen readonly object.
Strategy.evaluate(FeatureBundle, MarketRegime) → Signal.
PortfolioManager returns the discriminated union ApprovedSignal | Rejection(reason, detail).

## Current phase
<UPDATE ME: phase + sprint + last completed milestone>

## Files that define truth
project/ARCHITECTURE.md · research/TRADING_RULES.md · engineering/CONFIGURATION.md ·
ai-development/IMPLEMENTATION_RULES.md

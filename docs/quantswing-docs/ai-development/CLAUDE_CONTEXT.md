# CLAUDE_CONTEXT.md — paste-first context for AI dev sessions

> ⚠️ **This spec-era primer is partly stale. For a real session, paste
> [`../../HANDOFF_NEXT_STEPS.md`](../../HANDOFF_NEXT_STEPS.md) instead** (current plan + status) and
> treat [`../../SYSTEM.md`](../../SYSTEM.md) as authoritative. Corrections: jobs = **RabbitMQ** (not
> BullMQ); indicators **in-house** (not indicatorts); FinBERT/Sentiment **not built**; base capital
> **₹100k** (not ₹5k); Phases **1–4 done**; and the "architecture frozen — no new factors" rule
> below is **superseded** — Step 1 attribution showed the entries lack edge, so building/pruning
> factors *is* the sanctioned work now (per RESEARCH_PROTOCOL evidence).

## Project
QuantSwing — deterministic quantitative research + trade decision support platform,
Indian equities (NSE/BSE). Bun + TypeScript (strict) + Express, PostgreSQL (Prisma),
Redis (cache/LTP) + **RabbitMQ** (jobs/scheduling/rate limiting; Postgres is the only
fail-fast dependency). FinBERT sidecar *(planned, not built)*, Angel One Smart API,
Telegram delivery. Long-only swing (2–7 days), **₹100k base capital**, manual order
placement. NO LLM in the pipeline.

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
Phases 1–4 complete (data, factors, golden gate, decision layer, backtesting). Backtest shows the
technicals-only strategy has **no edge yet** (entries, not exits). Step 1 attribution done. Next:
Step 3 (sector-relative RS) / orthogonal signal — see `../../HANDOFF_NEXT_STEPS.md`.

## Files that define truth
`../../SYSTEM.md` (as-built) · `../../HANDOFF_NEXT_STEPS.md` (plan) · `../../ATTRIBUTION.md` (Step 1
findings) · engineering/CONFIGURATION.md · ai-development/IMPLEMENTATION_RULES.md
*(spec docs under quantswing-docs are original intent — partly stale, see HANDOFF §3)*

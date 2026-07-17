# ADR 0003 — Strategy Pattern
Status: Accepted

## Context
CompositeScore (weighted average) was baked into the pipeline as an architectural primitive.

## Decision
`Strategy` interface: `Signal evaluate(FactorBundle, MarketRegime)`. The weighted model
becomes `WeightedStrategy`, v1's sole implementation.

## Alternatives
- Keep composite as primitive: every future approach (ML, mean-reversion) would require
  pipeline surgery.

## Consequences
+ ML/Momentum/MeanReversion strategies become drop-ins; A/B across strategies possible.
+ Cleaner testing: strategy logic isolated from feature extraction and portfolio constraints.
− One more abstraction level for a single implementation today (accepted cost).

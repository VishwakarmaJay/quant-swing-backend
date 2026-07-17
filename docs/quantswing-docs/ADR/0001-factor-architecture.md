# ADR 0001 — Factor Architecture
Status: Accepted

## Context
Initial design used monolithic scoring services (Technical/Sentiment/Fundamental) with
a flat indicator point list. Adding/removing signals required core changes; indicators
were price-correlated (counting price multiple times).

## Decision
Plug-and-play `Factor` interface; factors register in a central registry at the
composition root. Each factor emits
`FactorResult(score, agreementContribution, explanations, metrics, executionTime)`.
Technical signals reorganized into orthogonal dimensions: Trend, Momentum,
Relative Strength, Volume, Volatility (+ Sentiment, Fundamental categories).

## Alternatives
- Keep monoliths: simpler now, rigid later; explainability/ML logging bolted on.
- Rules-DSL/scripting: overkill for single-maintainer OSS.

## Consequences
+ New factor = new class; zero core changes. Explainability and ML feature logging free.
+ Per-factor attribution and profiling possible.
− More classes; golden dataset tests required to protect determinism across refactors.

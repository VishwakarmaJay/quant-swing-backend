# Benchmarks

No performance number is reported without baselines. Same period, same capital:

1. Buy & Hold Nifty 50
2. Buy & Hold Nifty 100
3. QuantSwing net of transaction costs + slippage

Report side-by-side: absolute return · Sharpe · Sortino · max drawdown.

## Paper-trading gate criterion
System must beat Buy & Hold Nifty 50 on a risk-adjusted basis over the test window,
net of costs, before any live capital. Minimum window: 2 weeks (longer preferred).

## Interpretation guardrails
- Short windows are noise-dominated — never extrapolate a 2-week result to annual expectancy.
- A losing period in a crashing market where B&H lost more is still a relative win — regime context recorded with every comparison.

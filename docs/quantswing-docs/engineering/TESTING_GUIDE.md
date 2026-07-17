# Testing Guide

## Pyramid
```
Integration (Testcontainers)   ← whole pipeline, CI
        ↑
Golden Dataset (determinism)   ← factor regression protection
        ↑
Unit (bun:test, per module)    ← logic + edge cases
```

## Unit (bun:test)
- Every factor: boundary tests — flat series, gaps, exactly-200-candle history, zero volume.
- Signal math: SL band rejects, R:R-to-resistance reject, sizing caps.
- PortfolioManager: candidate passing all strategy gates must still reject on sector cap.
- Config validator: each invalid config variant → startup failure with named violation.

## Golden Dataset (Phase 2.5, CI-enforced)
Fixed fixture: 15 stocks × fixed dates, committed to repo.
Assert byte-identical FactorResult across runs and refactors.
// TEST: any factor logic change must consciously update goldens with justification in PR

## Integration (Testcontainers + HTTP stubs)
```
msw/nock (Angel stub) + msw/nock (FinBERT stub) + Testcontainers PostgreSQL + Redis
→ full nightly pipeline on fixtures
→ assert: expected signal, snapshot persisted, versions stamped, rejections logged
```
Scenario tests:
- FinBERT stub 500 → run completes, sentiment degraded flag, signal still generated
- Telegram stub down → alert lands in undelivered queue, resent next cycle
- Redis container stopped → watchdog dispatches nightly run inline
  (dispatch_mode=INLINE_FALLBACK stamped), degraded-mode alert sent, output
  identical to queue-dispatched run
- 3 missing candles → stock skipped, quality log written

## Backtest validation
- Lookahead canary: injected future-only datapoint must never influence a signal.

## CI
GitHub Actions: build → unit → golden → integration. All green = mergeable.

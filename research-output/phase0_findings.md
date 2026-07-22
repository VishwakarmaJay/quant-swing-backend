# Phase 0 — Stage-1 Code Inspections

Read-only inspection. Nothing fixed. Findings below drive the Phase 1+ label construction.

## Summary table

| # | Inspection | Verdict | Key location |
|---|---|---|---|
| 1 | Float-equality tie detection | ⚠️ Confirmed — `===` on floats; tie branch effectively dead | `sectorRelativeStrengthFactor.ts:71`, `fundamentalFactor.ts:92` |
| 2 | Benchmark series identity | ⚠️ Single token `NSE:Nifty 50` (a **Price** index, PRI); no TRI anywhere | `factors/context.ts:15` |
| 3 | Timezone consistency | ✅ Consistent — all three cutoffs anchored to midnight-UTC of the ISO tradeDate | `factors/context.ts`, `fundamentals/asOf.ts:118` |
| 4 | Null coercion | ✅ Mostly excluded/neutral, **not** coerced to 0 — one narrow `?? 0` fallback that never fires in practice | `strategy/weightedStrategy.ts:62` |
| 5 | Time-stop day count | ⚠️ **Calendar** days, not trading days | `backtest/tradeSimulator.ts:134` |

---

## 1. Float-equality tie detection

Both mid-rank percentile computations detect ties with `===` on floating-point values:

- **`sectorRelativeStrengthFactor.ts:70–72`**
  ```ts
  const below = peerReturns.filter((r) => r < selfRet).length;
  const equal = peerReturns.filter((r) => r === selfRet).length;   // line 71 — float ===
  const percentile = (below + 0.5 * equal) / peerReturns.length;
  ```
  `selfRet` and `peerReturns` are `lookbackReturnPct` outputs (continuous floats). Two distinct symbols almost never produce bit-identical returns, so `equal` is ~always 0 (or 1 iff the peer array includes self). The `0.5 * equal` mid-rank correction therefore essentially never fires — this is a **strict rank**, not a tie-averaged mid-rank. Impact is minor (genuine ties in continuous data are rare); it only matters if the peer array contains duplicated/mirror series (e.g. dual-listings, data duplication), where it would mis-rank.

- **`fundamentalFactor.ts:90–93`** (value P/E percentile)
  ```ts
  const above = peers.filter((p) => p > f.pe!).length;
  const equal = peers.filter((p) => p === f.pe!).length;           // line 92 — float ===
  const cheaperPctl = (above + 0.5 * equal) / peers.length;
  ```
  Same pattern on `price / ttmEps` floats. Effectively strict rank.

Contrast with `attribution.ts:rank()` (already flagged ✅ correct) and `VolatilityFactor`'s percentile, which the comments claim these mirror — they do not, because the `===` comparison is on floats rather than on pre-rounded/bucketed values. **Not a correctness blocker for the measurement layer** (Phase 4 IC uses its own `rank()` with proper tie-averaging), but noted because these are the factor scores being measured.

## 2. Benchmark series identity

`grep -rn "NIFTY" src/backtest/ src/regime/ src/universe/` plus benchmark-token sweep:

- The benchmark is a **single constant**: `BENCHMARK_ID = 'NSE:Nifty 50'` (`factors/context.ts:15`), symbol label `NIFTY` (`context.ts:16`).
- It is used for **both** roles through the same constant:
  - benchmark comparison / equity curve — `backtest/candleStore.ts:107,128` and `backtest/backtestEngine.ts:159`
  - RelativeStrength-vs-Nifty — injected as `context.benchmark` via `context.ts:220–222`.
  So the two roles cannot diverge — same token across the entire archive. ✅ on identity/consistency.
- **TRI vs PRI:** No total-return token exists anywhere in the source (the only `TR` matches are True Range / ATR, unrelated). `NSE:Nifty 50` is the NSE **Price Return Index** — dividends excluded. NSE publishes the total-return series under a *separate* symbol ("Nifty 50 TR"), which is absent here.
  → This confirms audit item **H-1**: the benchmark is understated by the ~1.2–1.5%/yr Indian dividend yield (≈7–9% cumulative over 5.5y). It flatters strategy-vs-Nifty comparisons. **Not our estimand** (IC/decile work is cross-sectional and benchmark-independent for `fwd`; the `xs` market-excess labels in Phase 1 will subtract this PRI series — so `xs` returns inherit the same PRI understatement and should be read with that caveat).

## 3. Timezone consistency

`grep` for `midnight|startOfDay|setHours|toISOString|UTC` across `news/`, `backtest/`, `fundamentals/`, then traced the join point (`factors/context.ts`).

All three as-of cutoffs are anchored to **midnight UTC of the ISO trade date** (`new Date(\`${asOfIso}T00:00:00.000Z\`)`):

| Stream | Cutoff | Location |
|---|---|---|
| Candles | `tradeDate <= asOfDate` (midnight-UTC) | `context.ts:19–24, 217` |
| News | `availableAt <= asOfDate` (midnight-UTC), keyed on `availableAt` not `publishedAt` | `context.ts:160–172` |
| Fundamentals | `q.availableAt <= dateIso` (ISO string compare) | `fundamentals/asOf.ts:118` |

**Convention agrees across all three.** A same-UTC-day event (news at 09:30Z, or a quarter announced 09:30Z) sorts *after* the `...T00:00:00Z` / `YYYY-MM-DD` cutoff and is therefore excluded on day D, usable on D+1 (`asOf.ts:108–109` documents this deliberately). No cross-stream mismatch → no leak of the H-10 class.

Two nuances (neither a leak, both worth recording):
- The anchor is **UTC**, i.e. 05:30 IST. News published between 05:30 IST and the 09:15 IST open on the trade date is excluded (conservative); prior-evening news is included. Defensible PIT choice, but it is UTC- not IST-anchored.
- Two fundamentals helpers use different comparison mechanics: the backtest path `fundamentalsAsOf` (`asOf.ts:118`) uses lexicographic **string** compare, while `ttmEpsKnownBy` (`asOf.ts:54–56`) uses `dayjs(...).isAfter(...)`. Only `fundamentalsAsOf` is on the backtest pre-pass path; they agree on the "available next UTC day" boundary, so no behavioural divergence in the backtest, but the dual implementation is a latent inconsistency.

## 4. Null coercion

An absent/no-data factor is **not** coerced to 0 (which on a 0–100 scale would be maximally bearish). Two distinct mechanisms, both benign:

1. **No-data factors emit neutral 50, not null.** `SectorRelativeStrengthFactor` and `FundamentalFactor` return `score: 50, agreementContribution: 0` when they lack data. So they enter `bucketScore` / `technicalComposite` at **50 (neutral)** — not 0, not excluded.
2. **Truly absent factors (not in the bundle) are excluded and weights renormalize:**
   - `bucketScore` (`weightedStrategy.ts:20–24`): `.filter((s): s is number => s != null)`, returns `null` if none present.
   - `technicalComposite` (`weightedStrategy.ts:27–37`): `if (s == null) continue`, divides by `wSum` of present weights only.
   - Composite blend (`weightedStrategy.ts:70–77`): only present buckets pushed; `wSum` renormalized.

   **One narrow coercion exists:** `weightedStrategy.ts:62`
   ```ts
   const technicalScore = technicalComposite(bundle, cfg.technicalFactorWeights) ?? 0;
   ```
   If the *entire* technical bucket were empty, `technicalScore` falls back to `0` and enters the composite at weight `weights.technical`. Because the technical factors are candle-derived and always present in any real bundle, this `?? 0` never fires in practice — but it is the one place a null maps to a bearish 0 rather than being dropped. Flagged, not a live defect.

## 5. Trading-day vs calendar-day time-stop

`tradeSimulator.ts:134`:
```ts
if (dayjs(c.tradeDate).diff(dayjs(entryCandle.tradeDate), 'day') >= config.timeStopDays) {
```
`timeStopDays = 7` (`DEFAULT_SIMULATOR_CONFIG`, line 67) is counted in **calendar** days via `dayjs(...).diff(..., 'day')`. `holdingDays` (line 181) is likewise calendar days. So the "7-day" hold is ~5 trading days. The exit walk itself iterates over candles (trading days), but the *threshold* is calendar.

→ **Constraint for Phase 1:** the new forward-return labels (`fwd1…fwd63`) are specified as **trading-day** horizons and will be built strictly on trading days. This intentionally differs from the simulator's calendar-day stop. When Phase 5 compares realized trade returns against fixed-horizon labels, the calendar-vs-trading mismatch must be held in mind (a 7-calendar-day trade ≈ the `fwd5` label, not `fwd7`).

---

### Carry-forward to later phases
- **Labels must use trading days** (item 5) and never impute (`null` on insufficient forward data).
- **`xs` labels subtract a PRI Nifty** (item 2) — record the dividend-yield caveat; it does not affect `fwd` or `resid`.
- Phase 4 IC uses its own tie-averaged `rank()` — the item-1 float-`===` weakness lives in the *scores being measured*, not the measurement, so it does not bias the harness.
- No timezone remediation needed (item 3); no null-coercion remediation needed (item 4).

# QuantSwing — Master Roadmap Checklist

> **The single sequenced tracker.** Everything done and everything planned, in execution
> order. Check items (`[x]`) only when their *definition of done* is met — measured through
> the walk-forward harness where applicable, never off a single window. Keep this file
> updated as work lands; details live in the linked docs.
>
> Companions: [`COMPLETE_REFERENCE.md`](./COMPLETE_REFERENCE.md) (all math + limitations) ·
> [`HANDOFF_NEXT_STEPS.md`](./HANDOFF_NEXT_STEPS.md) (narrative) · [`PHASE6.md`](./PHASE6.md)

**Standing rules**
- Determinism is sacred: factor changes fail the golden test until consciously re-baselined.
- No config is believed off a single window — everything through `runWalkForward`.
- Point-in-time discipline everywhere: as-of date = the date *we could have known it*
  (filing date for fundamentals, `fetchedAt` for news) — never period-end / publishedAt.
- **Phase 5 (paper trading) stays gated** until the portfolio-level backtest beats Nifty
  risk-adjusted, net of costs, **out-of-sample**.

---

## ✅ PART A — Completed (the research program)

- [x] **A1. Phases 1–4 platform** — data foundation, 6-factor layer, golden gate, decision
      layer, persistence, Telegram, backtest engine. *149 tests, typecheck clean.*
- [x] **A2. Step 1 — Factor & gate attribution** (`backtest:attribution`) — nothing
      discriminates (ρ≈0 incl. composite); only the RSI gate filters; **BULL is the loss
      sink (−0.67%/trade)**; volume mildly harmful. → [`ATTRIBUTION.md`](./ATTRIBUTION.md)
- [x] **A3. Step 2 — Doc reconciliation** — all spec drift annotated `[AS-BUILT]` across
      ~20 docs incl. ADR-0008 supersession.
- [x] **A4. Step 3 — SectorRelativeStrengthFactor** — built, observational (weight 0);
      selection test: +0.10 exp at w≈0.25. First orthogonal signal that helps.
- [x] **A5. Step 4 — Fundamental blocked honestly** (no point-in-time data; lookahead
      refused) → redirected: regime experiments prove **filters only avoid BULL, can't fix
      it** (`backtest:regime`). → [`REGIME_ENTRIES.md`](./REGIME_ENTRIES.md)
- [x] **A6. Step 4b + v2 — BULL pullback+resumption entry** — fixes the entry style
      (BULL −1.47 → −0.32 on unseen data); full-window "edge" exposed as in-sample optimism
      by the train/test split (`backtest:pullback`).
- [x] **A7. Phase 6 — walk-forward harness + combined evaluation** (`backtest:phase6`) —
      `pullback+srs0.25` selected on all 3 folds; **OOS: PF 0.91 vs baseline 0.78,
      exp −0.12 vs −0.34. Better, still not profitable.** → [`PHASE6.md`](./PHASE6.md)
- [x] **A8. COMPLETE_REFERENCE.md** — all math, factors, findings, 17 limitations in one file.

**State after Part A:** near-breakeven, honestly measured, no positive OOS edge.
The remaining gap needs orthogonal data + a fair portfolio-level test — Part B.

---

## 🔜 PART B — The build sequence (in execution order)

### ✅ B1. Portfolio-level backtest — *the fair "beat Nifty" gate* — DONE
Results: [`PORTFOLIO_BACKTEST.md`](./PORTFOLIO_BACKTEST.md) · `bun run backtest:portfolio` ·
157/157 tests.
- [x] Simulator (`src/backtest/portfolioSimulator.ts`): one ₹2L base, calendar sweep over
      precomputed trajectories; caps/sizing/kill-switch; entries-before-exits (no lookahead)
- [x] Portfolio metrics: CAGR, true max drawdown, exposure, same-units Nifty comparison
- [x] Sizing variants: flat / conviction / risk — risk-based gives the smallest drawdowns;
      conviction's return win is variance (n≈114, ρ≈0 score), not vindication
- [x] Cost-sensitivity 2×: both degrade ~7pp, **ranking stable** (combined still > baseline)
- [x] OOS evaluation over the Phase-6 test stretch (selection was constant across folds,
      so the continuous OOS run is faithful to the walk-forward pick)
- **📉 VERDICT — the gate is real and currently FAILED by a wide margin:** OOS the
  portfolio lost **−12.7% (combined/conviction) to −23.4% (baseline/flat)** vs Nifty
  **−4.4%**; full window −2.1% vs Nifty +10.0%. Portfolio truth is *worse* than
  signal-edge truth: the 2-slot cap takes only ~15% of signals, picked by an uninformative
  ranking, and compounding turns per-trade drift into deep drawdown (−15…−29%).
  **Combined beats baseline everywhere** (every sizing, both windows, 2× costs) — the
  Phase-6 lever generalizes. New measurable lever surfaced: **slot-allocation ranking**.
  → Reinforces B4→B5 (orthogonal signal) as the critical path; B10 stays hard-gated.

### ✅ B2. Wire the validated config into the nightly run — *operator decision* ⚙️ — DONE
Production emitted the known-worst baseline; now it runs the OOS-validated `srs0.25 +
pullback-v2` config (still not edge — orders remain manual, Phase 5 stays gated).
- [x] Operator sign-off to change live signal behaviour
- [x] Set SRS weight 0.25 in `technicalFactorWeights` + adopt BullPullback entry for BULL —
      graduated via `createProductionStrategy()` (`src/strategy/productionStrategy.ts`), wired
      into `runPipeline`. `DEFAULT_STRATEGY_CONFIG` kept **frozen** as the research baseline so
      the attribution/regime/phase6/portfolio controls stay intact.
- [x] Re-baseline `weightsVersion` (`w-fd0e1dec2aa9` → `w-6edfeb770e4a`, now stamps the
      production config incl. the pullback entry); golden untouched (factor layer unchanged)
- **Done when:** nightly Telegram signals come from the validated config, version-stamped. ✅
      Verified: typecheck clean, 157/157 tests pass, production strategy = the exact
      `pullback+srs0.25` config `backtest:phase6`/`backtest:portfolio` evaluated. (First live
      `signals:run` requires networked infra + backfill — not runnable in-repo.)

### B3. News scraper + archive — *clock #1, start ASAP* ⏰ needs network/infra
The archive is the asset; FinBERT can score it retroactively. Every week not collecting
is a week of sentiment backtest lost.
- [ ] `NewsArticle` schema: source, url, title, body?, symbols[], `publishedAt`,
      **`fetchedAt`** (the as-of date — lookahead discipline)
- [ ] RSS ingestion job (15-min RabbitMQ cron): ET Markets, Moneycontrol, BSE
      announcements XML, Google News RSS
- [ ] Title normalization + Jaccard dedup across sources
- [ ] **Symbol mapper** (the hard part): alias dictionary for the 166 tickers,
      conservative matching, unmatched-headline log to grow the dictionary
- [ ] Deployed + verified live on networked infra; monitor daily volume/dupe rate
- **Done when:** articles/day flowing for all 4 sources, deduped, ≥90% of matched symbols
  correct on a manual sample. **Archive start date = sentiment backtest clock start.**

### B4. Fundamentals: snapshotter + point-in-time backfill — *clock #2 + the unblock* ⏰
- [ ] Weekly snapshotter: current Screener/NSE fundamentals per stock with `fetchedAt`
      (builds native point-in-time data going forward)
- [ ] Historical backfill from **dated** NSE/BSE quarterly filings (announcement dates!):
      quarterly EPS, promoter/pledge %, results calendar
- [ ] Reconstruct as-of series: `TTM_EPS_knownBy(date)` → `PE_asOf = price / TTM_EPS`;
      sector-relative PE from the same universe
- [ ] Spot-verify a sample of reconstructed values against known filings
- **Done when:** every universe stock has an honest as-of fundamental series covering the
  backtest window (announcement-dated, no period-end lookahead).

### B5. FundamentalFactor — *the most likely source of real edge* 📈 blocked on B4
- [ ] Factor (pure, injected data like `sectorPeers`): PE-vs-sector percentile, EPS trend,
      pledge %, results-proximity flag → 0–100 score
- [ ] Integrate **observationally (weight 0)** — baseline byte-identical, golden re-baselined
- [ ] Measure via attribution **selection test** (not just conditioning — the SRS lesson)
- [ ] Walk-forward with the fundamental bucket active (regime weight matrix activates
      automatically) — candidates {fund weight} × {existing levers}
- **Done when:** fundamental's marginal OOS contribution is measured; weight set (or factor
  rejected) on walk-forward evidence.

### B6. FinBERT sidecar — *decoupled; any time after B3 starts* 🐍
- [ ] FastAPI + ProsusAI/finbert (pinned revision + tokenizer = deterministic), batch
      endpoint on :8001 (ADR-0006)
- [ ] India-term normalizer (crore/lakh/PAT/YoY etc.) pre-pass
- [ ] Retro-score the accumulated archive; store scores per article
- [ ] Degraded-neutral fallback when sidecar is down (delivery-style no-throw)
- **Done when:** archive scored end-to-end; spot-check of Indian headlines acceptable.

### B7. SentimentFactor — ⏳ gated on ~6 months of B3 archive
- [ ] Aggregation: recency-weighted, deduped, chase-decay → per-stock 0–100
- [ ] Observational first; sentiment bucket + gate 7 activate automatically
- [ ] Walk-forward once the archive window is long enough to split honestly
- **Done when:** sentiment's marginal OOS contribution measured over ≥6mo of archive.

### B8. Robustness upgrades — *parallel, whenever* 🧰
- [ ] Backfill OHLCV to Angel One's ~2000-day limit → more folds, more cycles
- [ ] Historical index-constituent data (NSE change records) → kill survivorship bias
- [ ] Purged/embargoed walk-forward boundaries if longer-lookback signals arrive
- [ ] VIX feed (replace Nifty-ATR proxy)

### B9. Phase 6 rerun — joint weighting over the enriched set 🎯 after B5 (and B7)
- [ ] Re-run attribution across all factors (technical + fundamental [+ sentiment])
- [ ] Prune what doesn't contribute (volume is the standing suspect)
- [ ] Joint config selection via walk-forward; consider learned weighting (logistic → GBM)
      **only if** features now show discrimination (ρ meaningfully > 0)
- **Done when:** one best evaluated strategy, OOS-validated, with every component earning
  its place.

### B10. Phase 5 — paper trading 🔒 HARD-GATED
- **Gate (unchanged):** B1's portfolio-level backtest shows the B9 strategy **beats Nifty
  risk-adjusted, net of costs, out-of-sample.** Not before — paper-trading a known-negative
  strategy burns calendar time.
- **Current gate reading (B1, 2026-07):** ❌ failed by a wide margin — OOS portfolio
  −12.7%…−23.4% vs Nifty −4.4% ([`PORTFOLIO_BACKTEST.md`](./PORTFOLIO_BACKTEST.md)).
- [ ] Gate cleared (link the run + numbers here)
- [ ] ≥2-week paper trade, metrics + factor attribution logged from day 1
- [ ] Live fills vs simulated: measure real slippage, recalibrate the cost model

---

## Dependency map

```
B1 portfolio backtest ──────────────┐
B2 wire config (operator) ─┐        │
B3 news archive ──► B6 FinBERT ──► B7 SentimentFactor ─┐
B4 fundamentals data ──► B5 FundamentalFactor ─────────┼──► B9 Phase-6 rerun ──► B10 Phase 5
B8 robustness (parallel) ──────────────────────────────┘         (gated by B1's fair test)
```

**Environment note:** B1 is fully buildable/verifiable in-repo. B3/B4/B6 need networked
infra to run and verify (code can be written any time). B2 is an operator decision.

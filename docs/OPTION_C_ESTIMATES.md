# Option C — paid consensus estimates (earnings surprise / PEAD)

> **Decision brief, not code.** This is the one lever the program cannot pull for free, and the
> only one with a *documented* effect at this horizon that we have proven we structurally
> cannot see: **post-earnings-announcement drift (PEAD)**. B12 pinned it — we can type *that*
> results were filed but never *whether they beat expectations* ([`EVENT_STUDY.md`](./EVENT_STUDY.md)
> §4a: `EARNINGS_RESULT` is flat at every horizon). This doc scopes what buying estimates would
> take so the spend is a **decision**, not a research question. Claude cannot make the purchase.

## 1. Why this is the highest-odds remaining lever
- PEAD is one of the most replicated anomalies in the literature and it lives at *exactly* this
  horizon (drift over days-to-weeks after an earnings surprise).
- Six independent free-data studies (B5/B7, B11, B12, B13, B14, midcap spike) all failed to find
  a right tail — but B12 showed the reason is **missing surprise data**, not that the effect is
  absent. This is the one negative with an identified, purchasable cause.
- The pipeline is already 90% ready: `quarterly_fundamental` holds announcement-dated actuals
  (B4), the event classifier types `EARNINGS_RESULT` filings (B12), and the factor/floor +
  walk-forward machinery is built. **Only the consensus-estimate number is missing.**

## 2. Exactly what data is needed
- **Consensus estimates**, point-in-time, per symbol per fiscal quarter: at minimum consensus
  **EPS** (and ideally revenue) as it stood **before** each results announcement. Surprise =
  `(actual − consensus) / |consensus|`, joined to our announcement-dated actuals.
- **Point-in-time is non-negotiable** (the project's founding discipline): the estimate must be
  the value *knowable before* the print, with its own as-of timestamp — not a
  restated/back-filled consensus. A vendor that only serves *current* consensus is useless here.
- Coverage: the 167-name large-cap universe is the priority (best estimate coverage in India).
  ~167 names × ~4 quarters × ~5.5yr ≈ **~3,700 surprise observations** — enough for the anchored
  walk-forward if coverage is decent.

## 3. Providers + rough cost (operator to verify current pricing)
Indian-market consensus estimates are sold, not free. Candidate sources, cheapest-first:
- **Refinitiv/LSEG I/B/E/S**, **Bloomberg**, **FactSet**, **S&P Capital IQ** — gold-standard
  point-in-time consensus, but enterprise pricing (typically $$$$/yr) — likely overkill.
- **Trendlyne / Tijori / Screener Pro (India)** — retail/prosumer tiers that expose consensus
  estimates; far cheaper (order of ₹thousands–₹tens-of-thousands/yr), but **verify they provide
  point-in-time (pre-announcement) consensus, not just current** — most retail tools show only
  current, which would reintroduce lookahead and void the study.
- A **one-time historical snapshot** (buy the 2021→now estimate history once, no subscription)
  would be enough to *backtest the hypothesis* before committing to a recurring feed — the
  cheapest way to de-risk the decision. Prefer this first.

## 4. Integration design (engineering-ready; ~2–3 days once data is in hand)
1. **Schema:** `consensus_estimate(symbol, fiscalPeriod, metric, value, asOf, source)` — mirrors
   `quarterly_fundamental`; `asOf` is the pre-announcement date the estimate was knowable.
2. **Ingest:** a loader like `fundamentals:backfill`, idempotent, per-source, point-in-time.
3. **Surprise join:** `surpriseAsOf(symbol, date)` = latest actual (announcement-dated) vs the
   consensus with `asOf < announcement` → a signed surprise %, exposed like `ttmEpsKnownBy`.
4. **`EarningsSurpriseFactor`** (pure, observational at weight 0 — the standing rule): scores
   recent positive surprise, decaying over the PEAD window; lands byte-identical (empty bucket),
   graduates only on walk-forward evidence.
5. **Measure:** the exact B5/B7/B9 protocol — attribution selection test + floor gate + anchored
   walk-forward + `backtest:portfolio`. **Go-condition:** a surprise-conditioned config beats the
   benchmark risk-adjusted OOS on the coverage era. This is the first lever with a *prior reason*
   to clear it.

## 5. The decision
- **Cost:** a data purchase (ideally a one-time historical snapshot first, ~low ₹thousands if a
  retail PIT source exists; enterprise otherwise). **Recurring** only if it validates and goes live.
- **Odds:** highest of any remaining lever — it targets a documented effect with an identified,
  purchasable cause, on a pipeline that's already built.
- **Claude's limit:** buying data / creating vendor accounts / entering payment is out of scope —
  this brief readies the decision; the operator makes the purchase, then the §4 build proceeds.
- **If not bought:** Option C stays closed and the honest end state is A/D (consolidate + wait /
  accept as decision support). This is the fork's crux — and it is a *spend* decision, not more code.

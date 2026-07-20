# B13 — Delivery % (NSE bhavcopy): the last free right-tail candidate

> **Run it:** `bun run bhavcopy:download --from … --to …` then
> `bun run delivery:study [1|3|5|10]` (read-only).
> **Code:** `src/delivery/bhavcopy.ts` (parser) · `src/delivery/metrics.ts` (surge/decile
> math) · `src/scripts/{downloadBhavcopy,runDeliveryStudy}.ts`. **Date:** 2026-07-20.
> Archive: **1,433 daily files, 2021-01 → 2026-07, 227,493 universe delivery rows.**
> Precedents: [`SLOT_ALLOCATION.md`](./SLOT_ALLOCATION.md) (B11) · [`EVENT_STUDY.md`](./EVENT_STUDY.md) (B12).

## 1. Why this one mattered

Delivery % — the share of traded volume that actually settles as delivery rather than
being squared off intraday — is the one number a price feed cannot give. It is the best
free proxy for institutional accumulation, and the B3/B4 architecture review ranked it the
**highest alpha-per-effort free source we had never touched**.

Critically, and unlike sentiment: **it is backtestable today.** NSE's archive serves the
full bhavcopy back past 2021, covering the entire 5.5-year candle window. No clock.

Three signals were measured side by side, with the control and the confound check built in
*before* seeing any result:

| # | signal | rationale |
|---|---|---|
| 1 | **Level** (raw delivery %) | The **control**. Delivery level is largely structural — an insurer sits at 60–70% daily, a high-churn name at 25%. Ranking on it should mostly rank sector/shareholding, not alpha. |
| 2 | **Surge** (today ÷ own 20d baseline) | The accumulation hypothesis proper — "someone is taking delivery unusually hard *for this name*". Same relative-to-own-norm shape that made SRS work. |
| 3 | **Surge, volume also rising** | The **confound check**. Delivery % rises when volume *collapses* too — that is an absence of day traders, not accumulation. If the mechanism is real, requiring volume up should *sharpen* the effect. |

Design: **cross-sectional deciles per day** (so a spread cannot be a rising-tide artifact),
entry on the **next bar** after the observation date (bhavcopy publishes post-close, so
day D's delivery is known at D's close — no lookahead beyond what OHLCV already assumes).

## 2. Results

**D10 − D1 spread** (top minus bottom decile of forward excess vs Nifty):

| signal | 5d mean | 5d **p90** | 10d mean | 10d **p90** |
|---|---|---|---|---|
| 1. Level (control) | −0.01 | **−1.78** | −0.03 | **−2.38** |
| 2. Surge | **+0.15** | +0.05 | **+0.28** | +0.32 |
| 3. Surge + volume rising | +0.14 | −0.35 | +0.27 | −0.20 |

### The control behaved exactly as predicted — and found something else
Delivery **level** has *no* return signal (mean spread ≈ 0 at both horizons). But its p90
declines monotonically across deciles (5d: +6.12 → +4.34) and its p10 rises monotonically
(−5.16 → −3.52). That is not alpha, it is **volatility**: low-delivery names are
high-churn with fat tails on both sides; high-delivery names are stable with thin tails.
The relationship is *tighter and more monotone than anything in the return columns.*
Delivery level is a clean **volatility/liquidity proxy** — real information, wrong kind.

### The surge is real, small, and has no right tail
Decile progression at 5d is coherently monotone (+0.15 → +0.30, hit rate 48.2% → 50.5%),
and it **builds with horizon** (+0.28 at 10d), which is the signature of genuine drift
rather than noise. But:

- **The p90 spread is ≈ 0** (+0.05 at 5d, +0.32 at 10d on a ~7.9 base — a ~4% relative
  widening). **The right tail does not widen.** This is the fourth consecutive lever that
  shifts the centre slightly and finds no large winners.
- **The effect is at or below trading cost.** The entire top-vs-bottom decile spread is
  +0.28pp at 10 days against a **0.25% round-trip cost**. And a strategy cannot trade a
  spread — it trades the top decile, whose marginal contribution over the universe average
  is roughly **+0.18pp**.

### The confound check FAILS — so the mechanism is probably not accumulation
Requiring volume to also be rising left the effect **unchanged** (mean +0.27 vs +0.28) and
made the p90 spread *negative*. If genuine institutional accumulation were driving this,
conditioning on real volume expansion should have sharpened it. It did not. Whatever the
surge decile is picking up, the evidence does not support "institutions are buying."

## 3. Verdict

**The pre-registered bar — coherent monotone progression AND a p90 spread — is not met.**
Monotone: yes. Right tail: no. Mechanism check: failed. Effect size: ≈ costs.

**No factor, no schema, no ingestion cron is built on this.** The archive, parser, and
study harness stay (cheap, reusable, and the data may serve a different purpose below),
but delivery % does not graduate.

**One genuinely useful byproduct:** delivery level is a better volatility/liquidity proxy
than a return signal. If anything here is ever used, it is as a *sizing or eligibility*
input — not as alpha. That is a hypothesis for another day, not a result.

## 4. The meta-finding — four independent lines now agree

This is the fourth consecutive, methodologically independent attempt to locate a right
tail, and all four returned the same answer:

| # | study | method | right-tail result |
|---|---|---|---|
| B5/B7 | factor floors | selection tests + walk-forward | trim the **left** tail only |
| B11 | slot allocation | 8 rank keys vs a seeded random control | nothing beats a coin flip |
| B12 | event typing | 12 exchange-labelled event types | p90 flat at 4.1–5.9 across all types |
| B13 | delivery % | 3 signals, cross-sectional deciles | p90 spread ≈ 0 |

Every lever this program has found trims losers. **Nothing found so far identifies large
winners** — which is precisely what a 2R/3R target structure needs to pay.

Combined with B12's structural finding (we can type *that* results were filed, never
*whether they surprised* — surprise needs paid consensus estimates), the evidence now
points at a conclusion the roadmap should state plainly rather than discover by attrition:

> **A 2–7 day swing horizon on large-cap Indian equities, using free data, may not contain
> an exploitable right tail.**

The honest options from here are structural, not incremental:
1. **Change the horizon** — the drift signals found in B12/B13 all *build* with horizon
   (order wins, ratings, delivery surge all strongest at 10d). A 20–60 day horizon is where
   this evidence actually points, and it is a different strategy, not a tuning.
2. **Change the universe** — large caps are the most efficiently priced segment. Mid/small
   caps are where free-data inefficiency is likelier (and where delivery % is more
   informative), at the cost of liquidity and higher survivorship risk.
3. **Buy the missing data** — consensus estimates would unlock earnings surprise/PEAD, the
   single most documented effect at this horizon and the one B12 proved we structurally
   cannot see.
4. **Accept the system as decision support** — it is a reproducible, honestly-measured
   signal factory with a validated least-bad config. That is a legitimate end state.

## 5. Caveats

One missing day in 1,433 (2022-08-08 — NSE served an XLSX at the `.csv` URL; the
downloader's validation refused to cache it rather than storing a silently empty day).
Survivorship (today's universe). Study only — no entry gate, sizing, or cost model applied
to the deciles; costs are quoted for scale, not simulated. Cross-sections with fewer than
30 names on a date are skipped. Delivery data is EQ-series only. The `surge` baseline needs
20 prior days, so each symbol's first month is excluded rather than partially estimated.

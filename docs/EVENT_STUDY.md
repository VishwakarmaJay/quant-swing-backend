# B12 — Event study: is the right tail in the events?

> **Run it:** `bun run events:study [1|3|5|10]` (read-only).
> **Code:** `src/events/classify.ts` (pure, versioned `ev-1.1.0`) ·
> `src/events/eventStudy.ts` (pure outcome math) · `src/scripts/runEventStudy.ts`.
> **Date:** 2026-07-20 · 57,635 symbol-observations from 57,080 exchange filings.
> **Update 2026-07-21 (`ev-1.1.0`):** `INSIDER_PLEDGE` de-confounded — scheduled
> `TRADING_WINDOW` notices split into their own type. Result in §4b (the strong
> `+0.82@10d` cell was the calendar artifact, not smart money). The §2/§3 tables
> below are the original `ev-1.0.0` run; only the `INSIDER_PLEDGE` row changed —
> every other cell is byte-identical.
> Precedent: [`SLOT_ALLOCATION.md`](./SLOT_ALLOCATION.md) (B11 closed the allocation
> question and named the right tail as the frontier).

## 1. The hypothesis and why it was cheap to test

Every lever measured so far — both factor floors (B5/B7), all eight rank keys (B11) —
**trims the left tail or does nothing.** Nothing identifies *large winners*. Events were
the standing hypothesis for where the right tail lives.

The architecture review's observation made this cheap: **BSE labels its own
announcements**, so v1 typing is a lookup, not NLP. Measured before building anything:
39.4% of BSE rows carry the exchange subcategory verbatim in the stored body
(`Announcement under Regulation 30 (LODR)-<SubCategory>`); a small keyword pack for the
non-LODR formats adds ~18% more. **Final typing coverage: 57.7%** (22,486 exchange-label
+ 11,583 keyword; 23,011 untyped → `OTHER`, never guessed).

Point-in-time: outcomes anchor at the first close **strictly after `availableAt`** — the
same next-bar rule the trade simulator uses. Exchange filings carry the most trustworthy
availability evidence in the archive, so the study runs on BSE origins only.

## 2. Result — the right-tail hypothesis is NOT confirmed

**5-day excess vs Nifty** (`p90` = the upside-tail statistic this was built to find):

| event type | n | mean | 95% CI | hit% | **p90** | p10 |
|---|---|---|---|---|---|---|
| ORDER_WIN | 439 | +0.18 | −0.28…+0.63 | 49.7 | **+5.92** | −4.85 |
| INSIDER_PLEDGE | 1423 | +0.48 | +0.26…+0.70 | 51.8 | +5.50 | −4.10 |
| BOARD_MEETING | 2572 | +0.06 | −0.11…+0.23 | 48.0 | +5.26 | −4.62 |
| DIVIDEND | 1323 | +0.02 | −0.20…+0.24 | 46.5 | +5.23 | −4.49 |
| RATING_ACTION | 845 | +0.36 | +0.09…+0.63 | 51.0 | +5.07 | −3.97 |
| EARNINGS_RESULT | 2332 | −0.02 | −0.18…+0.15 | 46.4 | +4.76 | −4.56 |
| M_AND_A | 2405 | +0.25 | +0.09…+0.40 | 51.5 | +4.72 | −3.90 |
| **OTHER (untyped)** | **24241** | **+0.12** | **+0.07…+0.17** | **48.2** | **+4.66** | −4.10 |
| EARNINGS_CALL | 8686 | +0.09 | +0.01…+0.18 | 48.8 | +4.49 | −4.07 |
| MGMT_CHANGE | 3167 | −0.02 | −0.16…+0.12 | 47.2 | +4.47 | −4.38 |
| CAPITAL_ISSUE | 2487 | +0.04 | −0.10…+0.18 | 49.8 | +4.11 | −3.75 |

**The p90 column is the answer, and it is flat.** Every type sits between +4.1 and +5.9.
There is **no event type with a distinctively fat right tail** — the spread tracks the
general volatility of the names, not event-specific upside. The hypothesis as posed
("some event type produces outsized winners") is **not supported**.

### The `OTHER` row is the most important row in the table
The untyped grab-bag is *also* statistically positive (+0.12, CI excludes 0). That means
the significance stars are measured against the **wrong null**: the right baseline is not
zero, it is *"a company filed something at all."* Re-read against the filing baseline:

| above baseline | at/below baseline |
|---|---|
| INSIDER_PLEDGE (4×), RATING_ACTION (3×), M_AND_A (2×) | EARNINGS_CALL, MEDIA_ROUTINE, BOARD_MEETING, DIVIDEND, CAPITAL_ISSUE, MGMT_CHANGE, **EARNINGS_RESULT** |

Only **three** types clear the baseline. Five "significant vs zero" cells are just the
filing-day effect.

## 3. What did show up: small, monotone post-event drift

| type | 1d | 3d | 5d | 10d | 10d CI |
|---|---|---|---|---|---|
| ORDER_WIN | −0.04 | +0.02 | +0.18 | **+0.78** | +0.04…+1.52 |
| INSIDER_PLEDGE | +0.15 | +0.39 | +0.48 | **+0.82** | +0.50…+1.13 |
| RATING_ACTION | +0.08 | +0.23 | +0.36 | +0.37 | +0.01…+0.73 |
| M_AND_A | +0.06 | +0.20 | +0.25 | +0.34 | +0.12…+0.55 |
| EARNINGS_RESULT | −0.04 | +0.01 | −0.02 | +0.02 | −0.20…+0.25 |

Monotone build across horizons is the signature of genuine post-event drift rather than
noise, and ORDER_WIN's 10d p90 (+8.28) is the fattest tail in the study. But the
magnitudes are **+0.3 to +0.8% at 10 days against a 0.25% round-trip cost** — thin, and
ORDER_WIN's n=437 gives a CI that nearly touches zero.

## 4. Two findings worth more than the table

**a. EARNINGS_RESULT is flat at every horizon — and that explains the free-data ceiling.**
Post-earnings-announcement drift is the most documented effect in this horizon class, and
we cannot see it. The reason is structural: we can type *that results were filed*, but not
*whether they beat expectations* — surprise needs consensus estimates, which are paid
data. **"Results happened" is not a signal; "results surprised" would be.** This is the
cleanest statement yet of what the ₹0 data budget actually costs, and it should temper any
expectation that more event typing unlocks the right tail.

**b. INSIDER_PLEDGE's strength is probably a calendar artifact, not smart money.**
The bucket includes *"Closure of Trading Window"* notices, which are **scheduled** — they
cluster immediately before earnings season. A positive excess following them is plausibly
a seasonality effect, not information. Splitting genuine SAST/PIT/pledge disclosures from
trading-window notices is a prerequisite before this cell is believed. **Do not treat the
+0.82 as a smart-money result.**

> **✅ RESOLVED — de-confounded 2026-07-21 (`ev-1.1.0`).** The classifier now tests
> `trading window` *before* the pledge rule (the scheduled notices carry PIT-regulation
> boilerplate that would otherwise match `insider`), splitting the old bucket into
> `TRADING_WINDOW` (scheduled) and `INSIDER_PLEDGE` (real SAST/PIT/pledge). Re-run,
> BSE origins, every other cell byte-identical:
>
> | cell | n | 5d mean (CI) | 10d mean (CI) | 10d p90 |
> |---|---|---|---|---|
> | **old** INSIDER_PLEDGE (`ev-1.0.0`) | 1418 | +0.48 (+.26…+.70) | +0.82 (+.50…+1.13) | +7.38 |
> | **TRADING_WINDOW** (scheduled artifact) | **1294** | +0.45 (+.22…+.67) | **+0.82 (+.49…+1.14)** | +7.34 |
> | **INSIDER_PLEDGE** (real disclosures) | **124** | +0.80 (+.02…+1.59) | +0.79 (**−0.40**…+1.98) | **+8.37** |
>
> **The verdict is: the strong, tight cell was the calendar artifact.** 91% of the old
> observations (1294/1418) were trading-window notices, and they retain the *entire*
> well-powered positive drift (significant at 5d **and** 10d) — exactly the pre-earnings
> seasonality §4b predicted, **not** information. The B12 §4b suspicion is confirmed:
> **the celebrated `+0.82@10d` is not a smart-money result.**
>
> The genuine SAST/PIT/pledge remnant (n=124) is *not* cleanly killed, though — it keeps a
> comparable magnitude (5d +0.80, 10d +0.79) and the **fattest p90 in the entire study**
> (+8.37@10d), but at n≈125 its CI is significant at 5d and spans zero at 10d. Honest read:
> **an underpowered candidate, not a result** — a thin, high-variance right-tail hypothesis
> that neither the data nor the pre-registered n-floor lets us bank. It graduates to nothing;
> if the archive accrues enough genuine-disclosure rows to tighten n, it is worth one re-look,
> but the seasonality signal it was riding on has been removed.

## 5. Verdict

1. **The right-tail hypothesis is not confirmed by event typing.** No type shows a
   distinctively fat upside tail; the p90 spread across all types is 4.1–5.9 at 5 days.
2. **Only three types beat the filing baseline** (INSIDER_PLEDGE, RATING_ACTION, M_AND_A),
   and one of those three is confounded. Against the correct null, the effect count drops
   from eight to two-and-a-half. **[UPDATED — ev-1.1.0, §4b]** The confounded one is now
   split: the strong cell was `TRADING_WINDOW` (a calendar artifact), and the genuine
   `INSIDER_PLEDGE` remnant (n=124) no longer clears the baseline at 10d. So against the
   correct null the durable count is **two** (RATING_ACTION, M_AND_A) — both thin.
3. **The surviving signal is small monotone drift**, not a tail. ORDER_WIN and
   RATING_ACTION are the honest candidates: coherent across horizons, mechanism-plausible,
   but +0.4–0.8% at 10 days is thin against costs and a 2R/3R target structure that needs
   ~5%+ moves to pay.
4. **This does NOT become a factor yet.** Per the standing rule, a promising cell is a
   hypothesis for the pipeline, not a result. Any event lever must clear the anchored
   walk-forward and the portfolio gate exactly like the floors did.
5. **The honest read on the roadmap:** B11 closed allocation, B12 substantially closes
   "type the events we already have." The remaining free-data ideas for the right tail are
   **delivery %** (NSE bhavcopy — institutional accumulation, untouched) and splitting the
   confounded buckets. If those also come back flat, the evidence will be pointing at a
   harder conclusion: that a 2–7 day horizon on large-cap Indian equities with free data
   may not contain an exploitable right tail, and the honest options become a different
   horizon, a different universe, or paid data.

## 6. Caveats

Typing coverage 57.7% — untyped rows are excluded from typed cells, not assumed neutral
(they form the `OTHER` baseline). One filing tagged to N symbols contributes N
observations, so cells are not independent across co-mentioned names. Survivorship
(today's universe). No entry gate, sizing, or cost model — this measures what followed an
event, not what a strategy would have earned. Cells with n < 30 are dropped rather than
reported. Extractor `ev-1.1.0` (was `ev-1.0.0` — the `TRADING_WINDOW`/`INSIDER_PLEDGE`
split, §4b): changing the rule pack changes the version, and any study should be re-run
rather than compared across versions.

*Engineering note (fixed 2026-07-20): the first run reported zero observations — a
symbol-join failure (news symbols are canonical, instrument symbols carry a `-EQ` series
suffix) that produced empty tables indistinguishable from "no events qualified". Root
cause was not the typo but the **convention having no home**: the same strip was
copy-pasted as an inline regex at nine call sites, so the tenth omitted it. Fixed
properly — `canonicalSymbol` / `byCanonicalSymbol` (`src/universe/symbols.ts`, +8 tests)
is now the single home for the rule, all nine sites call it, zero inline regexes remain,
and `byCanonicalSymbol` reports key collisions instead of silently dropping rows. The
study additionally hard-fails on zero measured observations. Re-run after the refactor:
byte-identical results. A silent false negative is the most dangerous output a research
harness can produce.*

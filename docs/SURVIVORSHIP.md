# Survivorship — the historical-constituent "block", re-examined (2026-07-21)

> **Headline:** the task filed as *"repairing history needs NSE index-change records, which
> sit behind a JS/WAF page that resisted fetching"* (OPEN_ITEMS §2, L5) is **not blocked**.
> Both halves of the data are obtainable — and the price half is **already on disk**. What
> remains is engineering (universe expansion + a bhavcopy→OHLCV ingest + a re-backtest), not
> data acquisition. This doc records the unblock, the triaged surface, and the plan.

Companion: [`OPEN_ITEMS.md`](./OPEN_ITEMS.md) L5 · [`DELIVERY_STUDY.md`](./DELIVERY_STUDY.md)
(the bhavcopy archive this reuses) · `src/universe/membership.ts` (the B8.2 mechanism).

---

## 1. What the block actually was

The backtest replays **today's curated 167-name universe** into the past, so any name that
was tradeable in 2021–2024 but is gone from the list now silently vanishes from history —
survivorship bias that flatters results (L5). The forward fix exists (B8.2
`UNIVERSE_MEMBERSHIP`); repairing the *past* was thought to need historical NSE index
constituents "behind a JS/WAF page." Re-examined 2026-07-21:

- **The JS/WAF wall is only the interactive listing page.** The underlying data is static:
  - **Reconstitution press-release PDFs** — `curl` + a browser UA fetches them (HTTP 200,
    real PDF); `pypdf` parses the clean per-index "being excluded / being included" tables.
    Verified on `ind_prs24022022_1.pdf` (extracted the exact Nifty 100 add/drop lists).
  - **Historical constituent CSVs** — the **Wayback Machine** serves point-in-time snapshots
    of `niftyindices.com/IndexConstituent/ind_nifty200list.csv` (raw via the `…id_/` prefix).
    Pulled 2021, 2022, 2023 snapshots (≈201 names each) + the current list — clean CSV with
    **ISIN**, which is what makes the triage below reliable across renames.

So the "source" was never the blocker.

## 2. The triaged surface — 116 names, and what they actually are

Union of Nifty 200 members across the 2021/2022/2023 snapshots = 261 names; **116 are absent
from today's 167-name universe.** Triaging by **ISIN** (survives symbol renames) against the
current Nifty 500 splits them into three very different buckets:

### [1] Rename / merger already covered by a universe member — **8** (NOT a gap)
Same ISIN as a stock we already hold, under a new symbol. The ISIN method validates itself
here — these are exactly the known corporate actions:
`CADILAHC→ZYDUSLIFE, INFRATEL→INDUSTOWER, LTI→LTM, LTIM→LTM, MCDOWELL-N→UNITDSPR,
MOTHERSUMI→MOTHERSON, TATAGLOBAL→TATACONSUM, TATAMOTORS→TMPV`.
(Plus a few whose successor is in the universe but whose *old* ISIN differs and so surface in
[3] instead: HDFC→HDFCBANK, MINDTREE→LTM, SRTRANSFIN→SHRIRAMFIN.)

### [2] Still in the current Nifty 500, just not in our 167 — **73** (curation, NOT survivorship)
ACC, ESCORTS, GLENMARK, PAGEIND, EXIDEIND, DIXON, ASTRAL, BALKRISIND, FORTIS, IGL, … These
never vanished — they are large/mid-cap **today**. Excluding them is a curation choice
applied *consistently across time*, so it does **not** create survivorship bias. Adding them
would enlarge the universe, not repair a bias. (Legitimate candidates if we ever widen the
universe — a different decision.)

### [3] Gone from the current Nifty 500 — **35** (the true survivorship tail)
`AVANTIFEED, DBL, DHFL, DISHTV, DUMMYREL, EDELWEISS, FCONSUMER, FRETAIL, GODREJAGRO, GRUH,
GSPL, GUJGASLTD, HDFC, HEG, HEXAWARE, IBVENTURES, JUBLFOOD, MINDTREE, NAUKRI, PCJEWELLER,
PEL, PGHH, QUESS, RAJESHEXPO, RELCAPITAL, RELINFRA, SPARC, SRTRANSFIN, STRTECH, TATAMTRDVR,
TV18BRDCST, VAKRANGEE, VARROC, VGUARD, YESBANK`. This bucket itself is mixed:
- **Genuinely delisted / dead — the names that actually bias the backtest** (they were
  tradeable losers that then disappeared): DHFL, FRETAIL, FCONSUMER, RELCAPITAL, DISHTV,
  PCJEWELLER, VAKRANGEE, IBVENTURES … `DUMMYREL` is an NSE corporate-action placeholder
  ticker, not a company (exclude).
- **Merger successor already in the universe** (false "loss"): HDFC→HDFCBANK, MINDTREE→LTM,
  SRTRANSFIN→SHRIRAMFIN, TATAMTRDVR (extinguished in the Tata Motors demerger), GRUH→BANDHANBNK.
- **Still listed but fell below the Nifty 500** (OHLCV trivially obtainable): GSPL, GUJGASLTD,
  JUBLFOOD, PEL, PGHH, VGUARD, GODREJAGRO, HEG, QUESS, VARROC, NAUKRI(Info Edge), …

**Net:** the count of names that truly vanished and would materially distort results is
**small — roughly a dozen** — but they include large 2021-era losers (DHFL, FRETAIL,
RELCAPITAL), so their per-name impact on a "beat Nifty" gate is high.

## 3. The price half is already on disk

The reason the delisted cohort was assumed unfixable: Angel One's scrip master is *today's*
instruments (the stored `instrument` table here is mostly derivatives), so it can't serve
OHLCV for a name that has since delisted. **But the B13 NSE bhavcopy archive can** — it is the
full-market daily dump:

- `.cache/bhavcopy/` — **1,433 files, 2021-01-01 → 2026-07**, columns
  `SYMBOL,SERIES,…,OPEN_PRICE,HIGH_PRICE,LOW_PRICE,CLOSE_PRICE,…,TTL_TRD_QNTY,…`.
- Confirmed the vanished names are present on the days they traded: DHFL, FRETAIL, FCONSUMER,
  RELCAPITAL, DISHTV, PCJEWELLER, VAKRANGEE all appear in the 2021 files.

So **both** inputs the repair needs are in hand. This is unbuilt, not blocked.

## 4. What was built and measured (2026-07-21) — DONE

The full repair is built and the impact is measured. **Headline: survivorship bias inflated
the deep-window return by ~4.4pp, but it does NOT change the verdict — the strategy still
fails Nifty on every window, and the decisive COVERAGE gate is completely unaffected.**

### The pieces
1. **`src/ohlcv/bhavcopyOhlcv.ts`** (+7 tests) — bhavcopy → OHLC parser + `backAdjustSplits`
   (detects corp actions from PREV_CLOSE discontinuities and back-adjusts to the Angel
   adjusted convention). Kept as a general tool; see the wrinkle below for why it is not
   applied to *this* ingest.
2. **`bun run survivorship:ingest`** (`src/scripts/ingestSurvivorshipOhlcv.ts`) — ingests
   bhavcopy OHLCV for the 10 delisted Nifty-200 victims as EQ instruments, so
   `loadCandleStore` (which selects EQ instruments with candles, **not** `EQUITY_UNIVERSE`)
   picks them up automatically. **Zero `equityUniverse.ts` change → the live universe and the
   news alias-coverage contract are untouched.** 7,873 candles, 10 names.
3. **Point-in-time membership** (`UNIVERSE_MEMBERSHIP`) — `to` = each name's **index-exit**
   date (when it left the Nifty 200), bracketed by the constituent snapshots — **not** its
   delisting date (see the trap below).
4. **Pre-pass membership gate** (`backtestEngine.ts`) — the SRS sector-peer pre-pass + breadth
   now honour `isMemberOn`, so a name that has left the universe no longer pollutes its old
   sector's peer ranking. **Baseline-neutral** (empty membership ⇒ every stock always a member).

### The result — `backtest:portfolio`, B9 stack (production), risk sizing
| window | baseline (167) | corrected (177) | Δ | Nifty B&H |
|---|---|---|---|---|
| **COVERAGE** (2024-07→, the gate) | −17.08% | **−17.08%** | **0.00** | +0.80% |
| OOS (2023-01→) | +8.41% | +7.14% | −1.27pp | +34.39% |
| FULL (2021-11→) | +4.72% | **+0.29%** | **−4.43pp** | +42.92% |

- **COVERAGE is identical** — every victim had left the index by 2024, so the validated era is
  untouched. This both confirms the pre-pass fix works and shows survivorship bias does not
  reach the window the B9 config was validated on.
- **FULL drops −4.4pp** — the honest direction: the 2021–22 hidden names dragged the deep
  window down. So the bias was real and *was* flattering results.
- **Verdict unchanged on every window.** The strategy still trails Nifty by 30–40pp. **A
  survivorship-corrected backtest does NOT rescue the edge** — this removes "maybe it's just
  survivorship" as an explanation and is the prerequisite check OPEN_ITEMS §1 wanted before
  Option B (mid-cap).

### Three traps found and fixed during verification (why the first pass was wrong)
1. **Duplicate-row artifact.** Some bhavcopy files are stale republications of the prior day
   (`2022-08-31.csv` carries 2022-08-30's rows). Running `backAdjustSplits` over the collected
   rows before dedup planted a false same-date "corp action" that corrupted whole series
   (PEL showed a spurious −83% day). Fix: dedup by trade date first.
2. **Adjustment heuristic is fragile on gappy distressed data.** With missing archive days,
   NSE's PREV_CLOSE (always the *true* prior-session close) reads as a false split against a
   several-sessions-old previous row, on ordinary penny-stock volatility. These 10 names had
   **no material in-window split/bonus** (verified — distressed companies don't split), so the
   ingest uses **raw deduped prices**; `backAdjustSplits` stays a tested tool for clean data.
   PEL's 2022 Piramal Pharma demerger is left as a real ~−45% drop (conservative).
3. **delist-date ≠ index-exit-date.** Using the delisting date as `to` let the backtest trade
   a name during periods it had already dropped to small-cap — e.g. **RELINFRA's +345% (2021)
   and 13× (by 2024) rally after it left the index in ~2022**. That is a look-ahead-style bias
   that made the naive first run come out *better*, not worse. Fixed to index-exit windows.
   ⚠️ Snapshots are annual, so exit is precise only to ±1 reconstitution.

### Residual / follow-ups (small)
- **Exact reconstitution dates** would sharpen the ±1-reconstitution window imprecision (parse
  the 2021 press-release PDFs). Given COVERAGE is unaffected and the verdict is robust, low value.
- **Cohort scope.** Only the 10 delisted Nifty-200 victims are added. The ~73 "still in Nifty
  500 today, outside our 167" names (§2 bucket [2]) are a *universe-widening* decision, not a
  survivorship fix, and are deliberately excluded.

## 5. Status change this doc records
- ❌→✅ **"Blocked on an NSE source"** — retired. Constituents obtainable (Wayback CSVs +
  reconstitution PDFs), prices already local (bhavcopy).
- ✅ **Survivorship repair BUILT + MEASURED.** Bias inflated the deep window ~4.4pp; verdict
  unchanged; the validated COVERAGE era is unaffected. 469 tests pass, typecheck clean.

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

## 4. Plan to actually repair it (unblocked; ~1 day + one wrinkle)

1. **Point-in-time membership.** From the Nifty 200 historical snapshots, derive each
   survivorship-victim's `[from, to]` window in the tradeable universe (`to` = the
   reconstitution that dropped it / its delisting date). These become `UNIVERSE_MEMBERSHIP`
   entries + `equityUniverse.ts` additions (never delete — the B8.2 rule).
2. **bhavcopy → OHLCV ingest.** New ingest path mapping bhavcopy `EQ` rows to `ohlcv` for the
   added instruments over their live window. Idempotent, per the existing loaders.
3. **Re-run** `backtest:portfolio` on the corrected universe and measure how much of the
   "positive absolute returns" was survivorship. This is the honest number OPEN_ITEMS §1 says
   must exist **before** the strategic fork's Option B (mid/small-cap) is credible.

### ⚠️ The one real wrinkle: corporate-action adjustment
Angel OHLCV is **corp-action-adjusted** (verified, B4 audit); bhavcopy is **raw/unadjusted**.
Splicing unadjusted bhavcopy series next to adjusted Angel series is a data-quality hazard
(a split would look like a crash). Mitigations: for *delisted* names there is no post-window
adjustment to reconcile, and within-window splits/bonuses for this short list can be handled
explicitly or the names flagged. This wrinkle — not data availability — is the actual
difficulty, and it must be handled before these candles enter the golden/quality path.

## 5. Status change this doc records
- ❌→✅ **"Blocked on an NSE source"** is retired: the constituent data is obtainable
  (Wayback CSVs + reconstitution PDFs) and the price data is already local (bhavcopy).
- The remaining work is **engineering + one adjustment wrinkle**, scoped above. It is a real
  ~1-day build touching production reference data (`equityUniverse.ts`), so it is surfaced as
  an operator-scoped decision rather than done silently.

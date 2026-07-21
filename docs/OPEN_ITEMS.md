# QuantSwing — Open Items & Known Limitations

> **The single place for "what's left and what's not true yet."** Findings and completed
> work live in their own docs (see [`ROADMAP_CHECKLIST.md`](./ROADMAP_CHECKLIST.md)); this
> doc is only the *open* tail — remaining tasks (prioritised) and the honest limitation
> list. Updated 2026-07-20.
>
> **One-line state:** a complete, reproducible, honestly-measured signal factory running
> nightly (B9 stack, `w-68f83d8edbf9`) with a versioned + raw-retained + thrice-backed-up
> archive. **No benchmark-beating edge** — five independent research lines say so. The
> highest-value next input is *calendar time*, not more code.

---

## 1. The strategic fork (this is the real decision)

Five methodologically independent studies — factor floors (B5/B7), slot allocation (B11),
event typing (B12), delivery % (B13), holding horizon (B14) — **all** conclude the same
thing: every lever trims the *left* tail; nothing finds large winners; the strategy does
not beat Nifty risk-adjusted at any horizon/allocation/event/data tried within the
free-data constraint. B12 pinned *why*: we can type *that* earnings were filed but never
*whether they surprised* — surprise needs paid consensus estimates.

So the next direction is a **choice, not a task**:

| option | what it is | odds / cost |
|---|---|---|
| **A. Consolidate + wait** *(current)* | Stop hunting edge; let the archive accrue; revisit ~Jan 2027 when the live-only sentiment tier is backtestable. | Near-zero cost; the only genuinely *new* information source. Chosen 2026-07-20. |
| **B. Mid/small-cap universe** | Large caps are the most efficiently priced segment; free-data inefficiency is likelier down-cap. | Moderate odds. Real cost: new universe curation, thinner liquidity, **worse survivorship** (see L3). |
| **C. Buy consensus estimates** | Unlocks earnings-surprise / PEAD — the one documented effect at this horizon we structurally cannot see. | Highest odds of working. A recurring-cost decision, not engineering. |
| **D. Accept as decision support** | Freeze research; keep the nightly factory running as-is. | A legitimate end state, not a failure. |

Full argument: [`DELIVERY_STUDY.md`](./DELIVERY_STUDY.md) §4 · [`HORIZON_STUDY.md`](./HORIZON_STUDY.md) §6.
**Durable finding to carry into B or C:** ~30-day horizon with risk sizing (not 7d) — the
only portfolio-level survivor of B14.

---

## 2. Open engineering tasks (prioritised)

None of these are blocking; the system runs without them. Ordered by value-per-effort.

### High value, low effort
- [ ] **De-confound `INSIDER_PLEDGE`** *(hours)* — the B12 event bucket mixes scheduled
      "Closure of Trading Window" notices (a calendar artifact, cluster pre-earnings) with
      real SAST/PIT/pledge disclosures. Split them in `src/events/classify.ts` and re-run
      `events:study`. Rescues or honestly kills B12's single strongest cell (+0.82 @10d).
- [ ] **Backup: escape single account/region** *(hours)* — backups now sit in S3 (B15) but
      one AWS account, one region (ap-south-1). Cross-region replication or an occasional
      pull to non-AWS storage closes it. Low marginal value (~40 MB/day the workstation
      also holds), but cheap.

### Medium value, medium effort
- [ ] **Historical index-constituent data (survivorship)** *(days; blocked on a source)* —
      the backtest universe is *today's* 166 names replayed into the past (L3). The
      forward-looking fix exists (`UNIVERSE_MEMBERSHIP`, B8.2); repairing history needs NSE
      index-change records, which sit behind a JS/WAF page that resisted fetching. **Must be
      revisited before B or the mid-cap move**, since down-cap survivorship is worse.
- [ ] **Salience / two-tier symbol tagging** *(days)* — the mapper is precision-first, so
      per-stock article counts undercount (L4). A `symbols_loose` tier (bare tickers, group
      words) stored *separately* from the strict tier would let research measure whether
      loose tags add signal, without polluting the strict factor.

### Only if a strategic option (B/C) is taken
- [ ] **B9 joint rerun with accrued history** — re-decide the fundamental floor / sentiment
      bucket once the live sentiment tier is backtestable (~Jan 2027). Gated on calendar.
- [ ] **B10 paper trading** — 🔒 hard-gated on the portfolio backtest beating Nifty
      risk-adjusted OOS. Currently failed by ~4–10pp/yr. Do **not** start before that clears.
- [ ] **Event/outcome research substrate & entity graph** — the architecture review's
      Gold layer (`event`, `event_outcome`, `event_stats`, time-bounded `entity_edge`).
      Large; only justified if events become a real signal source (B12 says not yet).

---

## 3. Known limitations (the honest list)

Grouped. These are *current* — items the research program has closed are struck from here
and recorded in their own docs.

### Alpha / edge (the ones that matter)
- **L1 — No benchmark-beating out-of-sample edge.** The central fact. Best jointly-selected
  strategy (B9 stack): signal-edge OOS −0.04/PF 0.97; portfolio trails Nifty on every
  validated window. Five independent negatives (§1).
- **L2 — Free-data ceiling on the highest-value catalyst.** Earnings *surprise* (PEAD) is
  the most documented effect at this horizon and we structurally cannot see it without paid
  consensus estimates (B12 §4). "Results happened" is not a signal.
- **L3 — Composite has no ranking power (ρ≈0).** Confirmed from two sides: attribution
  (Step 1) and slot allocation (B11 — the composite ranking loses to a *seeded coin flip*).
  The working levers are tail-trims, not rankings; learned weighting stays deferred.

### Data
- **L4 — Sentiment live tier is ~days old.** The only tier immune to reconstructed-timestamp
  doubt (`fetchedAt` = truth) started 2026-07-18; backtestable ~6 months later. Backfilled
  rows (GDELT/BSE) carry *reconstructed* `availableAt` — weaker evidence, hence per-origin
  evaluation everywhere.
- **L5 — Survivorship bias in the archive & backtest.** Universe = today's constituents.
  Partially addressed forward (B8.2); the pre-2024 past is unrepaired (§2, blocked on data).
- **L6 — Coverage skew + recall sacrifice.** Precision-first mapping undercounts thinly-
  covered names; sentiment biases toward large caps. Deliberate (precision > recall), a
  documented trade, not an accident.
- **L7 — Headline-level FinBERT.** Bodies are absent/boilerplate; occasional misreads
  ("shares tank as SEBI probes" → weakly positive) are averaged over, not fixed per-article.
- **L8 — Raw capture is forward-only (B16).** The Bronze layer retains raw payloads *from
  2026-07-20 on*; the 173k historical rows' payloads were discarded at ingest and cannot be
  recovered — inherent to adding a Bronze layer late.

### Method / measurement
- **L9 — Cost sensitivity.** Everything degrades ~7–12pp at 2× costs; only strategy
  *ordering* is cost-robust, not levels. A short-horizon signal fights a 0.25% round trip.
- **L10 — Short validation history.** Deep window is 5.5yr but the archive-dependent levers
  only span ~2yr / one market-cycle family; folds are few. Method is right; sample is not
  yet institutional. (This is what calendar time fixes.)
- **L11 — Single ₹2L book, no market-impact model** in the portfolio simulator; trade paths
  are book-independent. Conservative, but not a live-fill estimate.

### Operations / infrastructure
- **L12 — t3.small is CPU- and disk-constrained.** Burstable CPU throttles to ~40% at zero
  credits (froze SSH ~4× this program); 12 GB free disk. Standing rule: heavy jobs on a
  workstation, box does capture + nightly. A bigger instance is a cost decision.
- **L13 — Source fragility.** All feeds are free, unofficial, revocable endpoints
  (Moneycontrol froze silently; Screener IP-blocked; BSE params from a devtools capture).
  Detected (FROZEN alerts, zero-parse tripwires), not preventable.
- **L14 — Backups: single AWS account/region** (§2). Small residual.

### Closed since the architecture review (kept here as pointers, not open)
- ✅ Raw-payload retention → B16 · ✅ Unversioned entity resolution → B15 (`aliasVersion`) ·
  ✅ No backups / console-only ops → B15 + `ingest_run` alerts · ✅ Corp-action adjustment
  consistency → verified 2026-07-18 · ✅ Slot-allocation ranking → B11 (measured, closed).

---

## 4. What to do next, in one line

**Nothing urgent.** The system runs nightly; the archive is versioned, raw-retained, and
backed up in three places; it accrues automatically. Pick up a §2 task if you want to keep
hardening, or make the §1 strategic call — but the highest-return "action" right now is to
let the sentiment clock run to ~January 2027 and re-measure with genuinely new data.

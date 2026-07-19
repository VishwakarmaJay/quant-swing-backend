# GDELT Symbol-Mapping Precision Fix (validation-gate finding, 2026-07-19)

> **Status:** 🟡 IN PROGRESS · owner: news-archive track · does **not** block B7 (which
> starts on the clean `LIVE_* + BSE_BACKFILL` subset). This is a data-quality fix in the
> news-archive derivation layer only — no prices, factors, or live behaviour are touched.
>
> **Live progress log at the bottom — updated as each step lands.**

---

## 1. The issue in one line

The GDELT media backfill tags ~20% of articles to the **wrong** company (BRITANNIA ~50%
wrong), because the GAL bulk download let **global English news** in and single-common-word
company aliases collide with foreign places, ships, shows, and phrases.

## 2. How it was found

The **validation gate** (run before B7 builds on the archive) sampled mapped symbol tags:

| Origin | Precision on audit | Verdict |
|---|---|---|
| **BSE_BACKFILL** (57,025 rows) | 15/15 = **100%** | ✅ clean |
| **GDELT** (114,859 rows) | ~80% random sample; BRITANNIA ~50% | ❌ **fails the ≥90% gate** |

Concrete false positives seen in the sample:

- `"A55 Britannia Bridge closed due to Storm Éowyn"` (a road in Wales) → **BRITANNIA**
- `"New Netflix shows filmed in … Britannia Beach"` (Canada) → **BRITANNIA**
- `"P&O Cruises Says No Compensation After Britannia Breakdown"` (a cruise ship) → **BRITANNIA**
- `"If You Could Only Own One Britannia - Coin Community Forum"` (a gold coin) → **BRITANNIA**
- `"Colgate Rochester Crozer Divinity School relocates"` (a US school) → **COLPAL**
- `"'Lupin' Writer Tony Saint…"` (the Netflix show) → **LUPIN**
- `"NY AG Letitia James indicted on federal bank fraud charges"` (a crime) → **FEDERALBNK**

## 3. Root cause

The DOC-API backfill path constrained queries to `sourcecountry:IN sourcelang:eng`. The
**GAL bulk downloader dropped the country constraint** and filtered only by `lang=en`
(`src/scripts/downloadGalArchive.ts`). Result: English news from everywhere (UK, US,
Canada) entered the match set, and aliases that are unambiguous *in Indian financial
coverage* — "britannia", "lupin", "colgate", "federal bank" — collide with common English
usage globally.

Two independent failure surfaces (so the fix needs two levers):
1. **Foreign-domain articles** (cruise news, Welsh transport, Ipswich football) → fixed by
   **domain filtering**.
2. **Homonym aliases** that collide even within Indian coverage (an Indian site reviewing
   "Lupin" the show) → fixed by **tightening the aliases**.

BSE is immune: it is Indian-exchange-only and anchors on `SLONGNAME` (the filer's legal
name) in the body.

## 4. Why it matters (impact if left unfixed)

Symbol tags feed the future **SentimentFactor (B7)**. A wrong tag files an irrelevant
article under a stock, its FinBERT score enters that stock's sentiment aggregate, and the
factor then makes buy/skip calls partly on Welsh storms and Netflix shows. Failure modes:
signal dilution (real edge muffled → false negative), directional bias (systematic wrong
push), timing corruption (a UK-news date drives an Indian-stock signal), and — worst —
**backtest self-deception** (a spurious edge that won't generalise). It is uneven and
hidden: RELIANCE ~0% polluted, BRITANNIA ~50%, and the code runs fine either way.

**Not a live bug:** nothing trades on this today; the damage is latent and only activates
if B7 consumes unfiltered GDELT. Fully reversible — `symbols[]` is a derived column, and
every row is `origin`-tagged.

## 5. Sentiment scores are NOT affected

FinBERT scores the article *text*, independent of which symbol it is tagged to. The fix
rewrites `symbols[]` only; `sentimentScore/label/scoredAt` are untouched and need **no
re-scoring**. This is why the overnight scoring pass can run to completion regardless of
this fix.

## 6. The fix — steps

Two levers (domain + alias) + verify. `[ ]` → pending, `[x]` → done (see log).

- [ ] **S1 — Indian-domain allowlist.** From the GDELT domain-frequency data, allowlist the
      Indian financial/news outlets (ET, Moneycontrol, Hindu BusinessLine, LiveMint,
      BusinessToday, Financial Express, TOI, news18, equitybulls, …); the foreign tail is
      out-of-scope. Trade-off accepted: lose some legit foreign coverage of Indian stocks
      (Reuters/Bloomberg on Reliance) — small vs the noise removed; precision is the gate.
- [ ] **S2 — Tighten toxic aliases.** Audit every single-common-word alias for homonym risk.
      Known offenders: Britannia → require "britannia industries"; Lupin → "lupin
      pharma"/"lupin ltd"; Colgate → "colgate-palmolive"/"colgate india"; add an
      `ALIAS_EXCLUSIONS` rule so "federal bank" does not match crime phrases
      (fraud/charges/robbery). Same B3 growth-loop (audit → tighten → remap).
- [ ] **S3 — Unmap, don't delete.** GDELT rows failing the filters (non-allowlisted domain,
      or a now-tightened alias no longer matching) get `symbols = []` — invisible to
      per-stock research but retained, `origin`-tagged, reversible (respects the
      never-delete / version-the-derivation creed).
- [ ] **S4 — Remap the archive.** Re-run `news:remap` with the tightened dictionary over all
      rows: false positives drop to unmatched, legitimately-missed tags get picked up.
      Non-destructive (rewrites `symbols[]` only). BSE/live rows unaffected.
- [ ] **S5 — Re-audit + re-close the gate.** Fresh random sample + targeted spot-checks on
      the worst names (BRITANNIA, LUPIN, COLPAL, FEDERALBNK). Gate passes at **≥90%**.
      Record before/after precision and rows dropped.
- [ ] **S6 — Fix the downloader for the future.** Add the domain filter to
      `downloadGalArchive.ts` so a future GAL re-run/extension does not re-introduce the
      problem.

## 7. Sequencing (agreed 2026-07-19)

- **Now (day):** code changes — S1 allowlist + S2 aliases + S6 downloader. Zero box CPU
  load; safe alongside the running scoring pass.
- **Overnight:** the FinBERT scoring pass finishes on its own (~72k GDELT rows, ~465
  rows/min). Untouched by this fix.
- **After scoring completes (quiet box):** apply S3 unmap + S4 remap, then S5 re-audit.
  Sequenced *after* scoring so two CPU-heavy jobs never collide on the 0-credit t3.small
  (the cause of three freezes on 2026-07-18/19 — see `DEPLOYMENT_AWS.md` §1).

## 8. Definition of done

GDELT symbol tags clear **≥90%** on a fresh audit; the worst-offender names verified;
`downloadGalArchive.ts` domain-filtered; this doc's steps all checked; B7 can consume the
`origin=GDELT` subset as a media overlay (until then B7 uses `LIVE_* + BSE_BACKFILL` only).

---

## Progress log

- **2026-07-19** — Finding raised by the validation gate. BSE 100% / GDELT ~80% (BRITANNIA
  ~50%). Root cause = GAL download missing the `sourcecountry:IN` constraint. Plan agreed;
  this doc created. Overnight scoring pass running. **Steps S1–S6 pending.**

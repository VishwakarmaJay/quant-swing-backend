# GDELT Symbol-Mapping Precision Fix (validation-gate finding, 2026-07-19)

> **Status:** ✅ **DONE (2026-07-19)** — all six steps landed; GDELT gate cleared (30/30
> sample, BRITANNIA ~96%). This was a data-quality fix in the news-archive derivation layer
> only — no prices, factors, or live behaviour touched.
>
> **Live progress log at the bottom.**

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

- [x] **S1 — Indian-domain allowlist.** ✅ `src/news/indianDomains.ts` +36 tests. Rule:
      any `.in` ccTLD host OR a curated set of major Indian `.com`/`.org` outlets
      (subdomain- and boundary-safe); everything else is foreign. Grown from the live GDELT
      domain distribution. **Sizing (2026-07-19):** 83,948 Indian rows kept / 30,911 foreign
      to unmap; of mapped GDELT rows, 75,880 kept · **29,792 false tags to drop** (~28%,
      matching the audit's estimate). Shared by S3 (unmap) and S6 (downloader).
- [x] **S2 — Homonym guards (re-scoped on evidence).** ✅ Sampling Indian-domain-only rows
      showed the domain filter (S1) already lifts the suspects to ~95-100% on Indian
      coverage — BRITANNIA ~95% (only a Mumbai "Britannia & Co" restaurant + a Britain
      litchi headline residual), COLPAL ~100%, FEDERALBNK ~100% (the "federal bank fraud"
      false positive was a US-news foreign domain, S3-removed). So **stripping bare aliases
      was rejected — it would cost real recall for ~0 precision gain.** Instead added
      surgical `ALIAS_EXCLUSIONS` (zero-recall-cost negative lookaheads) for the exact
      homonym phrases from the audit: `britannia` +beach/bridge/stand/coin/cruise/…;
      `lupin` +writer/series/season/thief/…; `colgate` +university/divinity/rochester/…;
      `federal bank` +fraud/charges/robbery/indicted. +symbolMapper tests; 328 pass.
- [x] **S3 + S4 — Domain-aware remap (one pass).** ✅ S3 and S4 CANNOT be separate passes —
      both write `symbols[]`, so a naive S4 remap would re-tag the foreign rows S3 cleared.
      Folded into `news:remap` (`remapSymbols.ts`): `symbols = (GDELT && !isIndianNewsDomain)
      ? [] : mapArticleSymbols(...)`. Rows retained (`origin`-tagged, reversible). Applied on
      the box (scoring stopped to avoid CPU collision): **172,856 scanned · 24,671 false tags
      removed** (24,668 foreign-domain GDELT + 3 Indian-domain homonyms — confirming the
      domain filter is ~all of it). GDELT mapped: 105,672 → **81,001**.
- [x] **S5 — Re-audit: GATE CLEARED.** ✅ Fresh GDELT sample **30/30 correct** (LUPIN now
      shows the pharma article, not the show). BRITANNIA re-audit **~96%** (23/24, up from
      ~50%; sole residual = an Indian locality "Britannia Nagar"). COLPAL/FEDERALBNK verified
      clean pre-fix on Indian domains. **GDELT ≥90% — passes.** BSE_BACKFILL stays 100%.
- [x] **S6 — Downloader domain-filtered.** ✅ `downloadGalArchive.ts` now drops any record
      whose URL fails `isIndianNewsDomain` before the alias match — restoring the DOC API's
      `sourcecountry:IN` at the source, so a future GAL re-run/extension never re-introduces
      the problem. 328 tests pass, typecheck clean.

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
- **2026-07-19** — ✅ **S1 done.** Built `src/news/indianDomains.ts` (`isIndianNewsDomain`,
  `domainOf`) + `indianDomains.test.ts` (36 tests, incl. the real false-positive domains
  — thecolgatemaroonnews.com, screenrant/collider, cruise/coin/football, marketscreener,
  Yahoo, tickerreport spam — all blocked; ET/Moneycontrol/`.in`/subdomains allowed;
  boundary-safe). Typecheck clean. Impact measured on the live archive: **27% of GDELT
  rows are foreign-domain (30,911); 29,792 currently-mapped rows will lose their false
  tags** in S3. Domain lever confirmed to catch the bulk of the pollution.
- **2026-07-19** — ✅ **S2 done.** Evidence changed the plan: Indian-domain-only samples
  showed BRITANNIA ~95% / COLPAL ~100% / FEDERALBNK 100% — the homonym false positives were
  overwhelmingly foreign-domain (S3's job), so aggressive alias-stripping was **rejected**
  as a recall-for-nothing trade. Added surgical zero-recall-cost `ALIAS_EXCLUSIONS`
  (britannia/lupin/colgate/federal-bank + their homonym-follow words) as a defensive second
  line. 328 tests pass, typecheck clean.
- **2026-07-19** — ✅ **S3+S4+S5+S6 done — FIX COMPLETE.** Folded S3/S4 into a domain-aware
  `news:remap` (can't be separate — both write `symbols[]`); applied on the box with
  scoring stopped to avoid CPU collision. **24,671 false tags removed** (24,668 foreign +
  3 homonyms); GDELT mapped 105,672 → 81,001. **S5 re-audit: 30/30 sample, BRITANNIA ~96%
  (was ~50%) — gate CLEARED.** S6: `downloadGalArchive.ts` now domain-filters at the source
  so future sweeps stay clean. Overnight scoring to be resumed (symbol-agnostic — the fix
  touched no scores). **B7 may now consume the `origin=GDELT` subset as a media overlay.**

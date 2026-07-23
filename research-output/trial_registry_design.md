# Trial Registry — Design

**Status:** design only. No code exists. Review before implementation.
**Write zone:** `prisma/**`, `src/research/**`, `src/scripts/runMeasurement.ts` (Claude Code).
**Day convention:** trading days throughout, inherited from `forwardLabels.ts`. The registry stores horizons as integers and never converts them.

---

## 1. What this is for

`AI_CONTEXT.md` lists the trial registry as blocking all new research. It exists to enforce four invariants that are currently promises in a markdown file:

| Invariant | Today | With the registry |
|---|---|---|
| 2 — nothing runs unregistered | honour system | `runMeasurement` refuses to execute without a sealed trial |
| 3 — nulls are first-class | nulls live in a CSV nobody indexes | every sealed trial is a row, measured or not; the denominator is a `COUNT(*)` |
| 4 — realized sign vs pre-registered sign | done by eye | `signMatch` is a stored, computed column |
| 5 — results immutable | files get overwritten | append-only tables + DB-level trigger; a re-run is a new experiment |

It is **not** a feature store, not a scheduler, and not a results browser. It is the smallest thing that makes pre-registration mechanically true.

The design premise is the one stated in `AI_CONTEXT.md`: *the failure mode this project has already experienced is correct code implementing the wrong estimand, and it passed review for months.* A registry enforced only in application code is the same class of guarantee that already failed. Enforcement therefore lands in the database.

---

## 2. Entity model

Five tables. Sketch follows existing schema conventions (`String @id @default(uuid())`, `@@map` to snake_case, `///` docstrings).

### 2.1 `FeatureVersion` — identity, not name

Implements the *version everything* invariant: identity is `hash(code + config + input versions)`, so renaming is free and a logic change creates a new factor that cannot inherit a track record.

```prisma
/// Immutable identity of a computable feature. `identityHash` is the factor's
/// true name; `name` is a label and may be reused across versions.
model FeatureVersion {
  id            String   @id @default(uuid())
  name          String
  /// sha256 of the normalized source of the feature's compute function.
  codeHash      String
  /// sha256 of canonical-JSON config (params, windows, encodings).
  configHash    String
  /// Upstream data versions this feature reads, e.g.
  /// { "ohlcv": "2026-07-17", "universe": "v3", "sector": "nonPIT-v1" }.
  inputVersions Json
  /// sha256(codeHash + configHash + canonical(inputVersions)). THE factor identity.
  identityHash  String   @unique
  createdAt     DateTime @default(now())

  trials        Trial[]
  experiments   Experiment[]
  @@index([name])
  @@map("feature_version")
}
```

`inputVersions` deliberately includes `sector`. The sector field is a known live lookahead (`AI_CONTEXT.md` traps). Recording `"sector": "nonPIT-v1"` means that when it is fixed, every factor touching sector automatically gets a new identity and **cannot silently inherit its old track record**. That is the invariant doing real work.

### 2.2 `Trial` — the pre-registration

```prisma
/// A pre-registered hypothesis. DRAFT is mutable; SEALED is immutable and is the
/// only state from which an Experiment may run. Every sealed trial counts toward
/// the multiplicity denominator whether or not it is ever measured.
model Trial {
  id                String      @id @default(uuid())
  /// Matches the spec filename, e.g. "FS-001-overnight-return".
  slug              String      @unique
  featureVersionId  String?
  title             String

  // ── hypothesis (AGENTS.md spec format) ──
  mechanism         String      // what is mispriced
  agent             String      // who creates it and why they act that way
  persistence       String      // why it isn't arbitraged away
  decayHorizon      String

  // ── pre-registration ──
  expectedSign      Int         // +1 | -1. No zero: "no view" is not a hypothesis.
  expectedHorizons  Int[]       // trading days
  expectedICOrder   Float       // order of magnitude, e.g. 0.02
  falsification     String      // what result would kill this
  /// The promotion bar AS OF sealing, snapshotted. The bar is a contract that
  /// must not weaken, and snapshotting makes any drift auditable rather than silent.
  barSnapshot       Json

  status            TrialStatus @default(DRAFT)
  provenance        Provenance  @default(PRE_REGISTERED)
  /// sha256 over canonical JSON of every field above. Tamper detection.
  sealHash          String?
  sealedAt          DateTime?
  abandonedReason   String?

  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt

  featureVersion    FeatureVersion? @relation(fields: [featureVersionId], references: [id])
  experiments       Experiment[]
  @@index([status, sealedAt])
  @@map("trial")
}

enum TrialStatus { DRAFT SEALED ABANDONED }
enum Provenance  { PRE_REGISTERED EXPLORATORY PRE_REGISTRY }
```

`expectedSign` is `Int`, not nullable. A proposal that cannot commit to a direction is not falsifiable, and `AGENTS.md` already rejects it at the spec stage.

### 2.3 `Experiment` — one execution, append-only

```prisma
/// One execution of a measurement. A re-run NEVER updates this row — it inserts a
/// new one. Immutable once status is MEASURED or FAILED.
model Experiment {
  id                String   @id @default(uuid())
  /// NULL only when provenance = EXPLORATORY.
  trialId           String?
  featureVersionId  String
  provenance        Provenance

  startedAt         DateTime
  finishedAt        DateTime?
  status            ExperimentStatus @default(RUNNING)

  // ── reproducibility ──
  harnessVersion    String   // git sha of src/research at run time
  seed              Int      // statistics.ts PRNG seed; determinism invariant
  /// Panel spec: date range, universe, horizons, labelTypes, weightings, regimes.
  panelSpec         Json
  /// Control-suite results for THIS run. Invariant 1 — results are rejected if absent.
  controlResults    Json
  controlsPassed    Boolean

  /// sha256 over the ordered result rows. Detects post-hoc edits.
  resultsHash       String?

  trial             Trial?   @relation(fields: [trialId], references: [id])
  featureVersion    FeatureVersion @relation(fields: [featureVersionId], references: [id])
  results           ExperimentResult[]
  deciles           ExperimentDecile[]
  adjudication      Adjudication?
  @@index([trialId, startedAt])
  @@map("experiment")
}

enum ExperimentStatus { RUNNING MEASURED FAILED }
```

### 2.4 `ExperimentResult` — the IC cells

One row per cell. Columns mirror `rank_ic.csv`'s existing header exactly, so the 810 measured cells import without reshaping and the CSV stays a projection of the table rather than a separate truth.

Values are the **codes the harness actually emits** (`fwd | xs | resid`), not the prose names in `AI_CONTEXT.md` ("raw / excess / residualized"). Storing prose names would require a translation layer that could drift.

```prisma
/// One measured rank-IC cell. Insert-only; no updates, ever.
model ExperimentResult {
  id               String  @id @default(uuid())
  experimentId     String
  subject          String  // factor name or 'composite'
  labelType        String  // fwd | xs | resid
  horizon          Int     // TRADING days
  /// Always 'EW'. Rank IC is a Spearman correlation and is inherently unweighted;
  /// the weighting dimension is meaningful only for decile spreads
  /// (runMeasurement.ts:19-20). Retained so the CSV projection stays 1:1.
  weighting        String
  regime           String
  meanIC           Float
  stdIC            Float
  icIR             Float
  tStat            Float
  neweyWestTStat   Float
  nDates           Int

  experiment       Experiment @relation(fields: [experimentId], references: [id])
  @@unique([experimentId, subject, labelType, horizon, weighting, regime])
  @@index([subject, horizon])
  @@map("experiment_result")
}
```

### 2.4b `ExperimentDecile` — the decile cells

The promotion bar requires **monotone decile spread** and **holds in both EW and VW**. Neither is checkable from `ExperimentResult` above — both live in `quantile_spread.csv`. Modelling only the IC cells would leave two of the six bar clauses unverifiable from the registry, so the decile grid is a first-class table.

```prisma
/// One decile cell. Mirrors quantile_spread.csv. Insert-only.
/// This is where the bar's monotonicity and EW-vs-VW clauses are adjudicated.
model ExperimentDecile {
  id            String @id @default(uuid())
  experimentId  String
  subject       String
  labelType     String // fwd | xs | resid
  horizon       Int    // TRADING days
  weighting     String // EW | VW — meaningful here
  regime        String
  decile        Int
  nObs          Int
  meanRet       Float
  medianRet     Float

  experiment    Experiment @relation(fields: [experimentId], references: [id])
  @@unique([experimentId, subject, labelType, horizon, weighting, regime, decile])
  @@map("experiment_decile")
}
```

### 2.5 `Adjudication` — the verdict, including nulls

```prisma
/// Post-measurement verdict. Written once per experiment. A null is archived
/// identically to a pass — same table, same required fields.
model Adjudication {
  id             String    @id @default(uuid())
  experimentId   String    @unique
  /// Sign actually realized at the pre-registered primary horizon.
  realizedSign   Int
  /// realizedSign == trial.expectedSign. FALSE with a cleared bar is the
  /// "works with the wrong sign" red flag, not a discovery.
  signMatch      Boolean
  clearedBar     Boolean
  verdict        Verdict
  notes          String
  adjudicatedAt  DateTime  @default(now())

  experiment     Experiment @relation(fields: [experimentId], references: [id])
  @@map("adjudication")
}

enum Verdict { PASS NULL_RESULT WRONG_SIGN INCONCLUSIVE }
```

`WRONG_SIGN` is a distinct verdict from `PASS` even when the bar is numerically cleared. That is invariant 4 made non-bypassable: you cannot record a wrong-signed win as a win.

---

## 3. Lifecycle

```
Trial:       DRAFT ──seal()──> SEALED ──┬──> (0..n Experiments)
                                        └──abandon()──> ABANDONED
                                                        (still in denominator)

Experiment:  RUNNING ──> MEASURED ──> Adjudication
                     └─> FAILED (controls failed / crash; results discarded)
```

`seal()` computes `sealHash` and stamps `sealedAt`. After that the row is frozen. Abandoning a sealed trial keeps it counted — that is the point of invariant 3.

---

## 4. Immutability enforcement

App-level checks are insufficient here for the reason given in §1. Three layers, in the migration SQL:

1. **Trigger on `trial`** — `BEFORE UPDATE OR DELETE`: raise unless the row is `DRAFT`. Transitions out of `DRAFT` are permitted only via a whitelisted status change with `sealedAt` being set in the same statement.
2. **Trigger on `experiment`** — `BEFORE UPDATE`: allow only `RUNNING → MEASURED|FAILED` with `finishedAt`/`resultsHash` fill-in. Block all `DELETE`.
3. **Trigger on `experiment_result` and `adjudication`** — `BEFORE UPDATE OR DELETE`: raise unconditionally. Insert-only.

Plus a `verifyRegistryIntegrity()` check that recomputes `sealHash` and `resultsHash` and reports drift. It runs in CI alongside the control suite, so tampering fails the build rather than being discovered later.

Prisma does not model triggers, so these live in raw SQL inside the migration. Noting explicitly because it means `prisma migrate diff` will not reproduce them from the schema — they need a migration-level test.

---

## 5. How it gates measurement

`src/scripts/runMeasurement.ts` gains a required `--trial <slug>` argument:

```
bun run research:measure --trial FS-001-overnight-return
```

Order of operations, refusing at the first failure:

1. Load trial by slug → must be `SEALED`, else exit non-zero.
2. Recompute `sealHash` → must match stored, else exit non-zero (tamper).
3. Resolve `FeatureVersion`; compute `identityHash` from current code+config → must match the trial's, else exit non-zero. **This catches the case where the feature was edited after sealing** — the most likely way pre-registration gets quietly broken.
4. Run the control suite. `controlsPassed = false` → write `Experiment` as `FAILED`, discard results, exit non-zero.
5. Insert `Experiment` (`RUNNING`), then results, then flip to `MEASURED` with `resultsHash`.
6. Emit `research-output/*.csv` as today, unchanged, so existing artifacts and consumers keep working.

Step 3 is the one I would not drop. Steps 1–2 stop an unregistered run; step 3 stops a *registered* run measuring something other than what was registered, which is the same wrong-estimand failure this project already had.

### The exploratory escape hatch

A registry with no legitimate way to debug the harness gets bypassed, and a bypassed registry is worse than none because it looks authoritative. So:

`--exploratory` runs without a trial, writes `Experiment.provenance = EXPLORATORY, trialId = NULL`, and its results **cannot be adjudicated** (FK to `Adjudication` requires a trial) and are excluded from every promotion query by default.

This is a deliberate softening of invariant 2 as literally written. Flagging it as such rather than burying it — see open question Q1.

---

## 6. Multiplicity accounting

The `t ≥ 3.0` bar is described as the multiple-testing threshold. For that to stay honest the denominator must be real:

```sql
SELECT count(*) FROM trial WHERE status IN ('SEALED','ABANDONED')
  AND provenance = 'PRE_REGISTERED';
```

Counted: every sealed trial, including abandoned ones and ones never implemented — matching `AGENTS.md` rule 5 ("every proposal is a trial whether it gets implemented or not"). Not counted: exploratory runs and re-runs of the same trial. A re-run is a new `Experiment`, not a new trial; re-running does not multiply the hypothesis count, but it also does not get to cherry-pick, because every run is stored.

If the denominator grows past roughly 50, `t ≥ 3.0` is worth revisiting — the registry makes that a query rather than a guess.

---

## 7. The existing 810 cells

> **Correction to `AI_CONTEXT.md` needed.** It describes the 810 as
> `{raw, excess, residualized} × {EW, VW} × 6 horizons × 5 regime splits`. That product
> is 180, not 810, and `rank_ic.csv` contains no VW rows at all. The actual cell space is
> **9 subjects × 3 labelTypes × 6 horizons × 5 regimes = 810**, weighting fixed at `EW`.
> The count is right and the measurement is right — the stated decomposition is not.
> Per that file's own closing rule, fix it there first.

They were measured before the registry existed, so `AI_CONTEXT.md`'s "post-hoc registration is worthless" applies. Import them as one `Experiment` with `provenance = PRE_REGISTRY` and a synthetic trial per subject marked identically. They keep their evidentiary value as a closed negative result, are queryable, and are permanently distinguishable from anything pre-registered. They do **not** enter the pre-registered denominator.

The two validated data controls (`momentum_12_1`, `reversal_5d`) import the same way but are additionally flagged as controls, since they are harness validation rather than hypotheses under test.

---

## 8. Deliberately out of scope

Feature store, scheduling/orchestration, a UI, cross-trial correlation or redundancy checks (the bar's "incremental to the existing library" clause needs the feature store first), and automatic promotion. Promotion stays a human decision; the registry records it.

---

## 9. Open questions

**Q1 — the exploratory hatch.** §5 softens invariant 2. Alternative: no hatch, and harness debugging runs against a permanently sealed `TRIAL-HARNESS-DEBUG` trial whose results are excluded by convention. Stricter, slightly more friction. My recommendation is the hatch as designed, because the failure mode of the strict version is people running the harness outside the tool entirely.

**Q2 — where the pre-registration text lives.** Trial fields duplicate the `research/proposals/FS-NNN-*.md` spec Codex writes. Options: (a) DB is authoritative, markdown is generated; (b) markdown is authoritative, sealing parses it into the DB; (c) both, with a CI check that they match. I lean (b) — Codex already writes markdown, and the file is the artifact under version control — with the seal step doing the parse so the DB never drifts.

**Q3 — `barSnapshot` granularity.** Snapshot the full bar as JSON (proposed), or reference a versioned `bar_version` row? JSON is simpler; a table is better if the bar ever legitimately changes. I lean JSON until it changes once.

**Q4 — does sealing require the feature to exist?** Proposed: no — a trial can seal with `featureVersionId = NULL` and bind at first run. This lets Codex pre-register the whole tranche before I implement anything, which matches the intended loop. The cost is that step 3 of the gate has nothing to compare against on the first run; it binds instead, and enforces on every subsequent run.

---

## 10. Build order

```
FeatureVersion + identity hashing  →  Trial + seal()  →  DB triggers + integrity check
  →  Experiment + ExperimentResult  →  gate in runMeasurement  →  Adjudication
  →  backfill the 810 cells
```

Each stage: pure functions plus `*.test.ts` alongside, `bun run typecheck` and `bun test` green before the next, per the existing research-layer build discipline. The trigger layer additionally needs a migration-level test that attempts an illegal `UPDATE` and asserts it raises.

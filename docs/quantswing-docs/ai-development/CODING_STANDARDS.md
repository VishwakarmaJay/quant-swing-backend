# Coding Standards

## TypeScript
- Bun runtime; TypeScript strict mode (`strict: true`, `noUncheckedIndexedAccess`); ESM only.
- Value objects: `readonly` interfaces/types + `Object.freeze` at construction;
  discriminated unions where variants are closed (`ApprovedSignal | Rejection`).
- `any` is banned; `unknown` + narrowing at boundaries. Zod parses all external input
  (config, provider responses) into typed objects at the edge.
- Constructor injection via a single composition root (no DI framework, no service
  locators). Classes stateless unless documented.
- Absent values: `T | undefined` at API boundaries with explicit handling; no `null`
  unless a library forces it.
- decimal.js (or NUMERIC-backed strings) for money paths crossing persistence; plain
  `number` acceptable inside pure factor math (document rounding at boundaries).
- No module-level mutable state. Pure helpers as plain exported functions.

## Naming
- Factors: `<Dimension>Factor` (TrendFactor). Services: `<Noun>Service`.
- Config props: kebab-case under `quantswing:` prefix in YAML; camelCase in the parsed config type.
- Files: kebab-case (`trend-factor.ts`). Tests: `<name>.test.ts`,
  golden: `<factor>.golden.test.ts`, integration: `<flow>.it.test.ts`.

## Errors
- Domain errors extend `QuantSwingError`; carry run ID where available.
- Catch at orchestration layer; translate provider errors at ingestion boundary.
- No empty catch; no floating promises (`no-floating-promises` lint rule enforced).

## Logging
- pino, structured fields (`log.info({ candles: n }, "fetched candles")` — never string concatenation).
- No log level above DEBUG inside per-stock loops (150× noise).

## Formatting
- Prettier + ESLint (typescript-eslint strict preset); enforced in CI. No format debates in review.

## Python (finbert-service)
- FastAPI + pydantic models; type hints mandatory; ruff + black; pinned requirements.txt.

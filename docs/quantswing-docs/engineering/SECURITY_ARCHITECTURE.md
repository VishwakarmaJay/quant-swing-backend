# Security Architecture

## Threat model (realistic scope: single-user, self-hosted)
| Threat | Mitigation |
|---|---|
| Credential leak via repo | .env git-ignored from commit 1; pre-commit secret scan (gitleaks) |
| Credential leak via logs | Log scrubbing filter; TOTP secret never logged |
| Broker account takeover | Read-only usage in v1 (no order APIs called); TOTP secret env-only, chmod 600 |
| Injection via scraped news | All external text treated as data; parameterized SQL only (Prisma client / parameterized $queryRaw); never eval'd |
| Malicious RSS/XML payloads | XML parser with DTD/external-entity resolution disabled (XXE-safe); size limits on fetched bodies |
| VPS compromise | UFW SSH-only; app/metrics endpoints localhost-bound; no public endpoints |
| Dependency CVEs | Dependabot + `bun audit` / osv-scanner in CI |
| DB exposure | Least-privilege app user; no superuser; localhost bind |

## Rules
- Secrets: env only. Never DB, never code, never logs, never Telegram messages.
- Telegram chat ID allow-list — bot responds only to configured chat.
- FinBERT sidecar and Redis bind localhost; no external exposure. Redis holds no secrets (jobs + cache only).

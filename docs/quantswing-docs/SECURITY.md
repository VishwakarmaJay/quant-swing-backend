# Security Policy

## Reporting
Report vulnerabilities privately via GitHub Security Advisories. Do not open public issues
for exploitable problems. Response target: 72 hours.

## Scope
- Credential handling (Angel One API key/password/TOTP secret, Telegram token)
- Injection via scraped news content (treat all external text as untrusted)
- Dependency vulnerabilities (Dependabot enabled)

## Non-negotiable rules
- Secrets in env vars only; `.env` git-ignored from commit 1; no secrets in DB or logs
- TOTP secret is the base32 key, generated programmatically — never logged
- Scraped article text is data, never executed or evaluated
- Least-privilege DB user for the application

See `engineering/SECURITY_ARCHITECTURE.md` for full threat model.

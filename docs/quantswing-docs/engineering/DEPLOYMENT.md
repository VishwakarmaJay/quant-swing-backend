# Deployment

## Local
```
docker-compose up
  quantswing-app     :8080  (Bun + Express)
  finbert-service    :8001  (FastAPI + HuggingFace)
  postgres           :5432
  redis              :6379  (BullMQ + cache)
```

## Production VPS
Hetzner CX22 (~₹700/mo, 2 vCPU / 4GB / Ubuntu 24.04 LTS).
Memory budget: FinBERT ~1.5GB + Bun app ~256MB + Postgres ~256MB + Redis ~64MB.
// SCALE LIMIT: single node, single user by design; multi-user needs re-architecture (out of scope)

## Runbook
1. Provision VPS, UFW: allow SSH only; app/Redis/Postgres ports localhost-only
2. Install Docker + compose; clone repo
3. Create .env from .env.example (never commit) — // SECURITY: chmod 600 .env
4. `docker compose up -d`; verify /health via SSH tunnel
5. `prisma migrate deploy` runs on start; confirm init migration applied
6. Trigger manual test run; confirm Telegram delivery
7. Set up daily pg_dump → offsite (cron)

## Upgrades
Pull → build → compose up -d (recreate app only). Snapshots make rollback analysis safe:
engine_version stamps identify which build produced which signals.

## Timezone
Host and containers pinned to Asia/Kolkata — cron expressions assume IST.

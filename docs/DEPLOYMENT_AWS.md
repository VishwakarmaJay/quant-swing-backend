# AWS Deployment — one EC2 VM, five containers

> **What runs where:** the whole platform (backend + FinBERT sidecar + Postgres +
> Redis + RabbitMQ) lives on **one always-on EC2 instance** via `docker-compose.yml`.
> Deployed 2026-07-18. This doc is the operator runbook: architecture, deploy/update,
> backups, and the sharp edges.

## 1. The box

| Thing | Value |
|---|---|
| Instance | `quantswing` = `i-0acfdec2cd8ca0e01` (t3.small — 2 vCPU / 2 GB RAM + **4 GB swap**), `ap-south-1` Mumbai |
| Public IP | `13.207.152.125` (auto-assigned — changes on stop/start; see §2.4) |
| AMI | Ubuntu 24.04 LTS (gp3 30 GB root) |
| Access | `ssh -i ~/.ssh/quantswing-key.pem ubuntu@13.207.152.125` |
| Firewall | Security group `quantswing-sg` (`sg-03ce42e3789d60f16`): ports **22 + 3000, operator IP only** |
| App dir | `~/quantswing` (repo copy + `.env` + `quant.dump`) |
| Cost | ~$15/mo instance + ~$3/mo IPv4/EBS — covered by account credits ($100) |
| Deployed | 2026-07-18 · archive restored at 6,062 articles / 227k candles / 1,984 quarters |

**Tuning applied at deploy:** `SENTIMENT_TIMEOUT_MS=30000` in the VM `.env` — the
default 5s sidecar timeout is too tight for cold FinBERT inference on 2 shared
vCPUs (boot-time scoring timed out; 30s scored the 683-article backlog cleanly).

Why one VM: the stack wants an always-on process (in-process crons — the 15-min
news archive clock), RabbitMQ (no managed AWS equivalent in budget), and a
localhost-only FinBERT sidecar (ADR-0006). A single box keeps all three true and
keeps one stable IP for the WAF-sensitive scrapers.

**RAM reality (t3.small):** FinBERT wants ~1.5–2 GB during scoring bursts; the 4 GB
swap absorbs them. Heavy work (universe GDELT backfills, deep backtests) runs, but
slowly — run those in `tmux` and let them take the time they take.

## 2. Sharp edges (read before touching)

1. **`TZ=Asia/Kolkata` on the backend container is load-bearing.** BSE announcement
   day-windows and fundamentals date logic use server-local dates
   (ARCHITECTURE_REVIEW_B3_B4 §1.1 HIGH finding). It is set in `docker-compose.yml`;
   never remove it — a UTC clock silently misaligns the news archive's exchange-day
   windows.
2. **The sidecar publishes no host port** — reachable only on the private compose
   network as `http://sidecar:8001` (ADR-0006's localhost-only posture,
   containerized). Don't add a `ports:` mapping to it.
3. **The operator IP is pinned in the security group.** If your ISP rotates your IP,
   SSH/API access drops. Fix from any machine with AWS creds:
   `aws ec2 authorize-security-group-ingress --group-name quantswing-sg --protocol tcp --port 22 --cidr $(curl -s https://checkip.amazonaws.com)/32`
   (same for 3000; prune stale rules occasionally).
4. **Public IP changes on stop/start** (not reboot). Allocate an Elastic IP if you
   ever stop the instance routinely.
5. **Secrets live only in `~/quantswing/.env` on the box** (chmod 600) and in your
   local `.env`. `POSTGRES_PASSWORD`/`JWT_SECRET` were generated on the box; Angel
   One creds were copied from the local env. Nothing is committed.

## 3. First deploy (as performed — for the record / rebuild-from-zero)

```bash
# 1. Provision (from the workstation; aws CLI configured, region ap-south-1)
aws ec2 create-key-pair --key-name quantswing-key --key-type ed25519 \
  --query KeyMaterial --output text > ~/.ssh/quantswing-key.pem && chmod 400 ~/.ssh/quantswing-key.pem
aws ec2 create-security-group --group-name quantswing-sg --description "QuantSwing VM"
aws ec2 authorize-security-group-ingress --group-name quantswing-sg --protocol tcp --port 22  --cidr <YOUR_IP>/32
aws ec2 authorize-security-group-ingress --group-name quantswing-sg --protocol tcp --port 3000 --cidr <YOUR_IP>/32
AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
aws ec2 run-instances --image-id "$AMI" --instance-type t3.small --key-name quantswing-key \
  --security-group-ids <SG_ID> --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3"}}]' \
  --user-data file://user-data.sh   # swap + docker install; see git history
# 2. Ship code + archive dump (from quant-backend/)
tar czf - --exclude node_modules --exclude .git --exclude src/generated --exclude .cache \
  --exclude sidecar/.venv --exclude .env . | ssh -i ~/.ssh/quantswing-key.pem ubuntu@<IP> 'mkdir -p ~/quantswing && tar xzf - -C ~/quantswing'
pg_dump "<local-db-url-without-?schema>" --format=custom --no-owner --no-privileges -f quant.dump
scp -i ~/.ssh/quantswing-key.pem quant.dump ubuntu@<IP>:~/quantswing/
# 3. .env on the box: copy .env.production.example → .env, fill secrets
# 4. Build, restore, start (on the box, in ~/quantswing)
docker compose build
docker compose up -d postgres            # wait until healthy
docker compose exec -T postgres pg_restore -U quant -d quant --no-owner --no-privileges < quant.dump
docker compose up -d                     # backend runs `prisma migrate deploy` then boots
```

## 4. Updating the deployment (routine)

```bash
# from quant-backend/ on the workstation — ship current source:
tar czf - --exclude node_modules --exclude .git --exclude src/generated --exclude .cache \
  --exclude sidecar/.venv --exclude .env . | ssh -i ~/.ssh/quantswing-key.pem ubuntu@<IP> 'tar xzf - -C ~/quantswing'
# on the box:
cd ~/quantswing && docker compose build backend && docker compose up -d backend
# (rebuild sidecar only when sidecar/ or its pinned model revision changed)
```

New Prisma migrations apply automatically at backend start (`prisma migrate deploy`
is the container command). Watch logs: `docker compose logs -f backend`.

## 5. Backups — the archive is the asset

The news archive + fundamentals history cannot be re-fetched honestly. Cron a dump
(on the box) and copy it off:

```bash
docker compose exec -T postgres pg_dump -U quant -d quant --format=custom > ~/backups/quant-$(date +%F).dump
# pull to the workstation:
scp -i ~/.ssh/quantswing-key.pem ubuntu@<IP>:~/backups/quant-<date>.dump .
```

Restore = §3 step 4. EBS snapshots of the volume are a coarser second layer
(`aws ec2 create-snapshot --volume-id <vol>`).

## 6. Health / verification checklist

```bash
docker compose ps                                  # five services, all healthy/running
docker compose logs backend | grep -i "started"    # server up, crons registered
docker compose exec backend sh -c 'wget -qO- http://sidecar:8001/health'   # FinBERT ok
docker compose logs backend | grep '\[News\]'      # 15-min ingest firing, sources ok
docker compose exec backend sh -c 'date'           # MUST print IST, not UTC
```

The news ingest report's per-source table (`FROZEN?` column, BSE counts) is the
canary — a healthy deploy shows all four live sources fresh within a cycle.

## 7. Running research/ops jobs on the box

```bash
ssh -i ~/.ssh/quantswing-key.pem ubuntu@<IP>
cd ~/quantswing
docker compose exec backend bun run news:ingest              # manual ingest + report
docker compose exec backend bun run sentiment:score          # scoring catch-up
tmux new -s backfill
docker compose exec backend sh -c 'GDELT_BATCH_DAYS=10 GDELT_RATE_LIMIT_MS=10000 \
  bun run news:backfill:universe --from 2025-01-01 --to 2026-07-17'   # long; detach with C-b d
```

(The GDELT checkpoint lives inside the container FS at `.cache/` — `docker compose
restart backend` preserves it only until the container is recreated; for long
backfills prefer finishing a run before redeploying, or re-run — it's idempotent.)

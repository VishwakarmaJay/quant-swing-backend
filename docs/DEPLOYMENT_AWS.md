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

**Tuning applied at deploy:** `SENTIMENT_TIMEOUT_MS=60000` in the VM `.env` — the
default 5s sidecar timeout is far too tight for FinBERT inference on 2 shared vCPUs
(boot-time scoring timed out at 5s; 30s cleared the 683-article backlog but still
timed out under backfill load; 60s keeps scoring progressing while heavy jobs run).

Why one VM: the stack wants an always-on process (in-process crons — the 15-min
news archive clock), RabbitMQ (no managed AWS equivalent in budget), and a
localhost-only FinBERT sidecar (ADR-0006). A single box keeps all three true and
keeps one stable IP for the WAF-sensitive scrapers.

**RAM reality (t3.small):** FinBERT wants ~1.5–2 GB during scoring bursts; the 4 GB
swap absorbs them. Heavy work (universe GDELT backfills, deep backtests) runs, but
slowly — run those in `tmux` and let them take the time they take.

### ⚠️ The CPU-credit wall (t3.small burstable — the #1 operational gotcha)

t3.small is a **burstable** instance: 2 vCPU that only sustain **~40% total** (baseline)
once the earned CPU-credit balance hits zero. Any sustained CPU job — a big FinBERT
scoring backlog, a large import, a backtest — burns credits in ~20–40 min, then the box
throttles to baseline and becomes **so slow SSH times out during banner exchange** (looks
like a freeze; it isn't — CloudWatch shows `CPUCreditBalance=0`, `CPUUtilization≈40%`).
Hit **three times** during the 2026-07-18/19 news backfills.

- **Diagnose without SSH:** `aws cloudwatch get-metric-statistics --namespace AWS/EC2
  --metric-name CPUCreditBalance --dimensions Name=InstanceId,Value=<id> --start-time …
  --end-time … --period 300 --statistics Average`. Balance 0 + util pinned ~40% = throttled,
  not crashed.
- **Recover:** `aws ec2 reboot-instances --instance-ids <id>` (compose `restart:
  unless-stopped` brings every container back; the DB volume + all data survive). Then let
  the box idle to re-accrue credits (t3.small earns 24/hr) before the next heavy job.
- **`Unlimited` credits are BLOCKED on this account** (`aws ec2
  modify-instance-credit-specification … CpuCredits=unlimited` → "This account cannot run
  burstable instances with Unlimited enabled"). So the only real fixes are: (a) run
  CPU-heavy imports/backtests **on a workstation**, ship results to the VM (this is why
  `news:gal:download` runs on the Mac and only `news:gal:import` runs on the box); or
  (b) **resize to a non-burstable instance** (m-family) or a larger t3 before B7/B9's
  backtests — those will hit this wall hard.
- **Don't run two CPU-heavy jobs at once here.** A large import + the 15-min FinBERT
  scoring cron competing on a 0-credit box is what caused the worst stall. Import first
  (unscored rows accumulate harmlessly), let scoring catch up after.

**Scoring tunables set for this box** (`~/quantswing/.env`): `SENTIMENT_TIMEOUT_MS=120000`
(FinBERT is slow on shared throttled vCPUs) and `SENTIMENT_BATCH_SIZE=16` (smaller batches
fit the per-request timeout instead of timing the whole batch out).

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

## 5. Backups — the archive is the asset ✅ AUTOMATED (2026-07-20)

The news archive + fundamentals history **cannot be re-fetched honestly** — live-captured
`fetchedAt`/`availableAt` is unreproducible after the fact — so this is the one piece of
state whose loss is permanent. Until 2026-07-20 there were **no backups at all** (no
crontab, no backups dir); it was found and fixed while planning a 6-month archive-accrual
period that entirely depends on this data surviving.

**What runs now** — `~/quantswing/backup-archive.sh`, cron `30 20 * * *` UTC (02:00 IST,
after the 17:00 IST signal run):

| output | purpose |
|---|---|
| `~/backups/quant-YYYY-MM-DD.dump` | custom format, **14 daily** retained |
| `~/backups/quant-latest.sql.gz` | plain SQL, overwritten daily — **portable** |
| `~/backups/backup.log` | one line per run, OK/FAIL + size |

Three deliberate properties:
1. **Completeness guard.** The dump is written to `.partial` and only promoted if it
   exceeds 10 MB. A truncated dump that overwrites a good one is worse than no backup.
2. **Both formats.** The custom format is only readable by `pg_restore` ≥ the writing
   server (box is **pg16**; a workstation on pg15 gets `unsupported version (1.15)` — this
   was hit for real). The plain-SQL copy restores anywhere.
3. **Retention, not just a single file** — protects against a corruption that is only
   noticed days later.

### Restore (verified 2026-07-20, not just documented)
```bash
scp -i ~/.ssh/quantswing-key.pem ubuntu@<IP>:~/backups/quant-latest.sql.gz .
createdb quant_restore && gunzip -c quant-latest.sql.gz | psql "<url>/quant_restore"
```
A clean restore emits exactly **30 `role "quant" does not exist` errors** — GRANT
statements for a role absent on the restore host. **These are benign; zero data errors.**
Verified counts after restore: 173,168 articles (100% scored, 138,267 mapped),
227,001 candles, 1,984 fundamental quarters, all four origins intact.

### Offsite: S3 ✅ DONE (2026-07-20)
Backups previously lived only on the DB's own EBS volume — safe from corruption, not from
volume loss. Now every daily run also pushes to **S3** (`quantswing-archive-283443834610`,
ap-south-1, private / versioned / AES256 / 90-day lifecycle, 30-day noncurrent expiry).

**Auth: instance IAM role, no keys on the box.** `quantswing-backup-role` (via
`quantswing-backup-profile`) is attached to the instance; its policy allows **only**
`s3:PutObject` to `…/backups/*` of this one bucket (no read of other buckets, no delete).
The box has no `aws` binary — the upload runs through the `amazon/aws-cli` Docker image
with `--network host` so it can read credentials from instance metadata (IMDSv2). The
upload is **non-fatal**: an S3 failure logs `S3 FAIL` but never fails the local backup.

**Verified end-to-end 2026-07-20** — not just "it uploaded": pulled `quant-latest.sql.gz`
back *from S3*, restored into a scratch database, confirmed 173,168 articles / 227,001
candles / 1,984 quarters, 30 benign role-GRANT errors, zero data errors. This is a real
recovery path: box → S3 → any host → running DB.

**Rebuild-from-zero pointers** (if the whole AWS account were lost, these are the resources
this backup depends on):
- bucket `quantswing-archive-283443834610`, prefix `backups/`
- role `quantswing-backup-role` + instance profile `quantswing-backup-profile` (put-only)
- backup script `~/quantswing/backup-archive.sh`, cron `30 20 * * *` UTC

### Residual risk (now small)
Single AWS **account** and single **region** (ap-south-1). A full account compromise or an
ap-south-1 outage would still be uncovered; cross-region replication or an occasional pull
to non-AWS storage would close that, but the marginal value is low for a ~40 MB/day archive
that the workstation also holds a copy of.

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

Light jobs run fine on the box; **CPU-heavy jobs should run on a workstation** and only
their output ships to the VM (see the CPU-credit wall in §1). Long jobs go in `tmux` with
a host-mounted state/output dir (`~/quantswing/gdelt-state/`) so a container recreation or
reboot doesn't lose progress:

```bash
ssh -i ~/.ssh/quantswing-key.pem ubuntu@<IP>
cd ~/quantswing
docker compose exec backend bun run news:ingest              # manual ingest + report
docker compose exec backend bun run sentiment:score          # scoring catch-up
docker compose exec backend bun run news:remap               # re-tag after alias growth

# BSE filing backfill (exchange API, light) — checkpoint on the HOST volume:
tmux new -s bse
docker compose run --rm --no-deps -v /home/ubuntu/quantswing/gdelt-state:/state backend \
  sh -c 'bun run news:backfill:bse --from 2024-01-01 --to 2026-07-17 --state /state/bse.json'
```

**GDELT media history — download on the workstation, import on the box** (the download is
CPU-heavy and would wall the VM's credits; the import is what needs the DB):

```bash
# workstation:
bun run news:gal:download --from 2025-01-01 --to 2026-07-17 --out .cache/gal.ndjson --state .cache/gal-state.json
scp -i ~/.ssh/quantswing-key.pem .cache/gal.ndjson ubuntu@<IP>:~/quantswing/gal.ndjson
# box (idempotent; run when the box has CPU credits and scoring is idle):
docker compose run --rm --no-deps -v /home/ubuntu/quantswing/gal.ndjson:/data/gal.ndjson \
  backend bun run news:gal:import --file /data/gal.ndjson
```

All backfills/imports are **idempotent** (`(source,url)` unique + `skipDuplicates`) — a
killed run resumes or re-runs safely. New rows are unscored; the 15-min cron (or
`sentiment:score`) catches them up.

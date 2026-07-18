# FinBERT sidecar (ADR-0006 / ROADMAP B6)

Thin FastAPI service scoring financial-news sentiment with **ProsusAI/finbert at a
pinned revision** (`app.py: REVISION`), after an **India-term normalizer** pre-pass
(crore/lakh → converted magnitudes, Rs/₹ → INR, PAT/YoY/bps/FY-quarters → plain
English). CPU inference, eval mode → deterministic: same text, same revision,
same probabilities.

## Setup (once)

```bash
cd sidecar
python3.11 -m venv .venv          # torch needs ≤3.13; 3.11 verified
.venv/bin/pip install -r requirements.txt
```

First start downloads the model (~440 MB) into the HF cache.

## Run

```bash
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8001
```

// SECURITY: bind 127.0.0.1 only — no auth by design (ADR-0006).

## API

- `GET /health` → `{status, model, revision, device}`
- `POST /score` `{texts: string[] (≤256), normalize?: bool}` →
  `{model, revision, results: [{positive, negative, neutral, label, score}]}`
  where `score = positive − negative` ∈ [−1, 1].

## Tests

```bash
.venv/bin/python -m pytest .      # normalizer only — no model needed
```

## Caller contract (TS side)

`src/news/sentimentClient.ts`: 5s timeout, 2 retries, **degraded-neutral no-throw**
(returns null; pipeline continues unscored). `bun run sentiment:score` batch-scores
the archive and stamps each row with `model@revision`.

"""FinBERT scoring sidecar (ADR-0006 / ROADMAP B6).

Thin FastAPI service the TypeScript app calls over localhost HTTP. Loads
ProsusAI/finbert at a PINNED revision (model + tokenizer = deterministic
scoring), applies the India-term normalizer pre-pass, and scores batches.

Run (from quant-backend/sidecar, venv active):
    uvicorn app:app --host 127.0.0.1 --port 8001

// SECURITY: bind 127.0.0.1 only — this service has no auth by design.

Determinism: eval mode, no_grad, CPU inference (MPS/CUDA disabled) — same
text, same revision → byte-identical probabilities.
"""

from __future__ import annotations

import torch
from fastapi import FastAPI
from pydantic import BaseModel, Field
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from normalizer import normalize

MODEL_NAME = "ProsusAI/finbert"
# HF revision pinned 2026-07-18 (model last modified 2023-05-23). Bump
# consciously and re-run the spot-check; the TS side stores model@revision
# per scored article, so a bump never silently mixes scoring regimes.
REVISION = "4556d13015211d73dccd3fdd39d39232506f3e43"
MAX_TOKENS = 256
INTERNAL_BATCH = 16

app = FastAPI(title="quantswing-finbert-sidecar")

tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, revision=REVISION)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, revision=REVISION)
model.eval()
torch.set_grad_enabled(False)

# id2label: {0: 'positive', 1: 'negative', 2: 'neutral'} — read from config,
# never assumed.
ID2LABEL = {i: label.lower() for i, label in model.config.id2label.items()}


class ScoreRequest(BaseModel):
    texts: list[str] = Field(..., max_length=256)
    normalize: bool = True


class ScoreResult(BaseModel):
    positive: float
    negative: float
    neutral: float
    label: str
    # Signed scalar in [-1, 1]: positive − negative. The aggregation-friendly
    # number the future SentimentFactor consumes.
    score: float


class ScoreResponse(BaseModel):
    model: str
    revision: str
    results: list[ScoreResult]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": MODEL_NAME, "revision": REVISION, "device": "cpu"}


@app.post("/score", response_model=ScoreResponse)
def score(req: ScoreRequest) -> ScoreResponse:
    texts = [normalize(t) if req.normalize else t for t in req.texts]
    results: list[ScoreResult] = []
    for i in range(0, len(texts), INTERNAL_BATCH):
        chunk = texts[i : i + INTERNAL_BATCH]
        enc = tokenizer(
            chunk, padding=True, truncation=True, max_length=MAX_TOKENS, return_tensors="pt"
        )
        probs = torch.softmax(model(**enc).logits, dim=-1)
        for row in probs:
            by_label = {ID2LABEL[j]: float(row[j]) for j in range(len(ID2LABEL))}
            label = max(by_label, key=by_label.get)  # type: ignore[arg-type]
            results.append(
                ScoreResult(
                    positive=round(by_label["positive"], 6),
                    negative=round(by_label["negative"], 6),
                    neutral=round(by_label["neutral"], 6),
                    label=label,
                    score=round(by_label["positive"] - by_label["negative"], 6),
                )
            )
    return ScoreResponse(model=MODEL_NAME, revision=REVISION, results=results)

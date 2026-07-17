# ADR 0006 — FinBERT as Python Sidecar
Status: Accepted

## Context
FinBERT (HuggingFace) is Python-native; the platform is TypeScript/Bun.

## Decision
Thin FastAPI service on :8001 exposing batch /score; the app calls over localhost HTTP
behind `SentimentProvider`. 5s timeout, 2 retries, degraded-neutral fallback.

## Alternatives
- onnxruntime-node / transformers.js in-process: possible, adds ~1.5GB to the app
  process, harder model iteration, Bun compat risk.
- Rewrite scoring in TypeScript: throwaway work; loses HF ecosystem for future fine-tuning.

## Consequences
+ Model swappable/fine-tunable without touching the TypeScript app; failure isolated (degraded flag).
+ ~1.5GB RAM contained in its own container.
− Second runtime to deploy/monitor; localhost-only binding required (// SECURITY).

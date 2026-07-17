# ADR 0002 — No LLM; FinBERT Only
Status: Accepted

## Context
Original concept used Claude for nightly analysis and sentiment on ~1,500 articles/night.

## Decision
No LLM anywhere in the pipeline. Sentiment via local FinBERT (FastAPI sidecar);
strategy is deterministic rules + weighted scoring.

## Alternatives
- Claude/GPT sentiment: ₹9–12k/month — exceeds trading capital; non-deterministic → unbacktestable.
- Local Llama: heavier infra, still slower/less finance-specific than FinBERT for scoring.

## Consequences
+ ₹0 inference cost, ~100ms/article CPU, deterministic → backtestable, auditable, no hallucination.
− FinBERT is US-trained: requires India-term normalizer + hard overrides; event-context
  nuance (miss-but-guidance-up) deferred to v2.

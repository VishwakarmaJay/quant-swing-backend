# FinBERT sidecar image (ADR-0006 / ROADMAP B6).
#
# - CPU-only torch wheel (the default PyPI wheel bundles CUDA — ~2.5 GB of
#   dead weight on a CPU-inference box).
# - The PINNED model revision is baked into the image at build time:
#   deterministic scoring, no network/HF dependency at container start, fast
#   cold starts. Bumping the revision = editing app.py + rebuilding (the TS
#   side stores model@revision per article, so a bump never mixes regimes).
# - Version pins mirror requirements.txt (pytest excluded — not a runtime dep).
#
# SECURITY (ADR-0006): the service has no auth by design. In the container it
# binds 0.0.0.0, but compose does NOT publish the port to the host — it is
# reachable only on the private compose network (the containerized equivalent
# of the 127.0.0.1-only bind).

FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir fastapi==0.115.6 uvicorn==0.32.1 transformers==4.46.3

# Bake the pinned model + tokenizer into the image.
RUN python - <<'EOF'
from transformers import AutoModelForSequenceClassification, AutoTokenizer
NAME = "ProsusAI/finbert"
REV = "4556d13015211d73dccd3fdd39d39232506f3e43"  # keep in sync with app.py
AutoTokenizer.from_pretrained(NAME, revision=REV)
AutoModelForSequenceClassification.from_pretrained(NAME, revision=REV)
EOF

COPY app.py normalizer.py ./

EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]

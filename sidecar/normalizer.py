"""India-term normalizer (ROADMAP B6) — pre-pass before FinBERT tokenization.

FinBERT is trained on US/global financial text; Indian financial English uses
units (crore/lakh), currency notation (Rs/₹) and acronyms (PAT/QoQ/FY25) it
tokenizes poorly. This pass rewrites them into the vocabulary FinBERT knows,
deterministically (pure string transform, no state).

Numeric units are actually CONVERTED (1 crore = 10 million, 1 lakh = 0.1
million) so magnitude survives: "Rs 1,200 crore" → "INR 12.00 billion".
"""

from __future__ import annotations

import re

# Word-boundary acronym / term replacements (case-insensitive keys).
_TERMS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bPAT\b"), "net profit"),
    (re.compile(r"\bPBT\b"), "pre-tax profit"),
    (re.compile(r"\bYoY\b", re.IGNORECASE), "year-on-year"),
    (re.compile(r"\bQoQ\b", re.IGNORECASE), "quarter-on-quarter"),
    (re.compile(r"\bMoM\b"), "month-on-month"),
    (re.compile(r"\bbps\b", re.IGNORECASE), "basis points"),
    (re.compile(r"\bNPA(s)?\b"), r"bad loan\1"),
    (re.compile(r"\bcapex\b", re.IGNORECASE), "capital expenditure"),
    (re.compile(r"\btopline\b", re.IGNORECASE), "revenue"),
    (re.compile(r"\bbottomline\b", re.IGNORECASE), "net profit"),
    (re.compile(r"\bdemat\b", re.IGNORECASE), "brokerage"),
    (re.compile(r"\bFII(s)?\b"), r"foreign institutional investor\1"),
    (re.compile(r"\bDII(s)?\b"), r"domestic institutional investor\1"),
    # Q1FY25 / Q3 FY2026 → "Q1 fiscal year 2025" (keeps the quarter token).
    (re.compile(r"\bQ([1-4])\s*FY\s*(\d{2,4})\b", re.IGNORECASE), r"Q\1 fiscal year \2"),
    (re.compile(r"\bFY\s*(\d{2,4})\b", re.IGNORECASE), r"fiscal year \1"),
]

# Currency notation → "INR". (₹ or Rs./Rs/INR with optional following space.)
_CURRENCY = re.compile(r"(?:₹\s*|\bRs\.?\s+|\bINR\s+)", re.IGNORECASE)

# "<number> crore/cr" and "<number> lakh(s)" — converted numerically.
_NUM = r"(\d[\d,]*(?:\.\d+)?)"
_CRORE = re.compile(rf"{_NUM}\s*(?:crores?|cr)\b", re.IGNORECASE)
_LAKH = re.compile(rf"{_NUM}\s*(?:lakhs?)\b", re.IGNORECASE)
# Standalone unit words (no leading number) → plain-English scale words.
_CRORE_WORD = re.compile(r"\bcrores?\b", re.IGNORECASE)
_LAKH_WORD = re.compile(r"\blakhs?\b", re.IGNORECASE)


def _fmt_millions(millions: float) -> str:
    """12000.0 → '12.00 billion'; 45.0 → '45.00 million' (2dp, deterministic)."""
    if abs(millions) >= 1000:
        return f"{millions / 1000:.2f} billion"
    return f"{millions:.2f} million"


def _convert(match: re.Match[str], per_unit_millions: float) -> str:
    value = float(match.group(1).replace(",", ""))
    return _fmt_millions(value * per_unit_millions)


def normalize(text: str) -> str:
    """Deterministic India-term → FinBERT-vocabulary rewrite."""
    out = text
    out = _CURRENCY.sub("INR ", out)
    out = _CRORE.sub(lambda m: _convert(m, 10.0), out)   # 1 crore = 10 million
    out = _LAKH.sub(lambda m: _convert(m, 0.1), out)     # 1 lakh = 0.1 million
    out = _CRORE_WORD.sub("tens of millions", out)
    out = _LAKH_WORD.sub("hundreds of thousands", out)
    for pattern, repl in _TERMS:
        out = pattern.sub(repl, out)
    return re.sub(r"\s+", " ", out).strip()

"""Normalizer unit tests: `python -m pytest sidecar/` (no model download needed)."""

from normalizer import normalize


def test_currency_and_crore_conversion():
    assert normalize("Rs 1,200 crore profit") == "INR 12.00 billion profit"
    assert normalize("₹450 crore order win") == "INR 4.50 billion order win"
    assert normalize("Rs. 45 cr penalty") == "INR 450.00 million penalty"


def test_lakh_conversion():
    assert normalize("5 lakh shares") == "0.50 million shares"
    assert normalize("Rs 80 lakh fine") == "INR 8.00 million fine"


def test_standalone_units():
    assert normalize("profit in crores") == "profit in tens of millions"
    assert normalize("lakhs of investors") == "hundreds of thousands of investors"


def test_acronyms():
    assert normalize("PAT up 20% YoY") == "net profit up 20% year-on-year"
    assert normalize("margin down 150 bps QoQ") == "margin down 150 basis points quarter-on-quarter"
    assert normalize("gross NPAs decline") == "gross bad loans decline"


def test_fiscal_quarters():
    assert normalize("Q1FY26 results") == "Q1 fiscal year 26 results"
    assert normalize("guidance for FY 2027") == "guidance for fiscal year 2027"


def test_case_and_word_boundaries():
    # 'Pat' the name must not become 'net profit' (case-sensitive acronym);
    # 'across' must not trigger 'cr'.
    assert normalize("Pat said profits across sectors") == "Pat said profits across sectors"


def test_deterministic_and_whitespace_collapsed():
    a = normalize("  Rs   10 crore   PAT  ")
    assert a == normalize("  Rs   10 crore   PAT  ")
    assert a == "INR 100.00 million net profit"

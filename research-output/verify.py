#!/usr/bin/env python3
"""
Task 11 — independent recomputation of the B9 signal-edge metrics.

Standalone: reads ledger_b9_full.csv and recomputes expectancy, profit factor,
win rate, and a stationary block-bootstrap 95% CI on expectancy WITHOUT importing
any project TypeScript. This breaks the circular dependency in which the project's
headline metrics are validated only by the project's own code.

Reported figure to check (docs/B9_RERUN.md, live+bse OOS concat): expectancy
-0.04% / PF 0.97.

Run:  python3 research-output/verify.py
"""
import sys
import numpy as np
import pandas as pd

LEDGER = "research-output/ledger_b9_full.csv"
BLOCK = 20        # mean block length (trading-day autocorrelation scale)
REPS = 10_000     # bootstrap replications
SEED = 20260722
ALPHA = 0.05      # 95% CI


def profit_factor(r: np.ndarray) -> float:
    gross_win = r[r > 0].sum()
    gross_loss = -r[r < 0].sum()
    if gross_loss == 0:
        return float("inf") if gross_win > 0 else 0.0
    return gross_win / gross_loss


def stationary_bootstrap_indices(n: int, block: int, rng: np.random.Generator) -> np.ndarray:
    """One stationary-bootstrap resample of positions (circular), Politis-Romano."""
    p = 1.0 / block
    idx = np.empty(n, dtype=np.int64)
    i = rng.integers(n)
    for t in range(n):
        if t == 0 or rng.random() < p:
            i = rng.integers(n)
        else:
            i = (i + 1) % n
        idx[t] = i
    return idx


def bootstrap_ci(r: np.ndarray, stat, block: int, reps: int, seed: int, alpha: float):
    rng = np.random.default_rng(seed)
    n = len(r)
    out = np.empty(reps)
    for b in range(reps):
        out[b] = stat(r[stationary_bootstrap_indices(n, block, rng)])
    lo, hi = np.percentile(out, [100 * alpha / 2, 100 * (1 - alpha / 2)])
    return float(lo), float(hi)


def main() -> int:
    df = pd.read_csv(LEDGER)
    if "netReturnPct" not in df.columns:
        print("ERROR: netReturnPct column missing", file=sys.stderr)
        return 1
    r = df["netReturnPct"].to_numpy(dtype=float)
    n = len(r)

    expectancy = float(r.mean())
    pf = profit_factor(r)
    win_rate = float((r > 0).mean() * 100)

    exp_lo, exp_hi = bootstrap_ci(r, np.mean, BLOCK, REPS, SEED, ALPHA)
    pf_lo, pf_hi = bootstrap_ci(r, profit_factor, BLOCK, REPS, SEED + 1, ALPHA)

    reported_exp, reported_pf = -0.04, 0.97

    print("# Independent recomputation of B9 signal-edge (verify.py, standalone pandas)")
    print(f"trades                 : {n}")
    print(f"expectancy (mean net%) : {expectancy:+.4f}   [reported {reported_exp:+.2f}]")
    print(f"profit factor          : {pf:.4f}   [reported {reported_pf:.2f}]")
    print(f"win rate               : {win_rate:.2f}%")
    print(f"gross return sum        : {r.sum():+.2f}%")
    print()
    print(f"Stationary block bootstrap (block~{BLOCK}, {REPS} reps, seed {SEED}):")
    print(f"  95% CI on expectancy : [{exp_lo:+.4f}, {exp_hi:+.4f}]")
    print(f"  95% CI on prof.factor: [{pf_lo:.4f}, {pf_hi:.4f}]")
    print()

    exp_spans_zero = exp_lo < 0 < exp_hi
    pf_spans_one = pf_lo < 1 < pf_hi
    width = exp_hi - exp_lo
    print("## Verdict")
    print(f"  expectancy CI spans zero : {exp_spans_zero}  (width {width:.3f} pp)")
    print(f"  profit-factor CI spans 1 : {pf_spans_one}")
    if exp_spans_zero and width > 0.20:
        print("  >> The 95% CI on expectancy spans zero WIDELY. Neither 'edge' nor")
        print("     'no edge' is a licensed conclusion from this ledger alone (ST5).")
    elif exp_spans_zero:
        print("  >> The expectancy CI spans zero: consistent with near-breakeven /")
        print("     no demonstrable per-trade edge; a positive edge is not supported.")
    else:
        print("  >> The expectancy CI excludes zero.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

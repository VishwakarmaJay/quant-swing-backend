# Prompt Library (AI-assisted development)

Prepend CLAUDE_CONTEXT.md to every session. Then:

## Implement a component
"Implement <Class> per project/ARCHITECTURE.md contract. Constraints:
IMPLEMENTATION_RULES.md. Show two solutions (optimal/minimal), diff-style if
modifying, error handling + retries per spec §28, config-driven numerics,
// TEST hints included."

## Add a factor (research-gated)
"Hypothesis H-XXXX-NN approved in RESEARCH_PROTOCOL.md: <claim>. Implement
<Name>Factor per Factor contract. Deterministic (no clock/random), explanations
populated, metrics map carries raw values, golden fixture update included."

## Debug a pipeline run
"Run ID <id> failed at <stage>. Here are the JSON logs + metric values: <paste>.
Identify layer, root cause, minimal fix as diff. Do not touch other layers."

## Review a diff
"Review this diff against ai-development/REVIEW_CHECKLIST.md. Output: violations
only, file:line, one-line fix each. No praise, no summary."

## Backtest analysis
"Backtest report attached. Check for: lookahead leakage signs, in-sample-only
claims, survivorship caveat present, benchmark comparison included. Then interpret
factor attribution — which factors earn their place per retirement criteria."

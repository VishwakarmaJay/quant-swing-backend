# Contributing

## Ground rule
Architecture is frozen. **No new indicators, factors, weighting rules, or heuristics
via PR.** Every such idea enters as a hypothesis in `research/RESEARCH_PROTOCOL.md`
and must show out-of-sample improvement before merge.

## Workflow
1. Open an issue describing the change (bug / docs / infra / research hypothesis)
2. Fork → branch (`feat/...`, `fix/...`, `research/...`)
3. Follow `ai-development/CODING_STANDARDS.md`
4. All tests pass: unit + golden dataset + integration (Testcontainers)
5. PR must pass `ai-development/REVIEW_CHECKLIST.md`

## Commit convention
Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `research:`

## What gets rejected
- Factors without a research protocol entry and backtest evidence
- Code without error handling or tests
- Hardcoded thresholds (everything numeric → configuration)
- Secrets in code, config files, or history

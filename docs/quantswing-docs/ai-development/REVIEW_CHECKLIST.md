# Review Checklist (every PR)

## Correctness
- [ ] Error handling on every external call (timeout + retry per spec §28)
- [ ] No lookahead: nothing reads data newer than the injected asOf date
- [ ] Edge cases: empty series, gaps, exactly-boundary values

## Architecture
- [ ] Dependency direction respected (factors never import strategy/portfolio)
- [ ] New logic behind existing interfaces; no provider details leaking upward
- [ ] No new factor/heuristic without linked RESEARCH_PROTOCOL hypothesis

## Determinism & data
- [ ] No clock/random/env reads inside factor evaluation
- [ ] Golden dataset tests green; any golden change justified in PR description
- [ ] Snapshot version fields stamped on new persisted paths

## Config & security
- [ ] No numeric literals in business logic — config only
- [ ] No secrets in code/logs/tests; scrubbing not bypassed
- [ ] SQL parameterized; XML parsing XXE-safe

## Quality
- [ ] Unit tests for new logic; integration updated if pipeline shape changed
- [ ] // PERF / // SECURITY / // DEBT / // TEST labels where applicable
- [ ] Metrics added for new external calls or pipeline stages

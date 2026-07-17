# Implementation Rules (AI + human)

1. **Verify before writing** — confirm library versions on the npm registry before use;
   if unverifiable, mark: `Verify this — may be outdated`. Never guess signatures.
2. **Diff, not rewrite** — show changed blocks only; mark rest `// ... unchanged`.
3. **Error handling always** — stack-native patterns (Express error middleware, BullMQ
   retry/backoff options, AbortSignal timeouts); no empty catch; no silent failures.
4. **Determinism** — factors take asOf/context as input; never read clocks, env, or
   random inside evaluation.
5. **Config over constants** — any numeric literal in business logic is a review failure.
6. **Reusability** — repeated logic extracted, labeled `// REUSABLE: reason`.
7. **Performance flags inline** — `// PERF: reason` at bottleneck sites.
8. **Security flags inline** — `// SECURITY: reason` (auth, input validation, exposure, tokens).
9. **Debt flags** — `// DEBT: reason` when a shortcut meaningfully affects future work.
10. **Test hints** — non-trivial logic carries `// TEST: what + edge case`.
11. **Scale limits** — `// SCALE LIMIT: reason` where load breaks the approach.
12. **One layer per change** — don't bleed UI/API/DB concerns across a single diff.
13. **Immutability default** — records for value objects; mutation is opt-in with reason.
14. **Every PR**: unit tests + golden dataset green + integration green + REVIEW_CHECKLIST pass.

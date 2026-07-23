# QuantSwing backend

**Read [AI_CONTEXT.md](AI_CONTEXT.md) before doing anything in this repo.** It is the
single source of truth for project state, the promotion bar, scientific and
architecture invariants, known traps, and agent write zones. If anything below or in any
docstring conflicts with it, AI_CONTEXT.md wins.

@AI_CONTEXT.md

## My write zone

`src/**`, `prisma/**`, `research-output/`. I own architecture, multi-file refactors,
schema, pipeline, and CI. I read everything.

Before committing, run the "Before you commit" checklist in AI_CONTEXT.md — in
particular the control suite, not just typecheck and tests. Engineering review does not
catch wrong-estimand bugs; only the controls do.

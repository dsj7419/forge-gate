# Engineering Standards

Starter engineering standards for ForgeGate-driven work. Copy to `docs/governance/ENGINEERING-STANDARDS.md`
and adapt to your stack. The engineer reads this; keep it short and concrete.

## How code should be built

- **One responsibility per unit.** A function/module does one thing; favor small, composable pieces over
  large ones. Prefer editing or deleting code over adding it — every line is a liability.
- **Clarity over cleverness.** Self-documenting names; comment the *why*, not the *what*. Early returns over
  deep nesting.
- **Production-grade, not prototype.** Handle errors with context; validate input at trust boundaries; put
  timeouts on network calls; never swallow an error to make a path "work".
- **Type/contract safety.** Honor the project's strictness (no untyped escape hatches); validate at the edges
  with the project's schema/validation approach.
- **Small, safe increments.** Each change leaves the tree green (build + tests pass). If it isn't green, it's a
  work-in-progress, not done.

## Non-negotiables

- No secrets, credentials, or `.env` contents in code or commits.
- Don't widen a ticket's scope to make work "fit"; if the ticket is wrong, stop and escalate.
- Tests are part of "done" (see `DEFINITION-OF-DONE.md` and `TESTING-STANDARDS.md`).

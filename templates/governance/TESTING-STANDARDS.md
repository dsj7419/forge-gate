# Testing Standards

Starter testing standards for ForgeGate-driven work. Copy to `docs/governance/TESTING-STANDARDS.md` and adapt
to your stack. The semantic verifier checks work against this; keep it practical.

## Principles

- **Test behavior, not implementation.** Assert observable outcomes through the public surface, not private internals.
- **A test must be able to fail.** New behavior gets a test that is red before the change and green after (TDD where it applies).
- **No self-mocking.** Import and exercise the real unit under test; do not mock the thing you are testing.
- **Cover the edges.** At least one happy-path case and one boundary/negative case for non-trivial logic.
- **Deterministic.** No reliance on time, network, or order; tests pass repeatably in isolation.

## What "verified" means

- The ticket's `verify_commands` are run independently by the orchestrator and the verifier — not trusted from the engineer's narrative.
- Evidence is cited as `file:line` or a named test, never "looks good."

## Scope

- Pure logic, data transforms, and branching: tests are expected.
- Glue/config/docs: tests optional, but the verify commands must still pass (prove nothing broke).

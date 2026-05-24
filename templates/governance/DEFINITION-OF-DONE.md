# Definition of Done

A starter Definition of Done for ForgeGate-driven work. Copy to `docs/governance/DEFINITION-OF-DONE.md`
in your repo and adapt. Agents (engineer, verifiers, PM) read this; keep it short and concrete.

A ticket is **done** only when:

- [ ] The Acceptance Criteria in the ticket are each met, with concrete evidence (a file, a test, a command result).
- [ ] New or changed behavior is covered by a test that would fail without the change.
- [ ] All of the ticket's `verify_commands` pass (run independently, not just claimed).
- [ ] The change stays inside the ticket's `allowed_paths`; nothing in `forbidden_paths`/protected paths is touched.
- [ ] No scope creep: the implementation did not quietly expand beyond the ticket.
- [ ] No secrets, credentials, or environment files are committed.
- [ ] The work stops at the commit gate for a human — ForgeGate never commits, pushes, merges, or opens a PR for you.

Not done if any box is unchecked. "Looks complete" is not evidence.

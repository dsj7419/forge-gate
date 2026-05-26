# Definition of Ready

A starter Definition of Ready for ForgeGate-driven work. Copy to `docs/governance/DEFINITION-OF-READY.md`
and adapt. This is what makes a ticket safe to run; `forge validate` enforces much of it mechanically.

A ticket is **ready to execute** only when:

- [ ] **Acceptance Criteria** are present, concrete, and checkable (not "make it good").
- [ ] **`allowed_paths`** are narrow — only the files this ticket should touch.
- [ ] **`forbidden_paths`** explicitly call out anything nearby it must not touch (config, lockfiles, etc.).
- [ ] **`verify_commands`** are present and concrete (test, plus typecheck/lint as applicable) and pass at baseline.
- [ ] **`kind`/`risk`/`change_class`/`blast_radius`/`gate`** are set honestly — no placeholder/`TODO` values.
- [ ] **Tiny and low-risk** for a first/pilot run: the smallest useful slice, no migrations, auth, secrets, or
      production/destructive work (those auto-escalate the gate).
- [ ] Dependencies on other tickets, if any, are satisfied or declared.

If any box is unchecked, complete the contract first. A `TODO`-laden import draft is **not** ready —
`forge validate` will flag it until a human completes it.

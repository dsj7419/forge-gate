# Security Standards

Starter security standards for ForgeGate-driven work. Copy to `docs/governance/SECURITY-STANDARDS.md`
and adapt to your stack. Agents read this; keep it short and concrete.

## Always

- **No secrets in code or commits.** No credentials, tokens, API keys, or `.env` contents. Reference secrets
  via environment/secret managers, never literals.
- **Validate at trust boundaries.** Treat all external input (requests, files, args, env) as untrusted; validate
  and narrow it with the project's schema/validation approach before use.
- **Parameterized queries / safe APIs.** No string-built SQL or shell; use parameterized queries and safe
  library calls. Avoid `eval`-style dynamic execution.
- **Vetted crypto only.** Use the platform's vetted crypto libraries; never hand-roll crypto or hashing.
- **Least privilege + bounded resources.** Narrow scopes/permissions; timeouts on network calls; bounded loops
  and allocations.

## Stop and escalate (do not proceed silently)

- Anything touching **auth, secrets, migrations, production config, or destructive filesystem/DB operations** —
  these are high-risk; the ticket's gate must reflect it (ForgeGate auto-escalates on these keywords/classes).
- Any change that would weaken an existing security control. Surface it to the PM/human rather than working around it.

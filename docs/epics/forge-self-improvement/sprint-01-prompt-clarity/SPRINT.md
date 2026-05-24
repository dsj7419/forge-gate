# Sprint 01 — Prompt Clarity

One tiny, low-risk green ticket: correct an inaccurate section label in the engineer dispatch packet so
the prompt honestly describes what it renders. The engineer may touch only the ticket's `allowed_paths`.
Verification is `pnpm test src/orchestrator/dispatch.test.ts` and `pnpm typecheck`.

**Done means:** the misleading "front-matter + body" label no longer claims content the section does not
render; the engineer prompt still carries the ticket body, acceptance criteria, AI instructions, verify
commands, and cwd discipline; the dispatch tests and typecheck pass.

**Halt-triggers:** any change outside `allowed_paths`; any behavior change beyond prompt text; a weakened
or deleted existing assertion; a failing verify command after the correction cap.

# Sprint 01 — Core-owned repo snapshot

One ticket: add a single Core-owned `forge repo snapshot --repo-root <path> [--base <sha>]` command (computed via
Core's internal, hook-free git invocation, mirroring `src/guard/git.ts`) and rewire `workflows/forge-run-ticket.workflow.js`
to obtain all its read-only repo facts from it — removing every raw `git`/`git -C` call so the workflow is
live-reachable under the permissions hook.

- **T01** — Add `forge repo snapshot` and route the workflow runner's repo-fact reads through it.

Acceptance evidence: injected-seam unit tests for the Core command (head / branch / clean / changed_files /
ahead_of_base) plus one real-fs temp-git test for the default binding; and a **non-tautological** workflow protocol
test (raw `git -C` absent; `forge repo snapshot` present; acquire-before-active-ticket ordering preserved; existing
lock-wiring assertions stay green). The A+B live re-proof is a separate governed step after this lands.

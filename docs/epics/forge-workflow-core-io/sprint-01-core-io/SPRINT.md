# Sprint 01 — Core-owned workflow artifact write + Core-fed scope diff

One ticket (recommended): make the workflow reach full happy-path PASS under the live hook by (1) adding
`forge active-ticket … --out <path>` so Core writes the active-ticket JSON byte-exact (fixing the Windows-path
corruption that breaks `forge guard paths`), and (2) having the workflow feed the scope verifier the Core-produced
changed-file list (from the existing `repo snapshot`) in its dispatch so it scope-checks from Core facts instead of
shelling git. No hook loosening; no charter edit (the scope-verifier charter already accepts a provided diff).

- **T01** — Core-owned active-ticket write + Core-fed scope diff so the workflow reaches full PASS.

Acceptance evidence: Core `active-ticket --out` writes byte-exact valid JSON (unit test, incl. a Windows-style
backslash `repo_root`); a non-tautological workflow protocol test (active-ticket written via `--out` not the prose
byte-write; the scope-verifier dispatch carries the Core changed-file facts); existing lock-wiring + repo-snapshot
assertions stay green. After merge, the **A+B live proof is re-run** to confirm full workflow PASS.

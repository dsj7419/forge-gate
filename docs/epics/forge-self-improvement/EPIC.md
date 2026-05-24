# Forge Self-Improvement

The first epic that drives Forge to edit its own real source through the packaged one-ticket loop
(engineer → semantic + scope verifiers → PM → commit gate). Scope is deliberately tiny and low-risk:
small, honest clarity fixes to Forge Core, one narrowly-fenced file at a time, each fully verified and
human-gated.

**Non-goals:** behavior changes, dependency/config/package changes, and anything touching the run's
own execution path beyond the single fenced file per ticket. The live run is driven by a frozen
`dist/` binary so the orchestrator never edits the code currently orchestrating it.

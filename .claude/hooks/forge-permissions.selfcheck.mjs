#!/usr/bin/env node
// Self-check for the Forge PreToolUse permissions hook (four-class model).
//
// Feeds representative PreToolUse tool-call inputs to the pure `decide()`
// function and asserts the expected decision. It executes NO real git/gh
// operation — every case is a string fed to the decider. Run:
//
//   node .claude/hooks/forge-permissions.selfcheck.mjs
//
// Exit 0 iff every assertion passes; exit 1 with a report otherwise.

import { decide } from "./forge-permissions.mjs";

let pass = 0;
const failures = [];

/** Build a Bash PreToolUse input. */
function bash(command, agentType) {
  const input = { tool_name: "Bash", tool_input: { command } };
  if (agentType !== undefined) input.agent_type = agentType;
  return input;
}

/** Assert that `decide(input).decision === expected`. */
function expect(label, input, expected) {
  let actual;
  try {
    actual = decide(input).decision;
  } catch (err) {
    actual = `THREW: ${err && err.message ? err.message : String(err)}`;
  }
  if (actual === expected) {
    pass++;
  } else {
    failures.push(`  [${label}] expected "${expected}" got "${actual}"`);
  }
}

// === Class 1 — read-only / local Git: ALLOW (non-runner) =====================
expect("c1-status", bash("git status"), "allow");
expect("c1-diff", bash("git diff"), "allow");
expect("c1-log", bash("git log"), "allow");
expect("c1-diff-staged", bash("git diff --staged"), "allow");
expect("c1-show-head", bash("git show HEAD"), "allow");
expect("c1-rev-parse-head", bash("git rev-parse HEAD"), "allow");
expect("c1-branch-list", bash("git branch"), "allow");
expect("c1-branch-a", bash("git branch -a"), "allow");
expect("c1-fetch", bash("git fetch"), "allow");
expect("c1-pull-ff-only", bash("git pull --ff-only"), "allow");
expect("c1-switch-main", bash("git switch main"), "allow");
expect("c1-switch-feature", bash("git switch feature/x"), "allow");
expect("c1-switch-fix", bash("git switch fix/123"), "allow");
expect("c1-log-oneline", bash("git log --oneline -3"), "allow");

// === FIX 1 — git checkout is DENIED IN EVERY FORM ============================
expect("fix1-checkout-main", bash("git checkout main"), "deny");
expect("fix1-checkout-path", bash("git checkout src/x.ts"), "deny");
expect("fix1-checkout-pkg", bash("git checkout package.json"), "deny");
expect("fix1-checkout-readme", bash("git checkout README.md"), "deny");
expect("fix1-checkout-headn", bash("git checkout HEAD~1"), "deny");
expect("fix1-checkout-dashdash-f", bash("git checkout -- f"), "deny");
expect("fix1-checkout-dot", bash("git checkout ."), "deny");
expect("fix1-checkout-b", bash("git checkout -b x"), "deny");
expect("fix1-checkout-bare", bash("git checkout"), "deny");

// === FIX 2 — git switch arg must be a simple branch name =====================
expect("fix2-switch-dotdot-etc", bash("git switch ../etc"), "deny");
expect("fix2-switch-dotdot", bash("git switch .."), "deny");
expect("fix2-switch-dot", bash("git switch ."), "deny");
// T01: `git switch -c <safe-feature-branch>` is now an ALLOW (see the T01 block
// below). The bare `git switch -c x` here was previously a DENY case; the unsafe
// switch-flag DENY intent is now covered by `--discard-changes` (next line) and
// the T01 deny cases (`-C`, extra flags, start-point, unsafe shapes).
expect("fix2-switch-discard", bash("git switch --discard-changes"), "deny");
expect("fix2-switch-traversal-mid", bash("git switch a/../b"), "deny");
expect("fix2-switch-refs", bash("git switch refs/heads/x"), "deny");
expect("fix2-switch-tilde", bash("git switch main~1"), "deny");
expect("fix2-switch-multi", bash("git switch a b"), "deny");

// === FIX 3 — git add directory-everything bypass =============================
expect("fix3-add-dot-slash", bash("git add ./"), "deny");
expect("fix3-add-dotdot-slash", bash("git add ../"), "deny");
expect("fix3-add-dotdot", bash("git add .."), "deny");
expect("fix3-add-magic-top", bash("git add :(top)"), "deny");
// `src/.` normalizes to the in-tree subdir `src` — functionally identical to the
// already-allowed `git add src/`, so it ALLOWs under FIX 2 path-segment
// normalization (the old literal `/.`-suffix reject was the imprecise check this
// replaces). `src/..` collapses to the cwd `.` and still DENYs (stage-everything).
expect("fix3-add-subdir-dot", bash("git add src/."), "allow");
expect("fix3-add-subdir-dotdot", bash("git add src/.."), "deny");
expect("fix3-add-bracket-glob", bash("git add src/[ab].ts"), "deny");
expect("fix3-add-subdir", bash("git add src/"), "allow");

// === FIX 4 — reject leading `~` (tilde-expansion) in `git add` pathspecs ======
// Bash expands an unquoted leading `~` to an absolute out-of-tree path before
// git sees it; reject `~`, `~/x`, `~/.ssh/id_rsa`, `~root/x`.
expect("fix4-add-tilde", bash("git add ~"), "deny");
expect("fix4-add-tilde-slash-x", bash("git add ~/x"), "deny");
expect("fix4-add-tilde-ssh", bash("git add ~/.ssh/id_rsa"), "deny");
expect("fix4-add-tilde-user", bash("git add ~root/x"), "deny");
// No regression: plain in-tree pathspecs still ALLOW.
expect("fix4-add-src-x", bash("git add src/x.ts"), "allow");
expect("fix4-add-src-dir", bash("git add src/"), "allow");
expect("fix4-add-lib-util", bash("git add lib/util.ts"), "allow");

// === Class 2 — staging =======================================================
expect("c2-add-path", bash("git add src/x.ts"), "allow");
expect("c2-add-two-paths", bash("git add src/a.ts src/b.ts"), "allow");
expect("c2-add-dot", bash("git add ."), "deny");
expect("c2-add-A", bash("git add -A"), "deny");
expect("c2-add-all", bash("git add --all"), "deny");
expect("c2-add-star", bash("git add *"), "deny");
expect("c2-add-colon-slash", bash("git add :/"), "deny");
expect("c2-add-bare", bash("git add"), "deny");

// === Class 3 — PR workflow: ALLOW ============================================
expect("c3-push-u", bash("git push -u origin feature/x"), "allow");
expect("c3-push-set-upstream", bash("git push --set-upstream origin fix/y"), "allow");
expect("c3-gh-pr-create", bash("gh pr create --title t --body b"), "allow");
expect("c3-gh-pr-view", bash("gh pr view 26"), "allow");
expect("c3-gh-pr-checks", bash("gh pr checks 26"), "allow");

// === Class 4 — destructive / approval-gated / unsafe: DENY ===================
expect("c4-push-force-main", bash("git push --force origin main"), "deny");
expect("c4-push-main", bash("git push origin main"), "deny");
expect("c4-reset-hard", bash("git reset --hard HEAD"), "deny");
expect("c4-branch-D", bash("git branch -D x"), "deny");
expect("c4-checkout-path", bash("git checkout -- x"), "deny");
expect("c4-restore", bash("git restore x"), "deny");
expect("c4-clean", bash("git clean -fd"), "deny");
expect("c4-merge", bash("git merge x"), "deny");
expect("c4-rebase", bash("git rebase x"), "deny");
expect("c4-pull-bare", bash("git pull"), "deny");
expect("c4-pull-rebase", bash("git pull --rebase"), "deny");
expect("c4-gh-pr-merge", bash("gh pr merge 26"), "deny");
expect("c4-gh-api-delete", bash("gh api -X DELETE repos/o/r/issues/1"), "deny");
// T01: `git switch -c <safe-feature-branch>` is now an ALLOW. The remaining
// Class-4 `-c` deny intent (protected target) is asserted here and exhaustively
// in the T01 block below (`-C`, extra flag, start-point, unsafe shapes, runner).
expect("c4-switch-c-main", bash("git switch -c main"), "deny");
expect("c4-checkout-b", bash("git checkout -b x"), "deny");
expect("c4-fetch-force", bash("git fetch --force"), "deny");
// Extra Class-4 / challenge-flag coverage.
// NOTE: `git switch -c <safe-feature-branch>` moved from DENY to ALLOW in T01;
// its coverage now lives in the T01 block below. The unsafe `-c` forms (`-c main`,
// `-c` + extra flag, `-c` + start-point, unsafe shapes, runner) stay DENY there.
expect("c4-push-bare", bash("git push"), "deny");
expect("c4-push-force-with-lease", bash("git push --force-with-lease origin feature/x"), "deny");
expect("c4-commit", bash("git commit -m wip"), "deny");
expect("c4-branch-create", bash("git branch newbranch"), "deny");
expect("c4-branch-m", bash("git branch -m old new"), "deny");
expect("c4-switch-create-cap", bash("git switch -C x"), "deny");
expect("c4-switch-detach", bash("git switch --detach x"), "deny");
expect("c4-checkout-B", bash("git checkout -B x"), "deny");
expect("c4-checkout-force", bash("git checkout -f x"), "deny");
expect("c4-checkout-dot", bash("git checkout ."), "deny");
expect("c4-pull-no-ff", bash("git pull --no-ff"), "deny");
expect("c4-push-u-main", bash("git push -u origin main"), "deny");
expect("c4-push-u-head", bash("git push -u origin HEAD"), "deny");
expect("c4-push-u-refs", bash("git push -u origin refs/heads/x"), "deny");
expect("c4-push-u-colon", bash("git push -u origin x:y"), "deny");
expect("c4-stash", bash("git stash"), "deny");
expect("c4-cherry-pick", bash("git cherry-pick abc"), "deny");
expect("c4-tag", bash("git tag v1"), "deny");
expect("c4-remote-add", bash("git remote add o url"), "deny");
expect("c4-config", bash("git config user.name x"), "deny");
expect("c4-gh-pr-close", bash("gh pr close 26"), "deny");
expect("c4-gh-release", bash("gh release create v1"), "deny");
expect("c4-gh-bare", bash("gh auth status"), "deny");

// === FIX A — DE-QUOTE pathspec / branch tokens before validating =============
// Quoted push destinations that must DENY (push-to-default / force / option-like).
expect("dq-push-quoted-main", bash('git push -u origin "main"'), "deny");
expect("dq-push-quoted-master", bash('git push -u origin "master"'), "deny");
expect("dq-push-quoted-plus", bash('git push -u origin "+feature/x"'), "deny");
expect("dq-push-quoted-dashx", bash('git push -u origin "-x"'), "deny");
expect("dq-push-single-main", bash("git push -u origin 'main'"), "deny");
// Quoted `git add` stage-everything / flag / magic / empty -> DENY.
expect("dq-add-quoted-dot", bash('git add "."'), "deny");
expect("dq-add-quoted-dotslash", bash('git add "./"'), "deny");
expect("dq-add-quoted-A", bash('git add "-A"'), "deny");
expect("dq-add-quoted-colon-slash", bash('git add ":/"'), "deny");
expect("dq-add-quoted-empty", bash('git add ""'), "deny");
expect("dq-add-single-dot", bash("git add '.'"), "deny");
// Legit quoted-free pushes / adds still ALLOW (no regression).
expect("dq-push-feature-allow", bash("git push -u origin feature/x"), "allow");
expect("dq-push-setupstream-allow", bash("git push --set-upstream origin fix/y"), "allow");
expect("dq-add-path-allow", bash("git add src/x.ts"), "allow");
expect("dq-add-subdir-allow", bash("git add src/"), "allow");

// === FIX B — normalize `..` traversal in `git add` pathspecs =================
expect("trav-add-dot-dotdot", bash("git add ./src/../"), "deny");
expect("trav-add-a-dotdot", bash("git add a/../"), "deny");
expect("trav-add-dot-slashslash", bash("git add .//"), "deny");
expect("trav-add-xy-dotdotdotdot", bash("git add x/y/../../"), "deny");
expect("trav-add-parent-src", bash("git add ../src/x.ts"), "deny");
expect("trav-add-parent-parent", bash("git add ../../x"), "deny");
expect("trav-add-dotgit", bash("git add .git/"), "deny");
expect("trav-add-dotgit-config", bash("git add .git/config"), "deny");
expect("trav-add-absolute", bash("git add /etc/passwd"), "deny");
// Normalization must NOT over-reject a legit in-tree path with interior `..`-free
// segments resolving inside the tree.
expect("trav-add-nested-allow", bash("git add src/sub/x.ts"), "allow");
expect("trav-add-a-b-allow", bash("git add a/b/c.ts"), "allow");

// === FIX C — git switch target must be a real branch, not HEAD/detach-y ======
expect("sw-head", bash("git switch HEAD"), "deny");
expect("sw-head-lower", bash("git switch head"), "deny");
expect("sw-at-dash1", bash("git switch @{-1}"), "deny");
expect("sw-at", bash("git switch @"), "deny");
expect("sw-at-upstream", bash("git switch @{u}"), "deny");
expect("sw-quoted-head", bash('git switch "HEAD"'), "deny");
// T01: a quoted `"-c"` de-quotes to the now-permitted create flag, so
// `git switch "-c" x` is ALLOW (covered as `t01-switch-c-quoted-c-flag` below).
// The de-quote-then-reject intent for switch is preserved by `sw-quoted-head`
// above and `t01-switch-c-quoted-main` (quoted protected target -> DENY) below.
expect("sw-main-allow", bash("git switch main"), "allow");
expect("sw-feature-allow", bash("git switch feature/x"), "allow");

// === T01 — safe feature-branch CREATION via `git switch -c <branch>` ==========
// Tier-1 re-calibration: branch creation is local + reversible, so ALLOW
// `git switch -c <safe-feature-branch>` for a non-runner — iff the de-quoted
// branch passes the SAME `isSafeFeatureBranch` shape filter the push allowlist
// uses. `-C`, any extra flag, any start-point, protected/default targets, unsafe
// shapes, and any runner (`forge-*`) all stay DENY. Strictly additive: only the
// new `-c <branch>` allow-shape; the deny engine + every other case unchanged.

// AC1 — ALLOW safe feature-branch creation (non-runner).
expect("t01-switch-c-forge", bash("git switch -c forge/x/y-z"), "allow");
expect("t01-switch-c-feature", bash("git switch -c feature/abc"), "allow");
expect("t01-switch-c-fix", bash("git switch -c fix/123"), "allow");
expect("t01-switch-c-create-long", bash("git switch --create feature/abc"), "deny"); // only `-c` is the allowed flag spelling; `--create` is an extra/unknown flag -> DENY
expect("t01-switch-c-deep", bash("git switch -c feat/sub/deep-name"), "allow");

// AC2 — DENY protected / default targets (main/master/HEAD, any case).
expect("t01-switch-c-main", bash("git switch -c main"), "deny");
expect("t01-switch-c-master", bash("git switch -c master"), "deny");
expect("t01-switch-c-head", bash("git switch -c HEAD"), "deny");
expect("t01-switch-c-main-upper", bash("git switch -c MAIN"), "deny");

// AC3 — DENY `-C` (force-create / reset is NOT the allowed shape).
expect("t01-switch-cap-c", bash("git switch -C x"), "deny");
expect("t01-switch-cap-c-feature", bash("git switch -C feature/x"), "deny");

// AC4 — DENY any additional flag, or any additional positional (start-point).
expect("t01-switch-c-force", bash("git switch -c feature/x --force"), "deny");
expect("t01-switch-c-detach", bash("git switch -c feature/x --detach"), "deny");
expect("t01-switch-c-discard", bash("git switch -c feature/x --discard-changes"), "deny");
expect("t01-switch-c-startpoint", bash("git switch -c feature/x origin/main"), "deny");
expect("t01-switch-c-startpoint-sha", bash("git switch -c feature/x abc1234"), "deny");
expect("t01-switch-c-flag-after", bash("git switch -c feature/x -t"), "deny");
expect("t01-switch-c-double-c", bash("git switch -c -c feature/x"), "deny"); // two `-c` flags, branch arg absent in the slot -> DENY
expect("t01-switch-c-no-branch", bash("git switch -c"), "deny"); // `-c` with no positional -> DENY

// AC5 — DENY quoted / obfuscated bypasses via the existing de-quote path.
expect("t01-switch-c-quoted-main", bash('git switch -c "main"'), "deny");
expect("t01-switch-c-single-main", bash("git switch -c 'main'"), "deny");
expect("t01-switch-c-backslash-main", bash("git switch -c ma\\in"), "deny");
expect("t01-switch-c-quoted-head", bash('git switch -c "HEAD"'), "deny");
expect("t01-switch-c-quoted-c-flag", bash('git switch "-c" feature/x'), "allow"); // quoted `-c` de-quotes to the flag; safe branch -> ALLOW (de-quote normalizes, shape unchanged)
expect("t01-switch-c-quoted-master", bash('git switch -c "master"'), "deny");

// AC2/shape — DENY unsafe branch shapes on `-c` (reuse `isSafeFeatureBranch`).
expect("t01-switch-c-refs", bash("git switch -c refs/heads/x"), "deny");
expect("t01-switch-c-colon", bash("git switch -c x:y"), "deny");
expect("t01-switch-c-dotdot", bash("git switch -c a/../b"), "deny");
expect("t01-switch-c-tilde", bash("git switch -c feature~1"), "deny");
expect("t01-switch-c-glob", bash("git switch -c feat/*"), "deny");
expect("t01-switch-c-leading-dash", bash("git switch -c -weird"), "deny");
expect("t01-switch-c-empty-seg", bash("git switch -c feature//x"), "deny");

// AC7 — a RUNNER (`forge-*`) gets NO branch creation (L3 unchanged).
expect("t01-runner-switch-c-deny", bash("git switch -c feature/x", "forge-core-runner"), "deny");
expect("t01-runner-switch-c-engineer-deny", bash("git switch -c feature/x", "forge-engineer"), "deny");

// AC8 — complex/dynamic/obfuscated `switch -c` forms still hit the DENY engine.
expect("t01-switch-c-chain", bash("git switch -c feature/x && git push --force origin main"), "deny");
expect("t01-switch-c-subst", bash('git switch -c "$(echo main)"'), "deny");
expect("t01-switch-c-group", bash("( git switch -c feature/x )"), "deny");

// AC6 — `git switch <existing-branch>` keeps its Class-1 ALLOW (no regression).
expect("t01-switch-existing-still-allow", bash("git switch develop"), "allow");

// === gh quoted ARG values still ALLOW (quote rule is pathspec/branch only) ====
expect("gh-quoted-create", bash('gh pr create --title "my title" --body "fixes bug"'), "allow");
expect("gh-view-allow", bash("gh pr view 26"), "allow");

// === Pass-through — non-git/gh commands ======================================
expect("pt-pnpm-test", bash("pnpm test"), "pass");
expect("pt-ls", bash("ls -la"), "pass");
expect("pt-node", bash("node dist/cli.js"), "pass");
expect("pt-echo-home", bash("echo $HOME"), "pass");

// === Runner L3 ===============================================================
expect("runner-status-allow", bash("git status", "forge-core-runner"), "allow");
expect("runner-diff-allow", bash("git diff", "forge-core-runner"), "allow");
expect("runner-log-allow", bash("git log", "forge-core-runner"), "allow");
expect("runner-show-allow", bash("git show HEAD", "forge-core-runner"), "allow");
expect("runner-rev-parse-allow", bash("git rev-parse HEAD", "forge-core-runner"), "allow");
expect("runner-add-deny", bash("git add x", "forge-core-runner"), "deny");
expect("runner-push-deny", bash("git push -u origin feature/x", "forge-core-runner"), "deny");
expect("runner-gh-create-deny", bash("gh pr create --title t", "forge-core-runner"), "deny");
expect("runner-fetch-deny", bash("git fetch", "forge-core-runner"), "deny");
expect("runner-switch-deny", bash("git switch main", "forge-core-runner"), "deny");
expect("runner-checkout-deny", bash("git checkout main", "forge-core-runner"), "deny");
expect("runner-branch-deny", bash("git branch", "forge-core-runner"), "deny");
expect("runner-pull-deny", bash("git pull --ff-only", "forge-core-runner"), "deny");
// Any forge-* role is a runner for L3 purposes.
expect("runner-role-engineer-add-deny", bash("git add x", "forge-engineer"), "deny");
expect("runner-role-engineer-status-allow", bash("git status", "forge-engineer"), "allow");
// A non-forge agent type is NOT a runner.
expect("nonrunner-other-push-allow", bash("git push -u origin feature/x", "some-other-agent"), "allow");

// === Deny-engine regression — obfuscation / grouping / chaining / dynamic ====
// (Re-included from the proven engine; all must still DENY.)
expect("de-chain-and", bash("git status && git push --force origin main"), "deny");
expect("de-chain-semicolon", bash("git status; git push origin main"), "deny");
expect("de-chain-pipe", bash("echo x | git apply"), "deny");
expect("de-group-paren", bash("( git push --force origin main )"), "deny");
expect("de-group-brace", bash("{ git push --force origin main; }"), "deny");
expect("de-negation", bash("! git push origin main"), "deny");
expect("de-subst-dollar-paren", bash('gh pr create --title "$(git push --force origin main)"'), "deny");
expect("de-subst-backtick", bash("echo `git push origin main`"), "deny");
expect("de-command-git", bash("command git push origin main"), "deny");
expect("de-xargs-git", bash("echo main | xargs git push origin"), "deny");
expect("de-quote-splice-single", bash("g'i't status"), "deny");
expect("de-quote-splice-double", bash('g"i"t status'), "deny");
expect("de-backslash-splice", bash("g\\i\\t status"), "deny");
expect("de-line-continuation", bash("g\\\nit push origin main"), "deny");
expect("de-dynamic-var", bash("$GIT push origin main"), "deny");
expect("de-dynamic-brace-var", bash("${GIT} push origin main"), "deny");
expect("de-dynamic-glob", bash("gi? status"), "deny");
expect("de-env-git", bash("env git push origin main"), "deny");
expect("de-var-assign-git", bash("FOO=bar git push origin main"), "deny");
expect("de-path-git", bash("/usr/bin/git push origin main"), "deny");
expect("de-redirect", bash("git status > out.txt"), "deny");
// A grouped NON-git command has no git/gh mention; after grouping-strip the
// program token is `pnpm` (static), so it PASSES THROUGH (defer to normal flow).
expect("de-group-nongit-passthrough", bash("( pnpm test )"), "pass");
// A chained NON-git command (`pnpm test && pnpm build`) — no git/gh mention,
// program token `pnpm`, no command substitution -> pass-through.
expect("pt-chain-nongit", bash("pnpm test && pnpm build"), "pass");

// === Fail-closed — malformed / undecidable input =============================
expect("fc-null", null, "block");
expect("fc-string", "not an object", "block");
expect("fc-missing-command", { tool_name: "Bash", tool_input: {} }, "block");
expect("fc-empty-command", bash("   "), "block");
expect("fc-non-bash-pass", { tool_name: "Read", tool_input: { file_path: "/x" } }, "pass");

// === Report ==================================================================
if (failures.length > 0) {
  process.stderr.write(`forge-permissions self-check FAILED: ${failures.length} failure(s), ${pass} passed\n`);
  process.stderr.write(failures.join("\n") + "\n");
  process.exit(1);
}
process.stdout.write(`forge-permissions self-check OK: ${pass} assertions passed\n`);
process.exit(0);

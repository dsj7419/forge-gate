#!/usr/bin/env node
// Forge PreToolUse permissions hook — FOUR-CLASS git/gh policy on top of the
// PROVEN deny engine.
//
// History / why this shape:
//   The deny engine below survived ~8 adversarial rounds. It was defeated, in
//   turn, by command chaining / substitution / quoting / path- and env-qualified
//   program tokens, then by DYNAMIC program tokens (`$GIT`, `${GIT}`, `$'\x67it'`,
//   `$"git"`, backtick `which git`), and finally by SHELL GROUPING / NEGATION
//   (`( git push ... )`, `{ git ...; }`, `! git ...`). The durable fix: the DENY
//   side NO LONGER parses for a program token; it scans a DE-OBFUSCATED copy of
//   the raw command for a literal git/gh MENTION and refuses any complex/dynamic/
//   obfuscated form. That engine is PRESERVED VERBATIM here.
//
//   Its ONLY prior defect was OPERATIONAL, not adversarial: it allowed nothing
//   but the two PR allow-shapes, so on activation it refused safe local Git
//   (`git status`, `git diff`, `git log`, `git add`, `git fetch`, `git switch`),
//   making the repo unusable. This revision ADDS the safe-Git allowlist (the
//   four-class model) so daily Git works, WITHOUT loosening the deny engine.
//
// Four-class model (implemented EXACTLY):
//   For a command that MENTIONS git/gh and is SIMPLE/STATIC (no shell-control
//   metacharacters — the same dangerous-char gate the deny engine uses):
//     - Runner agent (`forge-core-runner` / `forge-*`): ALLOW only Class-1
//       read-only shapes (`git status`/`diff`/`log`/`show`/`rev-parse`); DENY
//       everything else (all staging/push/PR/merge/restore/checkout/reset/
//       branch-mutation/gh) — L3 backstop.
//     - Non-runner: ALLOW iff the command matches a known-safe Class-1/2/3 shape;
//       otherwise DENY.
//         Class 1 (read-only/local): git status, diff, log, show, rev-parse,
//           branch (LIST only), fetch (no --force), pull --ff-only (no bare/
//           --rebase/--no-ff), switch <branch> (no -c/-C/--force/--detach/
//           --discard-changes; <branch> must be a simple branch name per the
//           shared push filter). git checkout is DENIED IN EVERY FORM (its bare-
//           positional shape is git's silent worktree-restore; branch navigation
//           is via `git switch` only). Any destructive/unknown flag on a Class-1
//           verb -> DENY.
//         Class 2 (staging): git add <explicit-path(s)>; DENY `.`/`./`/`..`/`../`/
//           `/.`/`/..`-suffixed/`-A`/`--all`/`:/`/magic/`*`/glob/empty pathspec.
//         Class 3 (PR workflow): git push -u|--set-upstream origin
//           <simple-feature-branch> (not main/master/HEAD/refs/force/colon/+);
//           gh pr create|view|checks.
//         Class 4 (everything else) -> DENY.
//   For a command that involves/could-hide git/gh and is COMPLEX/DYNAMIC/
//   OBFUSCATED -> DENY (the deny engine). For a NON-git/gh command ->
//   PASS-THROUGH. Fail-closed on undecidable.
//
// Architectural rule (non-negotiable): do NOT refuse every git/gh mention.
//   simple+static+known-safe-shape -> ALLOW
//   simple+static+unknown/unsafe git/gh -> DENY
//   complex/dynamic/obfuscated git/gh -> DENY (deny engine)
//   non-git/gh -> PASS-THROUGH
//
// Layering (runner-safety preservation):
//   L1 — the runner workflow contains no outward-action stage (unchanged).
//   L2 — the forge-core-runner charter forbids outward actions, self-standing.
//   L3 — this hook refuses every mutating/outward git/gh action from a forge
//        runner agent; a runner gets ONLY Class-1 read-only git.
//
// This file is self-contained: plain Node ESM, no package or build dependency.
// The decision function `decide(input)` is pure and unit-testable; the stdin/exit
// wrapper at the bottom only runs when invoked as a script.
//
// Decision protocol:
//   - "allow" -> emit hookSpecificOutput allow (exit 0)
//   - "deny"  -> emit hookSpecificOutput deny (exit 0) for an inspectable refusal
//   - "pass"  -> NON-blocking pass-through: emit nothing, exit 0, deferring to the
//                normal Claude Code permission flow (no git/gh, no dynamic program)
//   - "block" -> hard fail-closed: stderr + exit 2 (undecidable / errored input)
//
// Over-refusal of exotic dynamic / grouped shell forms is ACCEPTABLE and intended.

/** Branch names that must never be a push destination. */
const FORBIDDEN_BRANCHES = new Set(["main", "master", "head"]);

/** Roles whose agents must never perform a mutating/outward action (L3). */
function isForgeRunnerAgent(agentType) {
  if (typeof agentType !== "string") return false;
  return agentType === "forge-core-runner" || agentType.startsWith("forge-");
}

/**
 * Shell-control metacharacters that, OUTSIDE quoted argument values, mark a
 * command as too complex / capable of hiding or chaining a git/gh action. Their
 * presence disqualifies a command from any ALLOW.
 */
const META_CHARS = /[;|&$`(){}<>!\n\r]/;

/**
 * Dangerous characters/sequences that DISQUALIFY a command from any safe-shape
 * ALLOW even when they appear INSIDE a double-quoted argument value. Bash STILL
 * performs `$(...)` command substitution, backtick substitution, and `$VAR` /
 * `${...}` parameter expansion inside double quotes — only SINGLE quotes suppress
 * them — and braces/grouping/redirection/control are always live. So a title like
 *   gh pr create --title "$(git push --force origin main)"
 * runs the real git binary at expansion time. We therefore test this set against
 * the command with ONLY single-quoted spans removed (never double-quoted spans).
 */
const ALLOW_DANGEROUS_CHARS = /[$`(){};|&<>\n\r]/;

/**
 * Build a copy of the raw command with ONLY single-quoted spans removed. Bash
 * suppresses ALL expansion inside single quotes, so their contents can never
 * resolve to a program; double-quoted spans are LEFT INTACT so that any `$(...)`,
 * backtick, or `$VAR` inside them is still visible to the dangerous-char scan.
 */
function stripSingleQuotedSpans(command) {
  return String(command).replace(/'[^']*'/g, "");
}

/**
 * True if the RAW command (after removing only single-quoted spans) contains any
 * dangerous character/sequence that bash would still act on inside double quotes
 * — command substitution, parameter expansion, grouping, redirection, chaining,
 * or control. Such a command is NEVER a safe shape and must fall through to the
 * deny side.
 */
function hasAllowDangerousChars(command) {
  const scan = stripSingleQuotedSpans(command);
  if (ALLOW_DANGEROUS_CHARS.test(scan)) return true;
  if (/&&|\|\|/.test(scan)) return true;
  return false;
}

/**
 * Build a DE-OBFUSCATED scan copy of the raw command for MENTION detection by
 * COMPLETELY emulating bash's non-`$` quote/backslash token-assembly removal —
 * the exact mechanisms by which a program word can be spliced from fragments
 * WITHOUT a `$`-expansion. (Full rationale preserved from the proven engine.)
 */
function deobfuscateForScanVariant(command, joinChar) {
  const s = String(command);
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    if (ch === "'") {
      // Single-quoted span: literal contents, no backslash processing.
      i++;
      while (i < s.length && s[i] !== "'") {
        out += s[i];
        i++;
      }
      i++; // consume closing quote (or end of string)
      continue;
    }

    if (ch === '"') {
      // Double-quoted span: contents spliced; `\` before newline = continuation.
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\") {
          const next = s[i + 1];
          if (next === "\n") {
            out += joinChar; // line-continuation inside double quotes
            i += 2;
            continue;
          }
          if (next === "\r" && s[i + 2] === "\n") {
            out += joinChar;
            i += 3;
            continue;
          }
          if (next === undefined) {
            out += "\\"; // trailing lone backslash inside an unterminated quote
            i++;
            continue;
          }
          // For the SCAN, ANY `\x` inside double quotes -> joinChar + `x`.
          out += joinChar + next;
          i += 2;
          continue;
        }
        out += s[i];
        i++;
      }
      i++; // consume closing quote (or end of string)
      continue;
    }

    if (ch === "\\") {
      const next = s[i + 1];
      if (next === undefined) {
        // Trailing lone backslash: keep it literal.
        out += "\\";
        i++;
        continue;
      }
      if (next === "\n") {
        // Line-continuation: bash deletes `\<LF>`; we emit the variant joinChar.
        out += joinChar;
        i += 2;
        continue;
      }
      if (next === "\r" && s[i + 2] === "\n") {
        // Windows line-continuation `\<CR><LF>`: same handling.
        out += joinChar;
        i += 3;
        continue;
      }
      // General escape: `\x` -> joinChar + `x` (splice deletes, path separates).
      out += joinChar + next;
      i += 2;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/** Both de-obfuscated scan variants (backslash-splice + backslash-separate). */
function deobfuscateForScan(command) {
  return [deobfuscateForScanVariant(command, ""), deobfuscateForScanVariant(command, " ")];
}

/**
 * De-quote / de-obfuscate a SINGLE shell token before applying the ALLOW-shape
 * equality / prefix / branch-name / pathspec checks. The four-class classifiers
 * compare RAW whitespace-split tokens, so a token can carry surrounding or
 * interior quotes (`"main"`, `"."`, `'+x'`, `""`, `sr"c"/x.ts`) or backslash
 * escapes (`ma\in`) that bash strips at word-assembly time but the raw-token
 * comparison does not — letting a quoted `"main"` / `"."` / `"+feature/x"` slip
 * every reject. We reuse the SAME backslash/quote de-obfuscation the deny engine
 * uses for its mention scan (the splice variant, `joinChar = ""`), so the cleaned
 * token is exactly what bash would hand to git as the argument value:
 *   `"main"`->`main`, `"."`->`.`, `"+feature/x"`->`+feature/x`, `""`->``,
 *   `sr"c"/x.ts`->`src/x.ts`, `'-A'`->`-A`, `":/"`->`:/`.
 * Precondition: the command already passed the SIMPLE/STATIC gate, so the token
 * contains no live `$`/backtick/grouping/redirection — only quote/backslash
 * word-assembly to undo.
 */
function deQuoteToken(token) {
  return deobfuscateForScanVariant(token, "");
}

/**
 * Step 2 — does ANY de-obfuscated scan variant MENTION git or gh as a whole
 * word? Case-insensitive `\bgit\b` / `\bgh\b`. This is the deny trigger; it does
 * not care WHERE the word sits.
 */
function mentionsGitOrGh(scanVariants) {
  for (const v of scanVariants) {
    if (/\bgit\b/i.test(v) || /\bgh\b/i.test(v)) return true;
  }
  return false;
}

/**
 * True if the RAW command contains `$(` or a backtick anywhere (command
 * substitution). Either can resolve to a program at runtime; on the
 * no-literal-mention path its presence is itself the refusal trigger.
 */
function hasCommandSubstitution(command) {
  const c = String(command);
  return c.includes("$(") || c.includes("`");
}

/**
 * Tokenize a segment into shell-aware words: whitespace separates tokens EXCEPT
 * inside single/double quotes. Quote characters are retained in the token.
 * A recognizer, not a full shell parser.
 */
function shellTokenize(segment) {
  const s = String(segment).trim();
  const tokens = [];
  let cur = "";
  let quote = null;
  let started = false;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        tokens.push(cur);
        cur = "";
        started = false;
      }
      continue;
    }
    cur += ch;
    started = true;
  }
  if (started) tokens.push(cur);
  return tokens;
}

/**
 * Extract the PROGRAM token used by the PASS-THROUGH dynamic check: the first
 * shell-aware word, AFTER stripping any leading shell GROUPING / NEGATION prefix
 * (`(`, `((`, `{`, `!`), a leading `env` launcher, and any `VAR=val` assignment
 * prefixes. (Runs only when there is NO literal git/gh mention.)
 */
function passThroughProgramToken(command) {
  let tokens = shellTokenize(command);

  // Strip leading grouping / negation tokens, possibly several in a row.
  while (tokens.length > 0) {
    const head = tokens[0];
    if (/^[({!]+$/.test(head)) {
      tokens = tokens.slice(1);
      continue;
    }
    const peeled = head.replace(/^[({!]+/, "");
    if (peeled !== head) {
      tokens = [peeled, ...tokens.slice(1)];
      continue;
    }
    break;
  }

  // Strip a leading `env` launcher and any `VAR=val` assignment prefixes.
  let i = 0;
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue;
    if (t === "env" || /(?:^|[\\/])env(?:\.exe)?$/i.test(t)) {
      i++;
      for (; i < tokens.length; i++) {
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) continue;
        break;
      }
      break;
    }
    break;
  }

  return tokens[i] ?? "";
}

/**
 * True if the PASS-THROUGH program token is DYNAMIC — it could resolve to a
 * different program (including git/gh) at runtime even though it never literally
 * spells one.
 */
function isDynamicProgramToken(token) {
  const t = String(token);
  if (t.includes("$") || t.includes("`")) return true;
  if (/[?*[]/.test(t)) return true;
  if (/[{},]/.test(t)) return true;
  return false;
}

/**
 * Shared SIMPLE branch-name SHAPE filter (no push-destination policy). A simple
 * branch name MAY contain `/` (`feature/safe-branch`, `fix/x`, `feat/123`) but
 * must NOT be a fully-qualified/namespaced ref, carry any ref-unsafe shape
 * (`refs/...`, leading `+`/`-`, `:`-refspec, `..` range/parent traversal,
 * `@`/`~`/`^`, glob `*`/`?`/`[`/`]`, backslash, whitespace), or contain an empty
 * or `.`/`..` path segment. Used by BOTH the push allowlist and the
 * `git switch` allowlist; the push allowlist ALSO rejects protected/default
 * branches as DESTINATIONS (see `isSafeFeatureBranch`), which switch does not.
 */
function isSimpleBranchNameShape(branch) {
  if (typeof branch !== "string" || branch === "") return false;
  const lower = branch.toLowerCase();
  if (lower.startsWith("refs/")) return false;
  if (lower.includes("refs/")) return false;
  if (branch.startsWith("+") || branch.startsWith("-")) return false; // force / option-like
  if (branch.includes(":")) return false; // colon-refspec / delete
  if (branch.includes("..")) return false; // range / parent traversal
  if (/[@~^?*[\]\\\s]/.test(branch)) return false; // @, ~, ^, glob, backslash, whitespace
  // No empty / `.` / `..` path segment (`.`, `./`, `../`, `a/../b`, `feature//x`).
  for (const seg of branch.split("/")) {
    if (seg === "" || seg === "." || seg === "..") return false;
  }
  return true;
}

/**
 * A SIMPLE feature-branch name for the push allowlist. Same SHAPE filter as
 * `isSimpleBranchNameShape`, PLUS it must not be a default/protected branch as a
 * push DESTINATION (`main`/`master`/`HEAD`).
 */
function isSafeFeatureBranch(branch) {
  if (!isSimpleBranchNameShape(branch)) return false;
  if (FORBIDDEN_BRANCHES.has(branch.toLowerCase())) return false;
  return true;
}

/**
 * Normalize the `.` / `..` path segments of an (already de-quoted) POSIX-style
 * pathspec, WITHOUT consulting the filesystem. Returns the collapsed path so the
 * `git add` filter can reason about where the spec actually points:
 *   `./src/../`  -> `.`      (the cwd)
 *   `a/../`      -> `.`      (the cwd)
 *   `.//`        -> `.`      (the cwd)
 *   `x/y/../../` -> `.`      (the cwd)
 *   `../src/x`   -> `../src/x` (escapes the tree — leading `..` preserved)
 *   `../../x`    -> `../../x`
 *   `src/x.ts`   -> `src/x.ts`
 *   `src/`       -> `src`
 * Leading `..` segments that cannot be cancelled are PRESERVED (they escape the
 * working tree and must be denied). An absolute path is returned with its leading
 * `/` intact. A result that collapses to nothing becomes `.` (the cwd).
 */
function normalizePathSegments(spec) {
  const s = String(spec);
  const isAbsolute = s.startsWith("/");
  const segments = s.split("/");
  const out = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue; // skip empty (`//`, trailing `/`) and `.`
    if (seg === "..") {
      const last = out[out.length - 1];
      if (out.length > 0 && last !== "..") {
        out.pop(); // cancel a prior real segment
      } else if (!isAbsolute) {
        out.push(".."); // unmatched `..` escapes the tree (relative only)
      }
      // absolute `/..` at root is a no-op (stays at root)
      continue;
    }
    out.push(seg);
  }
  if (isAbsolute) return "/" + out.join("/");
  if (out.length === 0) return "."; // collapsed to the cwd
  return out.join("/");
}

// ---------------------------------------------------------------------------
// Four-class shape classification.
//
// All classifiers below run ONLY on a SIMPLE/STATIC command — one that already
// passed `hasAllowDangerousChars(raw) === false` AND `META_CHARS.test(raw) ===
// false`. So the command is a single bare-program git/gh invocation with no
// shell control, substitution, grouping, redirection, or chaining. We can
// therefore tokenize it with plain whitespace splitting (no quote nesting can
// hide a separator at this point) and reason about flags positionally.
// ---------------------------------------------------------------------------

/** Plain whitespace tokens for a guaranteed-simple/static command. */
function simpleTokens(command) {
  return String(command).trim().split(/\s+/).filter((t) => t.length > 0);
}

/** Class-1 read-only verbs that take NO destructive flags (read-only inspection). */
const CLASS1_READONLY_VERBS = new Set(["status", "diff", "log", "show", "rev-parse"]);

/**
 * A flag (token starting with `-`) is "destructive/unknown" for a Class-1 verb.
 * For the pure read-only verbs we do not enumerate every benign flag — they are
 * read-only, so ANY flag they accept is non-mutating (`git diff --staged`,
 * `git log --oneline`, `git show HEAD`). We only need to be careful for the
 * navigation/network verbs (fetch/pull/switch/checkout/branch), handled
 * individually below.
 */

/**
 * Classify a SIMPLE/STATIC git command (tokens[0] === "git"). Returns:
 *   { class: 1|2|3, ok: true }  -> a known-safe shape (ALLOW)
 *   { ok: false }               -> not a known-safe shape (DENY)
 * `readOnlyOnly` = true restricts to Class-1 read-only inspection (runner L3).
 */
function classifyGit(tokens, readOnlyOnly) {
  // tokens[0] === "git"
  const sub = tokens[1];
  if (typeof sub !== "string" || sub === "") return { ok: false };
  const args = tokens.slice(2);

  // --- Class 1: pure read-only inspection verbs. ANY flag they accept is
  // non-mutating, so no per-flag challenge is needed. ---
  if (CLASS1_READONLY_VERBS.has(sub)) {
    return { class: 1, ok: true };
  }

  // A runner gets ONLY the pure read-only verbs above. Everything else -> DENY.
  if (readOnlyOnly) return { ok: false };

  // --- Class 1: git branch — LIST only. No -d/-D/-m/-M/-f/-c/-C, and no
  // positional branch-name argument (creating a branch). Permit only benign
  // listing flags. ---
  if (sub === "branch") {
    for (const a of args) {
      if (a.startsWith("-")) {
        // Permit only known read-only/listing flags.
        const ok = [
          "-a",
          "--all",
          "-r",
          "--remotes",
          "-l",
          "--list",
          "-v",
          "-vv",
          "--verbose",
          "--show-current",
          "--merged",
          "--no-merged",
          "--contains",
          "--no-contains",
          "--sort",
          "--format",
          "--color",
          "--no-color",
        ].includes(a);
        if (!ok) return { ok: false };
        continue;
      }
      // A bare (non-flag) token to `git branch` creates/renames a branch -> DENY.
      return { ok: false };
    }
    return { class: 1, ok: true };
  }

  // --- Class 1: git fetch — deny --force (and -f). ---
  if (sub === "fetch") {
    for (const a of args) {
      if (a === "--force" || a === "-f" || a.startsWith("--force=")) return { ok: false };
      // A refspec containing `+` (force) or `:` (mapping) is destructive shape.
      if (a.startsWith("+")) return { ok: false };
      if (!a.startsWith("-") && a.includes(":")) return { ok: false };
    }
    return { class: 1, ok: true };
  }

  // --- Class 1: git pull — ONLY `--ff-only`. Deny bare pull / --rebase /
  // --no-ff / --force. The `--ff-only` flag MUST be present. ---
  if (sub === "pull") {
    if (!args.includes("--ff-only")) return { ok: false };
    for (const a of args) {
      if (a === "--ff-only") continue;
      if (a === "--rebase" || a.startsWith("--rebase=") || a === "-r") return { ok: false };
      if (a === "--no-ff" || a === "--ff") return { ok: false };
      if (a === "--force" || a === "-f") return { ok: false };
      // Any other flag on pull -> unknown -> DENY (challenge unknown flags).
      if (a.startsWith("-")) return { ok: false };
      // A positional remote/branch with `:` refspec or `+` -> DENY.
      if (a.startsWith("+") || a.includes(":")) return { ok: false };
    }
    return { class: 1, ok: true };
  }

  // --- Class 1: git switch <branch> — deny -c/-C/--create/--force/--detach/
  // --discard-changes and any other flag. Exactly one positional, which MUST be a
  // simple branch name per the SAME `isSafeFeatureBranch` filter used for push
  // (rejects `..`, `~`, `^`, `:`, leading `-`, `refs/...`, `*`/glob, `.`/`./`/
  // `../`, `a/../b`, empty, multi-positional). git switch never operates on
  // pathspecs, so a clean branch name is unambiguous and safe. ---
  if (sub === "switch") {
    const positionals = [];
    for (const a of args) {
      // De-quote/de-obfuscate the token FIRST so a quoted flag (`"-c"`) or quoted
      // detach target (`"HEAD"`) cannot slip the flag / shape checks.
      const clean = deQuoteToken(a);
      if (clean.startsWith("-")) return { ok: false }; // any flag on switch -> DENY
      positionals.push(clean);
    }
    if (positionals.length !== 1) return { ok: false };
    const target = positionals[0];
    // FIX 3 — `git switch HEAD`/`@`/`@{-1}`/`@{u}` detaches HEAD or resolves a
    // revision, NOT a branch checkout. Deny HEAD (any case), `@`, and any `@{...}`
    // reflog/upstream selector. The shape filter below already rejects `~`/`^`/`:`/
    // `..`/glob, so this only needs to add the HEAD/`@` cases.
    if (target.toLowerCase() === "head") return { ok: false };
    if (target === "@" || target.includes("@{") || target.includes("@")) return { ok: false };
    // Apply the SHARED simple-branch-name SHAPE filter (rejects `..`/`~`/`^`/`:`/
    // leading `-`/`refs/...`/glob/`*`/`.`/`./`/`../`/`a/../b`/empty). Unlike push,
    // switch permits `main`/`master` (they are valid navigation targets, not push
    // destinations), so we use the shape filter, NOT `isSafeFeatureBranch`.
    if (!isSimpleBranchNameShape(target)) return { ok: false };
    return { class: 1, ok: true };
  }

  // --- git checkout — DENIED IN EVERY FORM. `git checkout <positional>` without
  // `--` is git's worktree-restore form: when the arg names a tracked file with
  // uncommitted edits, git SILENTLY DISCARDS those edits, and the hook cannot
  // statically tell a branch name from a pathspec. So the entire allow-shape is
  // unsafe and removed. Branch navigation is permitted ONLY via `git switch
  // <branch>` (git switch never operates on pathspecs, so it is unambiguous).
  // `git checkout main`/`src/x.ts`/`HEAD~1`/`-- f`/`.` -> ALL DENY. ---
  if (sub === "checkout") {
    return { ok: false };
  }

  // --- Class 2: git add <explicit-path(s)>. ALLOW only explicit, non-glob,
  // non-dot, non-magic file/subdir paths (`git add src/x.ts`, `git add src/`).
  // DENY if ANY pathspec is `.`/`./`/`..`/`../`, ends in `/.` or `/..`, is `*` or
  // contains a glob (`*`/`?`/`[`), starts with `:` (magic pathspec), is empty, or
  // is exactly the cwd/parent. At least one explicit path arg required. This
  // closes the directory-everything bypass (`git add ./`/`../` previously slipped
  // past the bare-`.` check). ---
  if (sub === "add") {
    if (args.length === 0) return { ok: false };
    for (const a of args) {
      // FIX 1 — de-quote/de-obfuscate the token FIRST so a quoted `"."`/`"-A"`/
      // `":/"`/`""` (or interior-quoted/backslash-spliced spelling) cannot slip
      // the rejects below. `"."`->`.`, `"-A"`->`-A`, `":/"`->`:/`, `""`->``.
      const clean = deQuoteToken(a);
      if (clean === "") return { ok: false }; // empty pathspec -> DENY
      if (clean.startsWith("-")) return { ok: false }; // -A/--all/-u/-p/etc -> DENY
      if (clean.startsWith(":")) return { ok: false }; // magic pathspec (`:/`, `:(top)`) -> DENY
      // FIX 4 — reject a leading `~`: bash expands an UNQUOTED leading tilde
      // (`~`, `~/x`, `~root/x`) to an absolute path OUTSIDE the working tree
      // BEFORE git ever sees it, mirroring the absolute-path reject below. The
      // simplest safe choice is to reject any pathspec whose de-quoted leading
      // char is `~` (a quoted `"~/x"` is a literal in-tree path, but denying it
      // too is conservative and matches the existing reject style).
      if (clean.startsWith("~")) return { ok: false }; // tilde-expansion -> out-of-tree -> DENY
      if (clean.includes("*") || clean.includes("?") || clean.includes("[")) return { ok: false }; // glob -> DENY
      // FIX 2 — normalize `.`/`..` segments, then reject anything that collapses
      // to the cwd, escapes the working tree, is absolute, or targets `.git`.
      const norm = normalizePathSegments(clean);
      if (norm === "" || norm === "." || norm === "..") return { ok: false }; // stage-everything cwd/parent -> DENY
      if (norm === ".." || norm.startsWith("../")) return { ok: false }; // escapes the tree -> DENY
      if (norm.startsWith("/")) return { ok: false }; // absolute path -> DENY
      if (norm === ".git" || norm.startsWith(".git/")) return { ok: false }; // the repo internals -> DENY
    }
    return { class: 2, ok: true };
  }

  // --- Class 3: git push -u|--set-upstream origin <simple-feature-branch>. ---
  if (sub === "push") {
    // Reuse the proven exact-shape: exactly `-u|--set-upstream origin <branch>`.
    if (args.length !== 3) return { ok: false };
    // FIX 1 — de-quote/de-obfuscate EACH token first so a quoted `"main"`/
    // `"master"`/`"+feature/x"`/`"-x"` (push-to-default / force-refspec / option-
    // like) cannot slip the branch-destination policy. `"main"`->`main`,
    // `"+feature/x"`->`+feature/x`, `"-x"`->`-x`.
    const flag = deQuoteToken(args[0]);
    const remote = deQuoteToken(args[1]);
    const branch = deQuoteToken(args[2]);
    if (flag !== "-u" && flag !== "--set-upstream") return { ok: false };
    if (remote !== "origin") return { ok: false };
    if (!isSafeFeatureBranch(branch)) return { ok: false };
    return { class: 3, ok: true };
  }

  // Everything else (reset, restore, clean, merge, rebase, commit, stash,
  // cherry-pick, revert, tag, remote, config, branch-creation, ...) -> DENY.
  return { ok: false };
}

/**
 * Classify a SIMPLE/STATIC gh command (tokens[0] === "gh"). Class 3 permits
 * `gh pr create|view|checks` only; everything else (pr merge/close, api, ...)
 * -> DENY. A runner gets NO gh at all.
 */
function classifyGh(tokens, readOnlyOnly) {
  if (readOnlyOnly) return { ok: false }; // runner: no gh by any spelling
  if (tokens[1] !== "pr") return { ok: false };
  const action = tokens[2];
  if (action === "create" || action === "view" || action === "checks") {
    return { class: 3, ok: true };
  }
  return { ok: false };
}

/**
 * Decide a SIMPLE/STATIC command that MENTIONS git/gh, by the four-class model.
 * Returns "allow" | "deny". `runner` restricts to Class-1 read-only.
 *
 * Precondition: caller has established the command is simple/static (no dangerous
 * chars, no META_CHARS) and mentions git/gh.
 */
function decideSafeGitShape(command, runner) {
  const tokens = simpleTokens(command);
  const program = tokens[0];

  if (program === "git") {
    const r = classifyGit(tokens, runner);
    return r.ok ? "allow" : "deny";
  }
  if (program === "gh") {
    const r = classifyGh(tokens, runner);
    return r.ok ? "allow" : "deny";
  }

  // A git/gh mention where the PROGRAM is not literally git/gh (e.g. `command
  // git`, `xargs git`, a path-qualified `/usr/bin/git`) is NOT a recognized safe
  // shape -> DENY. (The deny engine would also catch most of these; this is the
  // conservative floor.)
  return "deny";
}

/**
 * Pure decision function. Returns one of:
 *   { decision: "allow"|"deny", reason }   -> inspectable PreToolUse output
 *   { decision: "pass", reason }           -> non-blocking pass-through (defer)
 *   { decision: "block", reason }          -> hard fail-closed (exit 2)
 */
export function decide(input, deps = {}) {
  void deps; // no external deps needed; kept for call parity
  try {
    if (input === null || typeof input !== "object") {
      return { decision: "block", reason: "undecidable: hook input is not an object" };
    }
    if (input.tool_name !== "Bash") {
      return { decision: "pass", reason: "non-Bash tool: not governed by this hook" };
    }
    const command = input?.tool_input?.command;
    if (typeof command !== "string" || command.trim() === "") {
      return { decision: "block", reason: "undecidable: missing Bash command string" };
    }

    const runner = isForgeRunnerAgent(input.agent_type);

    // De-obfuscated scan variants + mention test (used by every git/gh branch).
    const scanVariants = deobfuscateForScan(command);
    const mentions = mentionsGitOrGh(scanVariants);

    // Is the RAW command SIMPLE/STATIC? No dangerous chars (even inside double
    // quotes) and no shell-control metacharacters at all. Only such a command is
    // eligible for the four-class safe-shape allowlist; anything else that
    // mentions git/gh falls to the deny engine.
    const rawHasMeta = META_CHARS.test(command);
    const simpleStatic = !hasAllowDangerousChars(command) && !rawHasMeta;

    if (mentions) {
      // --- git/gh, SIMPLE/STATIC: classify by the four-class model. A runner is
      // restricted to Class-1 read-only; a non-runner gets Class-1/2/3. This
      // single path serves BOTH the runner L3 backstop (readOnly) and the
      // non-runner allowlist. ---
      if (simpleStatic) {
        const verdict = decideSafeGitShape(command, runner);
        if (verdict === "allow") {
          return {
            decision: "allow",
            reason: runner
              ? "forge runner agent: read-only Class-1 git inspection permitted (L3: mutating/outward git/gh denied)"
              : "simple/static git/gh command matches a known-safe Class-1/2/3 shape: permitted",
          };
        }
        return {
          decision: "deny",
          reason: runner
            ? "forge runner agents perform no mutating/outward git/gh action; only read-only Class-1 git permitted (L3 backstop)"
            : "simple/static git/gh command is not a known-safe Class-1/2/3 shape (destructive/unknown form): refused (Class-4)",
        };
      }

      // --- git/gh, COMPLEX/DYNAMIC/OBFUSCATED: the proven deny engine. A literal
      // git/gh mention behind grouping/negation/chaining/substitution/quote-
      // splice is refused; we do NOT parse for a program token here. Covers the
      // runner case too (a runner never reaches an allow for a complex form). ---
      return {
        decision: "deny",
        reason:
          "command mentions git/gh (de-obfuscated) in a complex/dynamic/obfuscated form: refused (grouping/negation/chaining/substitution/obfuscation all caught)",
      };
    }

    // --- No literal git/gh mention. Inspect the program token; a DYNAMIC program
    // (or a command substitution anywhere) could resolve to git/gh at runtime
    // -> DENY. ---
    if (hasCommandSubstitution(command)) {
      return {
        decision: "deny",
        reason: "command substitution `$(...)`/backtick anywhere could resolve to git/gh: refused",
      };
    }
    const program = passThroughProgramToken(command);
    if (isDynamicProgramToken(program)) {
      return {
        decision: "deny",
        reason: "dynamic program token (`$`/`${`/backtick/glob) could resolve to git/gh at runtime: refused",
      };
    }

    // --- A plain, static, non-git/gh command -> PASS-THROUGH. ---
    return {
      decision: "pass",
      reason: "command does not mention git/gh and has no dynamic program token: deferring to normal permission flow",
    };
  } catch (err) {
    return { decision: "block", reason: `hook error: ${err && err.message ? err.message : String(err)}` };
  }
}

/** Read all of stdin to a string. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** Emit a PreToolUse allow/deny decision (exit 0). */
function emitDecision(permissionDecision, reason) {
  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

/** Non-blocking pass-through: emit nothing, exit 0 (defer to normal flow). */
function emitPassThrough() {
  process.exit(0);
}

/** Hard fail-closed: stderr + exit 2 blocks the call immediately. */
function blockFailClosed(reason) {
  process.stderr.write(`forge-permissions hook (fail-closed): ${reason}\n`);
  process.exit(2);
}

// Run as a script only (not when imported by the self-check).
const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (invokedDirectly) {
  (async () => {
    let input;
    try {
      const raw = await readStdin();
      input = JSON.parse(raw);
    } catch (err) {
      blockFailClosed(`unparseable hook stdin: ${err && err.message ? err.message : String(err)}`);
      return;
    }
    const result = decide(input);
    if (result.decision === "block") {
      blockFailClosed(result.reason);
      return;
    }
    if (result.decision === "pass") {
      emitPassThrough();
      return;
    }
    emitDecision(result.decision, result.reason);
  })();
}

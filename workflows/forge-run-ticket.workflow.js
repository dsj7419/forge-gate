// @ts-nocheck
/**
 * forge-run-ticket.workflow.js — workflow-backed ForgeGate runner skeleton.
 *
 * Doctrine: the workflow EXECUTES, Forge Core GOVERNS, the human APPROVES the
 * outward action. This script owns only phase ordering, the correction loop
 * (cap 3), parallel verifier execution, capturing structured agent returns into
 * variables, and assembling the Core-owned handoff. It owns NONE of: gate
 * computation, decision_id assignment, ledger semantics, agent-output schema
 * validation, path-fence decisions, run-report safety attestation, or any
 * outward action. There is intentionally NO commit / push / PR / merge / status
 * write-back / journal-write stage anywhere in this file.
 *
 * Typed core-runner data-flow contract (first-class, non-negotiable):
 *   The script has no shell or filesystem of its own. It reaches Core/git/fs ONLY
 *   by dispatching the `forge-core-runner` agent WITH the `CoreRunnerResult`
 *   schema, so every bridge call resolves to a typed object:
 *
 *     type CoreRunnerResult = { ok, exit, stdout, stderr?, command? }
 *
 *   `exit` is the authoritative success/failure signal. `stdout` is parsed
 *   EXPLICITLY at the helper boundary, per the invoked command: JSON for the
 *   forge JSON commands (including `forge repo snapshot`, which supplies every
 *   read-only repo fact), exit-signal only for pnpm verify and run-report write.
 *   No raw git is shelled — repo facts come from the Core snapshot, whose git
 *   runs internally via execFileSync (never a Bash tool call), so the live
 *   permissions hook never intercepts them. The script NEVER reads
 *   `.ok`/`.exit`/`.result`/`.verdict`/
 *   arrays/objects off a raw natural-language agent string. The role agents
 *   (engineer / semantic-verifier / scope-verifier / pm) keep their own schema
 *   and return typed objects through their own `agent({schema})` calls.
 *
 *   Every hook (`agent`, `parallel`) returns a Promise and is awaited; helpers
 *   that call a hook are `async` and awaited at every call site. A missing
 *   `await` would destructure `{}` and break the run.
 */

export const meta = {
  name: "forge-run-ticket",
  description:
    "Workflow-backed ForgeGate runner skeleton: drives one ticket (engineer -> verifiers -> PM) to a Core-owned commit-gate handoff. Workflow executes, Forge Core governs, the human approves the outward action. No commit/push/PR/merge stage exists.",
  phases: [
    "preflight",
    "active-ticket",
    "engineer",
    "verify-and-guard",
    "verifiers",
    "pm",
    "commit-gate-handoff",
  ],
};

// --- Repo portability ------------------------------------------------------
// Read the target from `args`, never from the session cwd. The proof may run
// against a disposable clone by passing a different repoRoot/epic/forgeBin.
const ARGS = (typeof args === "string")
  ? (() => { try { return JSON.parse(args); } catch { return {}; } })()
  : (args && typeof args === "object" ? args : {});
const repoRoot = ARGS.repoRoot;
const epic = ARGS.epic;
const forgeBin = ARGS.forgeBin ?? "forge";
// Run identity is the cross-run lock's ownership key. The workflow runtime forbids
// nondeterministic primitives (Math.random / Date.now / new Date() throw), so the
// workflow cannot mint a UUID inline. Both are launcher-provided via `args` and
// REQUIRED (PM-ratified: no in-workflow or bridge minting), exactly like repoRoot
// / epic / forgeBin above.
const runId = ARGS.runId;
const sessionId = ARGS.sessionId;

if (typeof repoRoot !== "string" || repoRoot.length === 0) {
  throw new Error("forge-run-ticket workflow: args.repoRoot (absolute TARGET_REPO path) is required");
}
if (typeof epic !== "string" || epic.length === 0) {
  throw new Error("forge-run-ticket workflow: args.epic (absolute target epic path) is required");
}
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error("forge-run-ticket workflow: args.runId (launcher-provided lock ownership key) is required");
}
if (typeof sessionId !== "string" || sessionId.length === 0) {
  throw new Error("forge-run-ticket workflow: args.sessionId (launcher-provided session id) is required");
}

// The `.forge/` runtime dir for this epic. All workflow-owned structured
// outputs are persisted here by the core-runner and read back by Core.
const forgeDir = `${epic.replace(/[\\/]+$/, "")}/.forge`;

// Cross-run lock ownership flag. Set true ONLY after a successful atomic
// `forge lock acquire`. Every terminal `escalate()` and the PASS path consult
// this before an owner-checked `forge lock release`: pre-acquire escalations
// (validate / dry-run / dirty-tree) never release because nothing was acquired.
// The lock is held for the WHOLE run (across the correction loop) and released
// only on a terminal outcome. The workflow never breaks, clears, or takes over a
// lock it does not own — there is no recovery/override path here by design.
let acquired = false;

// --- CoreRunnerResult schema (local; workflow-defined) ---------------------
// The ONLY schema passed to the `forge-core-runner` bridge. Local is sufficient
// for the skeleton (a Core-owned emitter is a deferred nicety). `exit` is the
// authoritative signal; `stdout` is parsed explicitly downstream.
const CoreRunnerResult = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "exit", "stdout"],
  properties: {
    ok: { type: "boolean", description: "convenience: exit === 0" },
    exit: { type: "integer", description: "the authoritative command success/failure signal" },
    stdout: { type: "string", description: "exact command stdout, verbatim" },
    stderr: { type: "string", description: "exact stderr (empty when none)" },
    command: { type: "string", description: "the command that was run (provenance)" },
  },
};

// ===========================================================================
// Typed core-runner helper boundary — parse once, consume typed.
// Every Core/git/verify/fs touch routes through exactly one of these. No
// downstream phase reads a field off a raw agent string.
// ===========================================================================

/**
 * runCore — the ONE schema'd core-runner bridge call. Dispatches
 * `forge-core-runner` WITH the `CoreRunnerResult` schema so the return is a
 * typed object carrying the real command stdout/exit. Never called schemaless.
 */
async function runCore(commandLine) {
  const result = await agent(
    [
      `Run EXACTLY this one command from the directory "${repoRoot}" (the pinned target`,
      "repo root — cd there first) and report its real result. The working directory",
      "matters: bare commands like `pnpm test` MUST run from that directory, not from",
      "wherever this agent started.",
      "Do not edit files, do not run any other command, do not perform any outward action.",
      "",
      `command: ${commandLine}`,
      "",
      "Return the CoreRunnerResult object: ok (exit===0), exit (the process exit code),",
      "stdout (verbatim), stderr (verbatim, empty when none), command (the command you ran).",
      "Report the command's true exit code and stdout verbatim — never fabricate either.",
    ].join("\n"),
    { agentType: "forge-core-runner", schema: CoreRunnerResult },
  );
  return result;
}

/** runCoreJson — for the forge JSON commands. Explicit parse at the boundary. */
async function runCoreJson(commandLine) {
  const res = await runCore(commandLine);
  if (res.exit !== 0) {
    throw new Error(`core command failed (exit ${res.exit}): ${commandLine}\n${res.stderr ?? ""}\n${res.stdout}`);
  }
  try {
    return JSON.parse(res.stdout);
  } catch (thrown) {
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    throw new Error(`core command did not emit valid JSON: ${commandLine}\n${detail}\nstdout: ${res.stdout}`);
  }
}

/**
 * runCoreJsonResult — for forge commands that signal pass/fail via exit AND emit
 * a JSON envelope on BOTH paths (dispatch / parse-agent / ledger append). Parses
 * stdout JSON regardless of exit so the caller can branch on `ok`.
 */
async function runCoreJsonResult(commandLine) {
  const res = await runCore(commandLine);
  let json;
  try {
    json = JSON.parse(res.stdout);
  } catch (thrown) {
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    throw new Error(`core command did not emit valid JSON: ${commandLine}\n${detail}\nstdout: ${res.stdout}`);
  }
  return { exit: res.exit, json };
}

/** runCoreOk — for exit-signal commands (run-report write). `exit === 0`. */
async function runCoreOk(commandLine) {
  const res = await runCore(commandLine);
  return res.exit === 0;
}

/**
 * repoSnapshot — the ONE read-only repo-facts source. Routes through Core's
 * `forge repo snapshot`, which runs git via an internal `execFileSync` spawn
 * (NOT a Bash tool call), so the live PreToolUse Bash hook never intercepts it —
 * the whole point of this seam. NO raw git is shelled through the Bash tool
 * anywhere in this workflow. Returns the typed snapshot object:
 *   { repo_root, clean, changed_files, head, branch, ahead_of_base }
 * `--base` is supplied only at handoff so `ahead_of_base` is computed; when
 * omitted (preflight) it is null.
 */
async function repoSnapshot(base) {
  const baseFlag = base === undefined ? "" : ` --base ${base}`;
  return await runCoreJson(`${forgeBin} repo snapshot --repo-root "${repoRoot}"${baseFlag}`);
}

/** runVerify — pnpm verify commands are EXIT-SIGNAL ONLY. */
async function runVerify(cmd) {
  const res = await runCore(cmd);
  return { cmd, result: res.exit === 0 ? "pass" : "fail" };
}

/**
 * writeForgeFile — persist a workflow-owned structured output into `.forge/**`
 * via the core-runner, and ASSERT the write succeeded (exit 0). The object is
 * serialized here; the core-runner only writes the given bytes to the path.
 */
async function writeForgeFile(relName, obj) {
  const target = `${forgeDir}/${relName}`;
  const json = JSON.stringify(obj, null, 2);
  const res = await runCore(
    [
      `Write the following exact JSON bytes to the file "${target}" (create parent dirs if needed).`,
      "Do not alter, reformat, or pretty-print the content. Report exit 0 only if the write succeeded.",
      "",
      json,
    ].join("\n"),
  );
  if (res.exit !== 0) {
    throw new Error(`failed to persist ${target} (exit ${res.exit}): ${res.stderr ?? ""}`);
  }
  return target;
}

// --- Helpers ---------------------------------------------------------------

/** Parse the forge role JSON-Schema text into a real object for agent({schema}). */
async function roleSchema(role) {
  const schema = await runCoreJson(`${forgeBin} agent-schema ${role}`);
  // Harness compatibility (workflow-local adapter): `forge agent-schema` emits
  // zod/v4's default top-level `"$schema": ".../draft/2020-12/schema"` dialect
  // marker, which the workflow `agent({schema})` validator does not register and
  // rejects. Strip ONLY that top-level key; the role schema bodies carry no
  // $ref/$defs/prefixItems (nested combinators like `anyOf` are fine and are
  // accepted by the validator — empirically, every role schema dispatches), so
  // the remaining schema validates the same shape.
  // This adapts only the structured-output *shaping* schema — Core `parse-agent`
  // remains the authoritative validator of the returned object, unchanged.
  // FOLLOW_UP_OK (Core, separate ticket): give `forge agent-schema` a portable
  // emission mode (drop/replace the dialect marker) at the CLI surface so this
  // workflow-local strip is no longer needed.
  if (schema && typeof schema === "object") {
    delete schema.$schema;
  }
  return schema;
}

/**
 * Persist a structured role output to `.forge/<file>.json`, then validate it
 * through Core (`forge parse-agent <role> --json-file`). Returns the Core parse
 * result `{exit, json}` — the script trusts ONLY Core's verdict, never the
 * agent's self-report. `pm` adds the ledger-derived expected-decision-id check.
 */
async function persistAndValidateRole(role, fileName, roleObject, expectedDecisionId) {
  const path = await writeForgeFile(fileName, roleObject);
  const idFlag =
    role === "pm" && expectedDecisionId !== undefined ? ` --expected-decision-id ${expectedDecisionId}` : "";
  // parse-agent takes the file path positionally/by-flag; it REJECTS --repo-root.
  return await runCoreJsonResult(`${forgeBin} parse-agent ${role} --json-file "${path}"${idFlag}`);
}

/** Derive the next decision id from the ledger (max D-(n)+1; empty -> D-001). */
function deriveNextDecisionId(ledgerDecisions) {
  let max = 0;
  for (const entry of ledgerDecisions) {
    const m = /^D-(\d+)$/.exec(entry.decision_id);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `D-${String(max + 1).padStart(3, "0")}`;
}

// ===========================================================================
// Phase 1 — Preflight (via core-runner only).
// ===========================================================================
await phase("preflight");
log(`preflight: validating epic ${epic} in repo ${repoRoot}`);

// validate / run --dry-run take the epic positionally and REJECT --repo-root.
const validation = await runCoreJson(`${forgeBin} validate "${epic}" --json`);
if (validation.ok !== true) {
  return await escalate("PREFLIGHT_VALIDATE_FAILED", { validation });
}

const dryRun = await runCoreJson(`${forgeBin} run "${epic}" --dry-run --json`);
if (dryRun.ok !== true) {
  return await escalate("PREFLIGHT_DRY_RUN_FAILED", { dryRun });
}

// One read-only repo snapshot (no --base) yields every preflight fact: the
// clean-tree precondition, the current branch (acquireBranch), and the
// checkpoint base (head). It routes through Core's internal execFileSync git, so
// no raw git is shelled through Bash. Branch creation is the launcher's job; the
// workflow is already on the run branch.
const preflightSnapshot = await repoSnapshot();
if (preflightSnapshot.clean !== true) {
  return await escalate("PREFLIGHT_DIRTY_TREE", { changed_files: preflightSnapshot.changed_files });
}

// Atomic cross-run lock acquire — the create IS the mutual exclusion. This
// REPLACES the old non-atomic `test -f lock.json` existence probe (the same
// check-then-act TOCTOU the command path retired). It runs AFTER the clean-tree
// check and BEFORE checkpoint capture and active-ticket emission, so no mutation
// happens until the run provably owns the lock. Ticket id is sourced from the
// dry-run selection and the branch from the preflight snapshot, both captured
// before active-ticket emission (which is NOT reordered ahead of acquire).
const acquireTicketId = String(dryRun.selected?.ticket ?? "");
const acquireBranch = preflightSnapshot.branch;
const lockAcquire = await runCoreJsonResult(
  [
    `${forgeBin} lock acquire "${epic}"`,
    `--run-id "${runId}"`,
    `--session-id "${sessionId}"`,
    `--ticket "${acquireTicketId}"`,
    `--branch "${acquireBranch}"`,
    `--repo-root "${repoRoot}"`,
  ].join(" "),
);
if (lockAcquire.exit === 0 && lockAcquire.json.ok === true) {
  acquired = true;
} else if (lockAcquire.json.code === "LOCK_HELD") {
  // Another run already owns the epic — stop before any mutation; report the holder.
  return await escalate("PREFLIGHT_LOCK_HELD", { holder: lockAcquire.json.holder });
} else if (lockAcquire.json.code === "LOCK_MALFORMED") {
  // The on-disk lock is unparseable — human investigation; NEVER clobber/auto-clear.
  return await escalate("PREFLIGHT_LOCK_MALFORMED", { errors: lockAcquire.json.errors });
} else {
  // Any other non-zero / undecidable acquire result — fail closed before mutation.
  return await escalate("PREFLIGHT_LOCK_ACQUIRE_FAILED", { acquire: lockAcquire.json });
}

// Checkpoint base for the run-report — the HEAD captured by the preflight
// snapshot (read-only). Assigned AFTER the lock acquire so the run provably owns
// the lock before any checkpoint is recorded (ordering preserved).
const checkpointBase = preflightSnapshot.head;

// ===========================================================================
// Phase 2 — Core emits the gate-bearing active-ticket.
// `active-ticket` accepts --repo-root and emits JSON we persist for the guard
// and the run-report writer (which sources the gate from this file).
// ===========================================================================
await phase("active-ticket");
const activeTicket = await runCoreJson(
  `${forgeBin} active-ticket "${epic}" --json --repo-root "${repoRoot}"`,
);
await writeForgeFile("active-ticket.json", activeTicket);
// Two distinct identifiers, sourced from Core (never conflated):
//  - ticketId    = the TicketId ("T01") — for `ledger append --ticket` (TicketIdSchema).
//  - ticketTitle = the human-readable title — for run-report `--ticket-title`
//    (run-report records BOTH `ticket` (ID, from active-ticket) and `ticket_title`).
// The title lives in the dry-run's `selected.title`; fall back to the id only if absent.
const ticketId = String(activeTicket.ticket ?? "");
const ticketTitle = String(dryRun.selected?.title ?? ticketId);

// ===========================================================================
// Phase 3 — Engineer (correction loop, cap 3). The engineer agent returns a
// TYPED object via its own schema; Core validates it via parse-agent.
// ===========================================================================
await phase("engineer");
const engineerSchema = await roleSchema("engineer");
const MAX_ATTEMPTS = 3;

// Every role agent is dispatched with its Core-RENDERED dispatch packet (charter
// + ticket inputs + cwd discipline), never a hand-written prompt — so no agent
// infers context by wandering the repo. These packets are static (ticket-derived,
// independent of engineer output), so fetch once. `forge dispatch <role>` emits
// {role,subagent_type,mode,prompt}; we feed `.prompt` to the registered agent.
const engineerPrompt = (await runCoreJson(`${forgeBin} dispatch engineer "${epic}" --repo-root "${repoRoot}"`)).prompt;
const semanticPrompt = (await runCoreJson(`${forgeBin} dispatch semantic-verifier "${epic}" --repo-root "${repoRoot}"`)).prompt;
const scopePrompt = (await runCoreJson(`${forgeBin} dispatch scope-verifier "${epic}" --repo-root "${repoRoot}"`)).prompt;

let engineerOutput;
let engineerParsed;
let verifyResults;
let guard;
let semanticOutput;
let semanticParsed;
let scopeOutput;
let scopeParsed;
let priorCorrections = [];

let attempt = 0;
let loopVerdict = "CORRECT";

while (attempt < MAX_ATTEMPTS && loopVerdict === "CORRECT") {
  attempt += 1;
  log(`engineer attempt ${attempt}/${MAX_ATTEMPTS}`);

  // Dispatch the engineer with its Core-rendered packet (+ correction feedback on
  // retries) and its schema -> typed object.
  engineerOutput = await agent(
    priorCorrections.length > 0
      ? `${engineerPrompt}\n\n## Prior corrections to address on this attempt\n- ${priorCorrections.join("\n- ")}`
      : engineerPrompt,
    { agentType: "forge-engineer", schema: engineerSchema },
  );

  // Persist + Core-validate the structured engineer output.
  engineerParsed = await persistAndValidateRole("engineer", "engineer-output.json", engineerOutput);
  if (engineerParsed.exit !== 0 || engineerParsed.json.ok !== true) {
    return await escalate("ENGINEER_OUTPUT_INVALID", { engineerParsed });
  }

  // -------------------------------------------------------------------------
  // Phase 4 — Verify commands (exit-signal only) + guard paths.
  // -------------------------------------------------------------------------
  await phase("verify-and-guard");
  // Use the ticket's REAL verify commands as Core declares them (`verifyCommands`,
  // camelCase — Core always emits an array). NEVER fabricate a fallback set: a
  // missing field is a Core-contract break, so escalate rather than invent
  // verification that flows into the run-report's trust boundary.
  if (!Array.isArray(dryRun.verifyCommands)) {
    return await escalate("VERIFY_COMMANDS_MISSING", { dryRun });
  }
  const verifyCommands = dryRun.verifyCommands;
  verifyResults = [];
  for (const cmd of verifyCommands) {
    verifyResults.push(await runVerify(cmd));
  }
  const verifyAllPass = verifyResults.every((v) => v.result === "pass");

  // `guard paths` accepts --repo-root and --json; reads the active-ticket file.
  guard = await runCoreJsonResult(
    `${forgeBin} guard paths --active "${forgeDir}/active-ticket.json" --json --repo-root "${repoRoot}"`,
  );
  const guardOk = guard.json.ok === true;

  // -------------------------------------------------------------------------
  // Phase 5 — Verifiers (parallel). Each returns a TYPED object; Core validates.
  // -------------------------------------------------------------------------
  await phase("verifiers");
  const semanticSchema = await roleSchema("semantic-verifier");
  const scopeSchema = await roleSchema("scope-verifier");

  const [semanticRaw, scopeRaw] = await parallel([
    () => agent(semanticPrompt, { agentType: "forge-semantic-verifier", schema: semanticSchema }),
    () => agent(scopePrompt, { agentType: "forge-scope-verifier", schema: scopeSchema }),
  ]);
  semanticOutput = semanticRaw;
  scopeOutput = scopeRaw;

  semanticParsed = await persistAndValidateRole(
    "semantic-verifier",
    "semantic-verifier-output.json",
    semanticOutput,
  );
  if (semanticParsed.exit !== 0 || semanticParsed.json.ok !== true) {
    return await escalate("SEMANTIC_OUTPUT_INVALID", { semanticParsed });
  }
  scopeParsed = await persistAndValidateRole("scope-verifier", "scope-verifier-output.json", scopeOutput);
  if (scopeParsed.exit !== 0 || scopeParsed.json.ok !== true) {
    return await escalate("SCOPE_OUTPUT_INVALID", { scopeParsed });
  }

  // Verifier verdicts come ONLY from Core-validated data (parse-agent .json.data),
  // never from a raw agent string.
  const semanticApprove = semanticParsed.json.data.verdict === "APPROVE";
  const scopeApprove = scopeParsed.json.data.verdict === "APPROVE";

  // Whether this attempt is in a passable state. A non-passable state drives the
  // correction loop; on the final attempt it becomes an ESCALATE.
  const attemptHealthy = verifyAllPass && guardOk && semanticApprove && scopeApprove;
  if (!attemptHealthy) {
    loopVerdict = "CORRECT";
    priorCorrections = collectCorrections({ verifyResults, guard, semanticParsed, scopeParsed });
    if (attempt >= MAX_ATTEMPTS) {
      return await escalate("CORRECTION_CAP_REACHED", {
        attempt,
        verifyResults,
        guardOk,
        semanticApprove,
        scopeApprove,
      });
    }
    continue;
  }

  // Attempt healthy -> leave the loop and proceed to PM.
  loopVerdict = "HEALTHY";
}

// ===========================================================================
// Phase 6 — PM. Decision-id provenance is NON-TAUTOLOGICAL: the expected id is
// derived from the LEDGER (not from any agent output) and passed to BOTH
// `dispatch pm --assigned-decision-id` AND `parse-agent pm --expected-decision-id`.
// ===========================================================================
await phase("pm");

// Read the ledger via the core-runner and derive expectedDecisionId from it.
const ledgerProbe = await runCore(
  `test -f "${forgeDir}/decisions-ledger.json" && cat "${forgeDir}/decisions-ledger.json" || echo "{}"`,
);
let ledgerDecisions = [];
if (ledgerProbe.exit === 0) {
  try {
    const parsed = JSON.parse(ledgerProbe.stdout);
    if (Array.isArray(parsed.decisions)) ledgerDecisions = parsed.decisions;
  } catch {
    ledgerDecisions = [];
  }
}
const expectedDecisionId = deriveNextDecisionId(ledgerDecisions);
log(`pm: ledger-derived expected decision id = ${expectedDecisionId}`);

// Assemble the orchestrator-confirmed facts from REAL results. The facts file is
// a trust boundary `dispatch pm` reads, so it MUST exist before dispatch. At
// dispatch time `parse_validation.pm` is false (PM has not validated yet); it is
// rewritten true after the PM parse + id cross-check succeeds, before run-report.
// One snapshot WITH --base yields the four handoff facts in one read-only Core
// call: changed_files (guard-parsed: renames/untracked handled), branch, head
// (checkpointHead, captured below), and ahead_of_base (the base..HEAD count).
const handoffSnapshot = await repoSnapshot(checkpointBase);
const finalChangedFiles = handoffSnapshot.changed_files;
const branchName = handoffSnapshot.branch;
const aheadOfBase = handoffSnapshot.ahead_of_base;

function buildFacts(pmValidatedFlag) {
  return {
    parse_validation: {
      engineer: engineerParsed.json.ok === true,
      semantic_verifier: semanticParsed.json.ok === true,
      scope_verifier: scopeParsed.json.ok === true,
      pm: pmValidatedFlag,
    },
    verify_command_results: verifyResults,
    final_changed_files: finalChangedFiles,
    final_branch_status: {
      branch: branchName,
      ahead_of_base: Number.isFinite(aheadOfBase) ? aheadOfBase : 0,
      // No outward action ever occurs in this workflow -> never committed here.
      committed: false,
    },
  };
}

// Write facts with pm:false, then dispatch (Core reads this file).
await writeForgeFile("orchestrator-facts.json", buildFacts(false));

// Dispatch the PM through Core. `dispatch pm` accepts --repo-root and assigns the
// authoritative id internally; --assigned-decision-id is the optional cross-check.
const pmDispatch = await runCoreJsonResult(
  [
    `${forgeBin} dispatch pm "${epic}"`,
    `--repo-root "${repoRoot}"`,
    `--assigned-decision-id ${expectedDecisionId}`,
    `--engineer-output "${forgeDir}/engineer-output.json"`,
    `--semantic-output "${forgeDir}/semantic-verifier-output.json"`,
    `--scope-output "${forgeDir}/scope-verifier-output.json"`,
    `--facts "${forgeDir}/orchestrator-facts.json"`,
  ].join(" "),
);
if (pmDispatch.exit !== 0 || pmDispatch.json.ok === false) {
  return await escalate("PM_DISPATCH_FAILED", { pmDispatch });
}

// Dispatch the PM agent itself with its Core-RENDERED packet — the prompt from
// `forge dispatch pm` embeds the engineer output, both verifier verdicts, the
// confirmed facts, and the pinned decision_id. Passing it (not a hand-written
// stub) is what lets the PM judge the actual ticket on real inputs instead of
// inferring context. Its schema -> typed object.
const pmSchema = await roleSchema("pm");
const pmOutput = await agent(
  pmDispatch.json.prompt,
  { agentType: "forge-pm", schema: pmSchema },
);

// Persist + Core-validate the PM output WITH the ledger-derived expected id.
const pmParsed = await persistAndValidateRole("pm", "pm-output.json", pmOutput, expectedDecisionId);
const pmValidated = pmParsed.exit === 0 && pmParsed.json.ok === true;
if (!pmValidated) {
  return await escalate("PM_OUTPUT_INVALID", { pmParsed });
}
const pmVerdict = pmParsed.json.data.decision;

// ===========================================================================
// Phase 7 — Ledger append (only after PM parse + id equality) + run-report.
// ===========================================================================
await phase("commit-gate-handoff");

let ledgerAppendOk = false;
if (pmVerdict === "PASS") {
  const ledgerAppend = await runCoreJsonResult(
    [
      `${forgeBin} ledger append "${epic}"`,
      `--decision-id ${expectedDecisionId}`,
      `--ticket "${ticketId}"`,
      `--branch "${branchName}"`,
    ].join(" "),
  );
  ledgerAppendOk = ledgerAppend.exit === 0 && ledgerAppend.json.ok === true;
  if (!ledgerAppendOk) {
    return await escalate("LEDGER_APPEND_FAILED", { ledgerAppend });
  }
}

// The PASS gate is reachable ONLY through real, Core-validated typed results:
// PM PASS + ledger appended + both verifiers APPROVE + guard OK + verify pass.
const finalVerifyAllPass = verifyResults.every((v) => v.result === "pass");
const finalGuardOk = guard.json.ok === true;
const finalSemanticApprove = semanticParsed.json.data.verdict === "APPROVE";
const finalScopeApprove = scopeParsed.json.data.verdict === "APPROVE";

const passGate =
  pmVerdict === "PASS" &&
  ledgerAppendOk &&
  finalSemanticApprove &&
  finalScopeApprove &&
  finalGuardOk &&
  finalVerifyAllPass;

const runResult = passGate ? "PASS" : "ESCALATE";

// Rewrite the facts with pm:true (PM parse + id cross-check succeeded) so the
// run-report writer consumes the post-validation truth.
await writeForgeFile("orchestrator-facts.json", buildFacts(pmValidated));

const checkpointHead = handoffSnapshot.head;

// Core writes the run-report (exit-signal). The gate is sourced by Core from the
// active-ticket; agent_output_source.* = workflow_core_runner because the
// core-runner owns the deterministic capture/persist on this path.
const runReportWritten = await runCoreOk(
  [
    `${forgeBin} run-report write "${epic}"`,
    `--repo-root "${repoRoot}"`,
    `--result ${runResult}`,
    `--ticket-title "${ticketTitle}"`,
    `--checkpoint-base ${checkpointBase}`,
    `--checkpoint-head ${checkpointHead}`,
    `--guard-result "${finalGuardOk ? "OK" : "VIOLATION"}"`,
    `--guard-exit ${finalGuardOk ? 0 : 1}`,
    // Point the writer at the STRUCTURED .json role outputs the workflow persisted
    // (its defaults are <role>-output.yaml). --facts/--active-ticket defaults
    // already match the workflow's orchestrator-facts.json / active-ticket.json.
    `--engineer-output "${forgeDir}/engineer-output.json"`,
    `--semantic-output "${forgeDir}/semantic-verifier-output.json"`,
    `--scope-output "${forgeDir}/scope-verifier-output.json"`,
    `--pm-output "${forgeDir}/pm-output.json"`,
    `--agent-output-source-engineer workflow_core_runner`,
    `--agent-output-source-semantic-verifier workflow_core_runner`,
    `--agent-output-source-scope-verifier workflow_core_runner`,
    `--agent-output-source-pm workflow_core_runner`,
  ].join(" "),
);
if (!runReportWritten) {
  return await escalate("RUN_REPORT_WRITE_FAILED", { runResult });
}

// Read the Core-owned run-report back from the file (success path) and return it
// as the workflow's single answer. No outward action is taken — the human acts.
const runReport = await runCoreJson(`cat "${forgeDir}/run-report.json"`);

// Owner-checked terminal release on the PASS/handoff path — AFTER the ledger
// append and run-report write. A LOCK_FOREIGN / LOCK_ABSENT / LOCK_MALFORMED
// result is surfaced in the handoff (`lock_release`), NEVER overridden/cleared.
const lockReleaseResult = await releaseLockIfOwned();

log(`commit-gate handoff: result=${runResult} decision=${pmVerdict} decision_id=${expectedDecisionId}`);

return {
  result: runResult,
  pm_verdict: pmVerdict,
  decision_id: expectedDecisionId,
  ledger_append_ok: ledgerAppendOk,
  run_report: runReport,
  lock_release: lockReleaseResult,
  // Explicitly: the workflow performs NO outward action. The human reviews this
  // report and performs any commit / push / PR / merge manually.
  outward_action_taken: false,
};

// --- Escalation + correction helpers ---------------------------------------

/**
 * Build the prior-corrections list fed back to the engineer on the next attempt.
 * Sourced ONLY from Core-validated results (never raw agent text).
 */
function collectCorrections({ verifyResults, guard, semanticParsed, scopeParsed }) {
  const corrections = [];
  for (const v of verifyResults) {
    if (v.result !== "pass") corrections.push(`verify command failed: ${v.cmd}`);
  }
  if (guard.json.ok !== true) {
    const findings = Array.isArray(guard.json.findings) ? guard.json.findings : [];
    for (const f of findings) corrections.push(`guard: ${f.code} ${f.message ?? ""}`.trim());
  }
  if (semanticParsed.json.data?.verdict !== "APPROVE") {
    corrections.push("semantic verifier did not APPROVE");
  }
  if (scopeParsed.json.data?.verdict !== "APPROVE") {
    corrections.push("scope verifier did not APPROVE");
  }
  return corrections;
}

/**
 * Owner-checked terminal lock release. Releases the cross-run lock IFF this run
 * acquired it (`acquired === true`), keyed by `runId`. Pre-acquire escalations
 * (validate / dry-run / dirty-tree / a failed acquire itself) never release
 * because nothing was acquired. A LOCK_FOREIGN / LOCK_ABSENT / LOCK_MALFORMED
 * result is RETURNED for surfacing in the handoff/evidence — never overridden,
 * never cleared, never taken over. Returns `null` when this run holds no lock.
 */
async function releaseLockIfOwned() {
  if (acquired !== true) return null;
  const release = await runCoreJsonResult(
    `${forgeBin} lock release "${epic}" --run-id "${runId}"`,
  );
  // Once a terminal release is attempted, the run no longer claims ownership —
  // do not retry or double-release on a subsequent terminal path.
  acquired = false;
  return { exit: release.exit, ...release.json };
}

/**
 * Terminate the run with an ESCALATE handoff. No outward action. Owner-aware:
 * releases the cross-run lock iff this run acquired it (the run provably owns it
 * via `runId`, and escalate is terminal). The release result, when any, is
 * surfaced in the evidence — a foreign/absent/malformed release is reported,
 * never overridden/cleared. The ESCALATE shape is otherwise unchanged (no evidence
 * run-report is written on this path).
 */
async function escalate(code, evidence) {
  log(`ESCALATE: ${code}`);
  const lockRelease = await releaseLockIfOwned();
  return {
    result: "ESCALATE",
    code,
    evidence: lockRelease === null ? evidence : { ...evidence, lock_release: lockRelease },
    outward_action_taken: false,
  };
}

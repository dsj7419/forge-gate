import { ACTIVE_TICKET_SCHEMA, ActiveTicketSchema, type ActiveTicket } from "../guard/active-ticket.js";
import { generateRunPackets, type ActiveRun } from "../orchestrator/packets.js";

/**
 * Map a packet `active_run` to the forge-active-ticket/v1 shape. Pure.
 *
 * It validates against the consumer's `ActiveTicketSchema`, so the producer can
 * never emit something the guard would reject (and the v1 fields are taken
 * verbatim from the deterministic packet — no hand-authored shape). Operational
 * fields the packet also carries (gate, sprint) are intentionally not emitted.
 */
export function buildActiveTicket(activeRun: ActiveRun): ActiveTicket {
  return ActiveTicketSchema.parse({
    schema: ACTIVE_TICKET_SCHEMA,
    repo_root: activeRun.repo_root,
    epic_path: activeRun.epic_path,
    ticket: activeRun.ticket,
    branch: activeRun.branch,
    allowed_paths: activeRun.allowed_paths,
    forbidden_paths: activeRun.forbidden_paths,
    protected_paths: activeRun.protected_paths,
  });
}

export type EmitActiveTicketResult =
  | { ok: true; activeTicket: ActiveTicket }
  | { ok: false; blockedReasons: string[] };

/**
 * Select the same ticket `/forge-run-ticket` will run (via the shared dry-run +
 * packet logic) and produce its forge-active-ticket/v1. Read-only; writes nothing.
 * Fails (ok:false) when the dry-run is blocked or no ticket is ready.
 */
export function emitActiveTicket(epicPath: string, repoRoot: string): EmitActiveTicketResult {
  const result = generateRunPackets(epicPath, repoRoot);
  if (!result.ok) return { ok: false, blockedReasons: result.blockedReasons };
  return { ok: true, activeTicket: buildActiveTicket(result.packets.active_run) };
}

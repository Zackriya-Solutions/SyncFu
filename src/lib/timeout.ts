import type { NotificationPayload } from "@/types/notification";

// Shared auto-dismiss timeout resolution (T5a extraction) so the card and the
// island resolve the SAME priority timeouts - the parity contract mandates
// "no island-specific timing", which only a single source of truth guarantees.
// DELIBERATE behavior change vs the old NotificationCard code: the original
// `TIMEOUTS[priority] ?? 8000` turned critical's `null` into 8000ms, so critical
// cards auto-dismissed at 8s - violating the locked priority contract (critical
// NEVER auto-dismisses; D5/PRD). The presence check below fixes that latent card
// bug; critical (and any unknown priority's default of 8s) now match the spec.
// Pure functions, no DOM.

/** Auto-dismiss timeouts by priority (ms). Critical never auto-dismisses. */
export const TIMEOUTS: Record<string, number | null> = {
  low: 6000,
  normal: 8000,
  high: 12000,
  critical: null,
};

/** Priority default: an EXPLICIT `null` in the map (critical = never) must win.
 *  `TIMEOUTS[priority] ?? 8000` would defeat it (null -> 8000), so we key on
 *  presence and only fall back to 8000 for an UNKNOWN priority. This honors the
 *  documented timeout table (low 6s / normal 8s / high 12s / critical never) and
 *  the binding "critical never auto-dismisses" invariant. */
function priorityDefault(priority: string): number | null {
  return priority in TIMEOUTS ? TIMEOUTS[priority] : 8000;
}

/**
 * Resolve the auto-dismiss duration for a notification (null = never dismiss).
 * An explicit per-notification `timeout` wins; otherwise the priority default.
 */
export function resolveTimeout(
  timeout: NotificationPayload["timeout"],
  priority: string,
): number | null {
  if (timeout === "never") return null;
  if (timeout === "default") return priorityDefault(priority);
  if (typeof timeout === "object" && timeout.never) return null;
  if (typeof timeout === "object" && timeout.seconds) return timeout.seconds * 1000;
  return priorityDefault(priority);
}

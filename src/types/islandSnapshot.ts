import type { NotificationPayload } from "./notification";

/** One Model B row: the notification plus backend-computed `hasWaiter`.
 *  The Rust snapshot flattens `NotificationPayload` and appends `hasWaiter`
 *  (manager.rs `IslandRow`), so a row IS a payload with the extra flag. */
export interface IslandRow extends NotificationPayload {
  readonly hasWaiter: boolean;
}

/** The authoritative Model B island view, owned by Rust (guard G10 / C1) and
 *  emitted as `island:snapshot`. The frontend renders it DUMBLY and never
 *  re-derives rank/dedupe/count from the store queue (which diverges - W1-W4).
 *
 *  `count` is the total island notification count (drives the `xN` badge).
 *  `rows` is the FULL ranked+deduped list; the 6-row / 560px cap is enforced
 *  visually by scroll containment (IslandList), so the list can scroll past 6. */
export interface IslandSnapshot {
  readonly count: number;
  readonly badgeLabel: string;
  readonly badgeWidth: number;
  readonly merged: number;
  readonly spotlight: IslandRow | null;
  readonly rows: readonly IslandRow[];
}

/** Empty snapshot: the pre-event state and the count===0 hidden case. */
export const EMPTY_ISLAND_SNAPSHOT: IslandSnapshot = {
  count: 0,
  badgeLabel: "0",
  badgeWidth: 26,
  merged: 0,
  spotlight: null,
  rows: [],
};

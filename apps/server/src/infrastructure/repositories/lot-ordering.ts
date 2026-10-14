import type { Lot, LotStatus } from "../../domain/models";

const STATUS_RANK: Record<LotStatus, number> = { LIVE: 0, SCHEDULED: 1, SOLD: 2, UNSOLD: 2 };

/** Live lots ending soonest, then upcoming lots, then the most recently closed. */
export function sortLotsForFloor(lots: readonly Lot[]): Lot[] {
  return [...lots].sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    if (a.status === "LIVE") return a.endsAt.getTime() - b.endsAt.getTime();
    if (a.status === "SCHEDULED") return a.startsAt.getTime() - b.startsAt.getTime();
    return b.endsAt.getTime() - a.endsAt.getTime();
  });
}

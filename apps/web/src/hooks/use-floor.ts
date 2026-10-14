"use client";
import { useCallback, useMemo, useState } from "react";
import { BidSource, LotStatus, type FloorStats, type Lot, type LotEvent, type WatchFloorResponse } from "@cafe/contracts";
import { biddingClient } from "@/lib/rpc";
import { millis } from "@/lib/format";
import { useResilientStream } from "./use-stream";

export interface FeedItem {
  readonly id: string;
  readonly lotId: string;
  readonly lotCode: string;
  readonly lotName: string;
  readonly paddle: string;
  readonly amountCents: number;
  readonly source: BidSource;
  readonly at: number;
}

/** SERVER STREAMING: the whole auction floor, live, from one long-lived RPC. */
export function useFloor() {
  const [lots, setLots] = useState<Map<string, Lot>>(new Map());
  const [stats, setStats] = useState<FloorStats | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [lastBidAt, setLastBidAt] = useState<Record<string, number>>({});

  const onLotEvent = useCallback((event: LotEvent) => {
    const lot = event.lot;
    if (!lot) return;
    setLots((prev) => new Map(prev).set(lot.id, lot));
    if (event.kind.case === "bidPlaced" && event.kind.value.bid) {
      const bid = event.kind.value.bid;
      setLastBidAt((prev) => ({ ...prev, [lot.id]: Date.now() }));
      setFeed((prev) =>
        [
          {
            id: bid.id,
            lotId: lot.id,
            lotCode: lot.code,
            lotName: lot.name,
            paddle: bid.paddle,
            amountCents: bid.amountCents,
            source: bid.source,
            at: millis(bid.placedAt),
          },
          ...prev,
        ].slice(0, 14),
      );
    }
  }, []);

  const status = useResilientStream<WatchFloorResponse>(
    (signal) => biddingClient.watchFloor({}, { signal }),
    (msg) => {
      if (msg.kind.case === "lotEvent") onLotEvent(msg.kind.value);
      else if (msg.kind.case === "stats") setStats(msg.kind.value);
    },
    () => setLots(new Map()),
    [],
  );

  const grouped = useMemo(() => {
    const all = [...lots.values()];
    const live = all.filter((l) => l.status === LotStatus.LIVE).sort((a, b) => millis(a.endsAt) - millis(b.endsAt));
    const upcoming = all.filter((l) => l.status === LotStatus.SCHEDULED).sort((a, b) => millis(a.startsAt) - millis(b.startsAt));
    const closed = all
      .filter((l) => l.status === LotStatus.SOLD || l.status === LotStatus.UNSOLD)
      .sort((a, b) => millis(b.endsAt) - millis(a.endsAt))
      .slice(0, 8);
    return { live, upcoming, closed };
  }, [lots]);

  return { ...grouped, stats, feed, lastBidAt, status };
}

"use client";
import { useState } from "react";
import type { Bid, Lot, LotClosed, WatchLotResponse } from "@cafe/contracts";
import { biddingClient } from "@/lib/rpc";
import { useResilientStream } from "./use-stream";

/** SERVER STREAMING: one lot, its bid history and its events. */
export function useLot(lotId: string) {
  const [lot, setLot] = useState<Lot | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [extendedAt, setExtendedAt] = useState(0);
  const [lastBidAt, setLastBidAt] = useState(0);
  const [closed, setClosed] = useState<LotClosed | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status = useResilientStream<WatchLotResponse>(
    (signal) => biddingClient.watchLot({ lotId }, { signal }),
    ({ event }) => {
      if (!event?.lot) return;
      setLot(event.lot);
      setError(null);
      switch (event.kind.case) {
        case "snapshot":
          setBids(event.kind.value.recentBids);
          break;
        case "bidPlaced": {
          const bid = event.kind.value.bid;
          if (bid) setBids((prev) => [bid, ...prev.filter((b) => b.id !== bid.id)].slice(0, 40));
          setLastBidAt(Date.now());
          break;
        }
        case "extended":
          setExtendedAt(Date.now());
          break;
        case "closed":
          setClosed(event.kind.value);
          break;
      }
    },
    () => undefined,
    [lotId],
  );

  return { lot, bids, extendedAt, lastBidAt, closed, status, error, setError };
}

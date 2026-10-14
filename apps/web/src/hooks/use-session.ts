"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Bidder } from "@cafe/contracts";
import { bidderClient } from "@/lib/rpc";
import { readSession, saveSession, subscribeSession } from "@/lib/session";
import { ConnectError, Code } from "@connectrpc/connect";

export function useSession() {
  return useSyncExternalStore(subscribeSession, readSession, () => null);
}

/** Fresh credit / exposure for the current paddle (unary GetMe). */
export function useMe(refreshMs = 5_000): Bidder | null {
  const session = useSession();
  const [me, setMe] = useState<Bidder | null>(null);

  useEffect(() => {
    if (!session) {
      setMe(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const res = await bidderClient.getMe({});
        if (alive) setMe(res.bidder ?? null);
      } catch (error) {
        // The server forgot us (e.g. in-memory storage restarted): drop the paddle.
        if (ConnectError.from(error).code === Code.Unauthenticated) saveSession(null);
      }
    };
    void load();
    const id = setInterval(load, refreshMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [session, refreshMs]);

  return me;
}

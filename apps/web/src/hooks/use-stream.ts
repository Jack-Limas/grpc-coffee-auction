"use client";
import { useEffect, useRef, useState } from "react";

export type StreamStatus = "connecting" | "live" | "reconnecting";

/**
 * Keeps a server-streaming RPC open forever: if the connection drops
 * (deploy, idle proxy timeout, Wi-Fi), it reconnects with exponential backoff.
 */
export function useResilientStream<T>(
  open: (signal: AbortSignal) => AsyncIterable<T>,
  onMessage: (message: T) => void,
  onReset: () => void,
  deps: readonly unknown[],
): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const handlers = useRef({ onMessage, onReset });
  handlers.current = { onMessage, onReset };

  useEffect(() => {
    const controller = new AbortController();
    let backoff = 1_000;

    (async () => {
      while (!controller.signal.aborted) {
        try {
          let first = true;
          for await (const message of open(controller.signal)) {
            if (first) {
              handlers.current.onReset();
              setStatus("live");
              backoff = 1_000;
              first = false;
            }
            handlers.current.onMessage(message);
          }
        } catch {
          /* fall through to reconnect */
        }
        if (controller.signal.aborted) return;
        setStatus("reconnecting");
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 15_000);
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return status;
}

"use client";
import { LotStatus, type Lot } from "@cafe/contracts";
import { countdown, millis } from "@/lib/format";
import { useNow } from "@/hooks/use-now";

const SOFT_CLOSE_MS = 30_000;

/** Time left, a progress bar, and a warning inside the anti-sniping window. */
export function Countdown({ lot, extendedAt = 0 }: { lot: Lot; extendedAt?: number }) {
  const now = useNow();
  const ends = millis(lot.endsAt);
  const starts = millis(lot.startsAt);

  if (lot.status === LotStatus.SCHEDULED) {
    return (
      <div>
        <span className="countdown">Opens in {countdown(starts - now)}</span>
      </div>
    );
  }
  if (lot.status !== LotStatus.LIVE) {
    return <span className="countdown muted">Closed</span>;
  }

  const left = ends - now;
  const total = Math.max(ends - starts, 1);
  const urgent = left < SOFT_CLOSE_MS;
  const justExtended = now - extendedAt < 4_000;

  return (
    <div>
      <span className="countdown" data-urgent={urgent}>
        {countdown(left)}
      </span>
      <div className="countdown__bar" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.max(0, (left / total) * 100))}%` }} />
      </div>
      {justExtended ? (
        <div className="extension-note">Extended by 30 seconds after a late bid</div>
      ) : lot.extensionCount > 0 ? (
        <div className="extension-note">
          Extended {lot.extensionCount} {lot.extensionCount === 1 ? "time" : "times"}
        </div>
      ) : null}
    </div>
  );
}

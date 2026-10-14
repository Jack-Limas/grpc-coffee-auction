"use client";
import { useState, type FormEvent } from "react";
import { LotStatus, firstIssue, nextBidCents, parseUsdToCents, placeBidSchema, type Lot } from "@cafe/contracts";
import { useSession } from "@/hooks/use-session";
import { biddingClient } from "@/lib/rpc";
import { describeError, usd } from "@/lib/format";
import { Countdown } from "./countdown";
import { ReserveBadge } from "./lot-tag";
import { PaddleDialog } from "./paddle-dialog";
import { StampedPrice } from "./stamped-price";

type Notice = { kind: "ok" | "error"; text: string } | null;

/** Unary PlaceBid, validated client-side with the same Zod schema as the server. */
export function BidPanel({ lot, lastBidAt, extendedAt }: { lot: Lot; lastBidAt: number; extendedAt: number }) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState("");

  const live = lot.status === LotStatus.LIVE;
  const scheduled = lot.status === LotStatus.SCHEDULED;
  const leading = Boolean(session) && lot.leadingPaddle === session?.paddle;
  const twoSteps = lot.bidCount === 0 ? nextBidCents(lot.startingPriceCents) : nextBidCents(lot.currentPriceCents, 2);

  async function send(amountCents: number, maxAmountCents?: number) {
    const parsed = placeBidSchema.safeParse({
      lotId: lot.id,
      amountCents,
      maxAmountCents,
      // A fresh key per attempt: if the network retries, the server will not bid twice.
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success) {
      setNotice({ kind: "error", text: firstIssue(parsed.error) });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await biddingClient.placeBid(parsed.data);
      if (!res.bid) setNotice({ kind: "ok", text: `Maximum of ${usd(maxAmountCents ?? 0)}/lb saved. The house will bid for you when the lot opens.` });
      else if (leading && maxAmountCents) setNotice({ kind: "ok", text: `Your maximum is now ${usd(maxAmountCents)}/lb.` });
      else if (res.isLeading) setNotice({ kind: "ok", text: `You lead at ${usd(res.lot?.currentPriceCents ?? amountCents)}/lb.` });
      else setNotice({ kind: "error", text: `Bid placed, but a proxy bid answered at ${usd(res.lot?.currentPriceCents ?? 0)}/lb.` });
      setAmount("");
      setMax("");
    } catch (error) {
      const { message, minNextBidCents } = describeError(error);
      setNotice({ kind: "error", text: minNextBidCents && !message.includes("minimum") ? `${message}. Minimum is ${usd(minNextBidCents)}/lb.` : message });
    } finally {
      setBusy(false);
    }
  }

  function submitCustom(event: FormEvent) {
    event.preventDefault();
    const maxCents = max ? parseUsdToCents(max) : undefined;
    if (scheduled || leading) {
      if (maxCents === undefined || Number.isNaN(maxCents)) {
        setNotice({ kind: "error", text: "Enter your maximum in dollars, for example 24.50." });
        return;
      }
      void send(Math.min(lot.minNextBidCents, maxCents), maxCents);
      return;
    }
    const amountCents = amount ? parseUsdToCents(amount) : lot.minNextBidCents;
    if (Number.isNaN(amountCents) || (maxCents !== undefined && Number.isNaN(maxCents))) {
      setNotice({ kind: "error", text: "Use dollars with up to two decimals, for example 24.50." });
      return;
    }
    void send(amountCents, maxCents);
  }

  return (
    <section className="panel" aria-labelledby="panel-title">
      <div className="panel__status">
        <h2 id="panel-title" className="visually-hidden">
          Bidding
        </h2>
        <span className="muted">{scheduled ? "Opening price per lb" : "Current price per lb"}</span>
        <ReserveBadge lot={lot} />
      </div>
      <StampedPrice cents={lot.currentPriceCents} bidAt={lastBidAt} className="panel__price" />
      <p style={{ margin: "0 0 14px" }}>
        {lot.bidCount === 0 ? "No bids yet." : leading ? "You are the highest bidder." : `${lot.leadingPaddle} leads.`} Lot
        value {usd(lot.currentPriceCents * lot.weightLb)}.
      </p>
      <Countdown lot={lot} extendedAt={extendedAt} />

      {!session ? (
        <div style={{ marginTop: 18 }}>
          <PaddleDialog
            trigger={(open) => (
              <button className="btn btn--cherry" style={{ width: "100%" }} onClick={open}>
                Get a paddle to bid
              </button>
            )}
          />
        </div>
      ) : live || scheduled ? (
        <>
          {live && !leading ? (
            <div className="quick-bids">
              <button className="btn btn--cherry" disabled={busy} onClick={() => void send(lot.minNextBidCents)}>
                Bid {usd(lot.minNextBidCents)}
                <small>the minimum</small>
              </button>
              <button className="btn" disabled={busy} onClick={() => void send(twoSteps)}>
                Bid {usd(twoSteps)}
                <small>one step more</small>
              </button>
            </div>
          ) : null}

          <form onSubmit={submitCustom} noValidate style={{ marginTop: live && !leading ? 0 : 18 }}>
            {live && !leading ? (
              <div className="field">
                <label htmlFor="bid-amount">Your bid per lb</label>
                <input
                  id="bid-amount"
                  inputMode="decimal"
                  placeholder={(lot.minNextBidCents / 100).toFixed(2)}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            ) : null}
            <div className="inline-form">
              <div className="field">
                <label htmlFor="bid-max">
                  {scheduled ? "Leave a maximum bid per lb" : leading ? "Raise your maximum per lb" : "Maximum per lb (optional)"}
                </label>
                <input
                  id="bid-max"
                  inputMode="decimal"
                  placeholder={((lot.minNextBidCents * 1.3) / 100).toFixed(2)}
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                  aria-describedby="bid-max-hint"
                />
              </div>
              <button type="submit" className="btn" disabled={busy}>
                {scheduled || leading ? "Save maximum" : "Place bid"}
              </button>
            </div>
            <p className="field__hint" id="bid-max-hint">
              With a maximum, the house answers every rival bid for you, one step at a time, never above it.
            </p>
          </form>
        </>
      ) : (
        <p className="notice" style={{ marginTop: 18 }}>
          Bidding has closed on this lot.
        </p>
      )}

      {notice ? (
        <p className={`notice ${notice.kind === "error" ? "notice--error" : ""}`} role="status">
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}

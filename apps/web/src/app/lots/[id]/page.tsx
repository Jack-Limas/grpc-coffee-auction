"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BidSource } from "@cafe/contracts";
import { BidPanel } from "@/components/bid-panel";
import { useLot } from "@/hooks/use-lot";
import { useSession } from "@/hooks/use-session";
import { millis, processLabel, usd } from "@/lib/format";

const sourceLabel: Record<BidSource, string> = {
  [BidSource.UNSPECIFIED]: "",
  [BidSource.WEB]: "Web",
  [BidSource.BOT]: "Bot (gRPC)",
  [BidSource.PROXY]: "Proxy",
};

export default function LotPage() {
  const { id } = useParams<{ id: string }>();
  const { lot, bids, lastBidAt, extendedAt, closed, status } = useLot(id);
  const session = useSession();

  if (!lot) {
    return (
      <div className="wrap" style={{ padding: "48px var(--gutter)" }}>
        <Link href="/" className="back-link">
          Back to the floor
        </Link>
        <p className="empty muted">{status === "reconnecting" ? "This lot could not be loaded. Retrying…" : "Loading lot…"}</p>
      </div>
    );
  }

  return (
    <div className="wrap lot-page">
      <article>
        <Link href="/" className="back-link">
          Back to the floor
        </Link>
        <h1 className="stencil lot-title">{lot.code}</h1>
        <p className="lot-sub">{lot.name}</p>
        <ul className="notes" aria-label="Tasting notes">
          {lot.cupping?.tastingNotes.map((note) => <li key={note}>{note}</li>)}
        </ul>

        <dl className="facts">
          <div>
            <dt>Cupping score</dt>
            <dd>{lot.cupping?.scaScore.toFixed(2)} SCA</dd>
          </div>
          <div>
            <dt>Variety</dt>
            <dd>{lot.variety}</dd>
          </div>
          <div>
            <dt>Process</dt>
            <dd>{processLabel[lot.process]}</dd>
          </div>
          <div>
            <dt>Farm</dt>
            <dd>{lot.origin?.farm}</dd>
          </div>
          <div>
            <dt>Producer</dt>
            <dd>{lot.origin?.producer}</dd>
          </div>
          <div>
            <dt>Origin</dt>
            <dd>
              {lot.origin?.municipality}, {lot.origin?.region}
            </dd>
          </div>
          <div>
            <dt>Altitude</dt>
            <dd>{lot.origin?.altitudeMasl.toLocaleString("en-US")} m</dd>
          </div>
          <div>
            <dt>Lot size</dt>
            <dd>{lot.weightLb} lb</dd>
          </div>
          <div>
            <dt>Starting price</dt>
            <dd>{usd(lot.startingPriceCents)}/lb</dd>
          </div>
        </dl>

        {closed ? (
          <p className={`notice ${closed.sold ? "" : "notice--error"}`}>
            {closed.sold
              ? `Sold to ${closed.winningPaddle}${closed.winningPaddle === session?.paddle ? " (you)" : ""} at ${usd(closed.hammerPriceCents)}/lb, ${usd(closed.totalValueCents)} in total.`
              : "Passed: the reserve price was not met, so the lot returns to the producer."}
          </p>
        ) : null}

        <h2 className="section__title" style={{ margin: "32px 0 12px", fontSize: "var(--step-3)" }}>
          Bid history
        </h2>
        {bids.length ? (
          <table className="history">
            <thead>
              <tr>
                <th scope="col">Paddle</th>
                <th scope="col">Placed by</th>
                <th scope="col">Time</th>
                <th scope="col" className="num">
                  Per lb
                </th>
              </tr>
            </thead>
            <tbody>
              {bids.map((bid) => (
                <tr key={bid.id}>
                  <td>
                    {bid.paddle}
                    {bid.paddle === session?.paddle ? " (you)" : ""}
                  </td>
                  <td>{sourceLabel[bid.source]}</td>
                  <td>{new Date(millis(bid.placedAt)).toLocaleTimeString("en-US")}</td>
                  <td className="num">{usd(bid.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No bids yet. The first bid can match the starting price.</p>
        )}
      </article>

      <BidPanel lot={lot} lastBidAt={lastBidAt} extendedAt={extendedAt} />
    </div>
  );
}

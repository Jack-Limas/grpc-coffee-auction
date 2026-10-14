"use client";
import Link from "next/link";
import { LotStatus, type Lot } from "@cafe/contracts";
import { processLabel, usd } from "@/lib/format";
import { Countdown } from "./countdown";
import { StampedPrice } from "./stamped-price";

export function ReserveBadge({ lot }: { lot: Lot }) {
  if (lot.status === LotStatus.SOLD) return <span className="badge badge--jade">Sold to {lot.leadingPaddle}</span>;
  if (lot.status === LotStatus.UNSOLD) return <span className="badge badge--roast">Passed, reserve not met</span>;
  if (lot.status === LotStatus.SCHEDULED) return <span className="badge badge--roast">Opens soon</span>;
  return lot.reserveMet ? (
    <span className="badge badge--jade">Reserve met</span>
  ) : (
    <span className="badge badge--husk">Below reserve</span>
  );
}

/** A lot card styled as the tag tied to an export sack. */
export function LotTag({ lot, bidAt, myPaddle }: { lot: Lot; bidAt: number; myPaddle?: string }) {
  const closed = lot.status === LotStatus.SOLD || lot.status === LotStatus.UNSOLD;
  const mine = Boolean(myPaddle) && lot.leadingPaddle === myPaddle;
  return (
    <Link href={`/lots/${lot.id}`} className={`tag ${closed ? "tag__closed" : ""}`} data-mine={mine}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, paddingRight: 22 }}>
        <div>
          <p className="stencil tag__code">{lot.code}</p>
          <p className="tag__name">{lot.name}</p>
        </div>
        <span className="score" title="SCA cupping score">
          {lot.cupping?.scaScore.toFixed(1)}
        </span>
      </div>
      <p className="tag__meta">
        {lot.variety}, {processLabel[lot.process].toLowerCase()} process
        <br />
        {lot.origin?.municipality}, {lot.origin?.region} at {lot.origin?.altitudeMasl.toLocaleString("en-US")} m
      </p>
      <div className="tag__row">
        <div>
          <StampedPrice cents={lot.currentPriceCents} bidAt={bidAt} className="tag__price" />
          <span className="tag__unit"> /lb</span>
          <div className="tag__meta">
            {lot.bidCount === 0
              ? closed
                ? "No bids"
                : `Opening at ${usd(lot.startingPriceCents)}`
              : closed
                ? `${lot.bidCount} bids`
                : `${lot.bidCount} bids, ${mine ? "you lead" : `${lot.leadingPaddle} leads`}`}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>{closed ? null : <Countdown lot={lot} />}</div>
      </div>
      <div>
        <ReserveBadge lot={lot} />
      </div>
    </Link>
  );
}

"use client";
import Link from "next/link";
import { BidSource } from "@cafe/contracts";
import { Countdown } from "@/components/countdown";
import { LotTag, ReserveBadge } from "@/components/lot-tag";
import { StampedPrice } from "@/components/stamped-price";
import { useFloor } from "@/hooks/use-floor";
import { useSession } from "@/hooks/use-session";
import { processLabel, usd } from "@/lib/format";

const sourceLabel: Record<BidSource, string> = {
  [BidSource.UNSPECIFIED]: "",
  [BidSource.WEB]: "web",
  [BidSource.BOT]: "bot",
  [BidSource.PROXY]: "proxy",
};

export default function FloorPage() {
  const { live, upcoming, closed, stats, feed, lastBidAt, status } = useFloor();
  const session = useSession();
  const next = live[0];

  return (
    <div className="wrap">
      <section className="hero" aria-labelledby="hero-title">
        <div>
          <p className="hero__intro">
            Colombian micro-lots, bid on live. Every price on this page arrives over a single gRPC stream.
          </p>
          {next ? (
            <>
              <p className="hero__label" id="hero-title">
                Closing next
              </p>
              <h1 className="stencil hero__code">{next.code}</h1>
              <p className="hero__name">{next.name}</p>
              <p className="muted" style={{ margin: 0 }}>
                {next.variety}, {processLabel[next.process].toLowerCase()} process from {next.origin?.farm},{" "}
                {next.origin?.municipality} ({next.origin?.region}). Cupping score {next.cupping?.scaScore.toFixed(2)}.
              </p>
            </>
          ) : (
            <h1 className="stencil hero__code" id="hero-title">
              {status === "live" ? "Between lots" : "Connecting…"}
            </h1>
          )}
        </div>

        {next ? (
          <div className="hero__price-block">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <span className="muted">Current price per lb</span>
              <ReserveBadge lot={next} />
            </div>
            <StampedPrice cents={next.currentPriceCents} bidAt={lastBidAt[next.id] ?? 0} className="hero__price" />
            <p style={{ margin: "0 0 14px" }}>
              {next.bidCount === 0 ? "No bids yet." : `${next.leadingPaddle} leads after ${next.bidCount} bids.`} Lot
              value {usd(next.currentPriceCents * next.weightLb)} for {next.weightLb} lb.
            </p>
            <Countdown lot={next} />
            <div style={{ marginTop: 16 }}>
              <Link href={`/lots/${next.id}`} className="btn btn--cherry">
                Bid on {next.code}
              </Link>
            </div>
          </div>
        ) : null}
      </section>

      <dl className="stats">
        <div>
          <dt>Lots on the floor</dt>
          <dd>{stats?.liveLots ?? "–"}</dd>
        </div>
        <div>
          <dt>Bids in the last minute</dt>
          <dd>{stats?.bidsLastMinute ?? "–"}</dd>
        </div>
        <div>
          <dt>People watching</dt>
          <dd>{stats?.connectedWatchers ?? "–"}</dd>
        </div>
        <div>
          <dt>Sold so far</dt>
          <dd>{stats ? usd(stats.totalSoldCents) : "–"}</dd>
        </div>
      </dl>

      <div className="floor-layout">
        <div>
          <section className="section" aria-labelledby="live-title">
            <div className="section__head">
              <h2 className="section__title" id="live-title">
                Live now
              </h2>
              <span className="conn" data-status={status}>
                {status === "live" ? "Streaming" : status === "connecting" ? "Connecting" : "Reconnecting"}
              </span>
            </div>
            {live.length ? (
              <div className="lot-grid">
                {live.map((lot) => (
                  <LotTag key={lot.id} lot={lot} bidAt={lastBidAt[lot.id] ?? 0} myPaddle={session?.paddle} />
                ))}
              </div>
            ) : (
              <p className="empty muted">No lot is live right now. The next one opens shortly.</p>
            )}
          </section>

          {upcoming.length ? (
            <section className="section" aria-labelledby="up-title">
              <div className="section__head">
                <h2 className="section__title" id="up-title">
                  Opening soon
                </h2>
                <span className="muted">Leave a maximum bid now and the house bids for you.</span>
              </div>
              <div className="lot-grid">
                {upcoming.map((lot) => (
                  <LotTag key={lot.id} lot={lot} bidAt={0} />
                ))}
              </div>
            </section>
          ) : null}

          {closed.length ? (
            <section className="section" aria-labelledby="closed-title">
              <div className="section__head">
                <h2 className="section__title" id="closed-title">
                  Hammer fallen
                </h2>
              </div>
              <div className="lot-grid">
                {closed.map((lot) => (
                  <LotTag key={lot.id} lot={lot} bidAt={0} myPaddle={session?.paddle} />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="feed" aria-labelledby="feed-title">
          <h2 id="feed-title">Bids as they land</h2>
          <p>Web bids, bot bids over native gRPC, and proxy bids placed by the house.</p>
          {feed.length ? (
            <ol aria-live="polite">
              {feed.map((item) => (
                <li key={item.id}>
                  <span className="paddle">{item.paddle}</span>
                  <Link href={`/lots/${item.lotId}`} style={{ textDecoration: "none" }}>
                    {item.lotCode} <span className="source">{sourceLabel[item.source]}</span>
                  </Link>
                  <span className="amount">{usd(item.amountCents)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>Waiting for the first bid.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

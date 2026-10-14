"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ListLotsResponseSchema, LotSchema, type ListLotsResponse } from "@cafe/contracts";
import { catalogClient } from "@/lib/rpc";
import { measure, wireStore } from "@/lib/wire-inspector";
import { env } from "@/lib/env";

function Arrow({ dir, count }: { dir: "up" | "down"; count: number }) {
  // Little lane diagram: client on the left, server on the right.
  const y = (i: number) => 14 + i * 12;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <line
          key={`${dir}${i}`}
          x1={dir === "up" ? 26 : 154}
          x2={dir === "up" ? 150 : 30}
          y1={y(i) + (dir === "down" ? 6 : 0)}
          y2={y(i) + (dir === "down" ? 6 : 0)}
          stroke="currentColor"
          strokeWidth="2"
          markerEnd="url(#head)"
        />
      ))}
    </>
  );
}

function Lane({ up, down }: { up: number; down: number }) {
  return (
    <svg width="180" height="70" viewBox="0 0 180 70" role="img" aria-label={`${up} request message(s), ${down} response message(s)`}>
      <defs>
        <marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
        </marker>
      </defs>
      <rect x="2" y="4" width="18" height="62" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="160" y="4" width="18" height="62" rx="2" fill="currentColor" />
      <Arrow dir="up" count={up} />
      <Arrow dir="down" count={down} />
    </svg>
  );
}

const PATTERNS = [
  { name: "Unary", up: 1, down: 1, where: "ListLots, GetLot, RegisterBidder, PlaceBid", who: "Browser and bots" },
  { name: "Server stream", up: 1, down: 4, where: "WatchFloor, WatchLot", who: "Browser: every live price on screen" },
  { name: "Client stream", up: 4, down: 1, where: "SubmitAbsenteeBook", who: "Bots send many proxy bids, get one summary" },
  { name: "Bidirectional", up: 3, down: 3, where: "BidderSession", who: "Bots: bids up and events down, same stream" },
];

export default function UnderTheHood() {
  const records = useSyncExternalStore(wireStore.subscribe, wireStore.snapshot, () => []);
  const [sample, setSample] = useState<ListLotsResponse | null>(null);

  useEffect(() => {
    catalogClient.listLots({ limit: 12 }).then(setSample).catch(() => setSample(null));
  }, []);

  const one = sample?.lots[0] ? measure(LotSchema, sample.lots[0]) : null;
  const all = sample ? measure(ListLotsResponseSchema, sample) : null;
  const widest = Math.max(all?.json ?? 1, 1);

  return (
    <div className="wrap hood">
      <h1 className="stencil lot-title">Under the hood</h1>
      <p className="hood__lead">
        There are no REST endpoints here. The browser calls remote functions such as <code>PlaceBid</code> as if they
        were local methods, generated from one contract file. Messages travel as Protocol Buffers bytes, not JSON text.
      </p>

      <h2 className="section__title" style={{ marginTop: 32 }}>
        Four ways to call
      </h2>
      <div className="patterns">
        {PATTERNS.map((p) => (
          <div key={p.name}>
            <h3>{p.name}</h3>
            <Lane up={p.up} down={p.down} />
            <p>
              <code>{p.where}</code>
            </p>
            <p className="muted">{p.who}</p>
          </div>
        ))}
      </div>

      <h2 className="section__title">Same data, two encodings</h2>
      <p className="muted" style={{ maxWidth: "60ch" }}>
        Measured live in your browser from the lots the server just sent. Protobuf drops field names and packs numbers
        as varints, so the same message weighs a fraction of its JSON twin.
      </p>
      {all && one ? (
        <div className="size-compare" style={{ margin: "16px 0 40px" }}>
          {[
            { label: "One lot, JSON", bytes: one.json, proto: false },
            { label: "One lot, Protobuf", bytes: one.proto, proto: true },
            { label: `${sample?.lots.length} lots, JSON`, bytes: all.json, proto: false },
            { label: `${sample?.lots.length} lots, Protobuf`, bytes: all.proto, proto: true },
          ].map((row) => (
            <div key={row.label} className={`size-bar ${row.proto ? "size-bar--proto" : ""}`}>
              <span>{row.label}</span>
              <div className="size-bar__track">
                <div className="size-bar__fill" style={{ width: `${(row.bytes / widest) * 100}%` }} />
              </div>
              <strong style={{ textAlign: "right" }}>{row.bytes.toLocaleString("en-US")} B</strong>
            </div>
          ))}
          <p style={{ margin: 0 }}>
            Protobuf is <strong>{Math.round((1 - all.proto / all.json) * 100)}% smaller</strong> for this response.
          </p>
        </div>
      ) : (
        <p className="muted">Waiting for the server at {env.NEXT_PUBLIC_API_URL}…</p>
      )}

      <h2 className="section__title">Wire inspector</h2>
      <p className="muted" style={{ maxWidth: "60ch" }}>
        Every RPC this tab makes passes through a client interceptor that records it. Browse the floor or place a bid,
        then come back.
      </p>
      <div className="table-scroll" style={{ margin: "16px 0 40px" }}>
        <table className="inspector">
          <thead>
            <tr>
              <th scope="col">Method</th>
              <th scope="col">Type</th>
              <th scope="col">Status</th>
              <th scope="col" className="num">Messages</th>
              <th scope="col" className="num">Protobuf</th>
              <th scope="col" className="num">As JSON</th>
              <th scope="col" className="num">Time</th>
            </tr>
          </thead>
          <tbody>
            {records.length ? (
              records.map((r) => (
                <tr key={r.id}>
                  <td>{r.method}</td>
                  <td>{r.kind}</td>
                  <td style={{ color: r.status === "error" ? "var(--cherry)" : r.status === "streaming" ? "var(--jade)" : undefined }}>
                    {r.status === "error" ? (r.error ?? "error") : r.status === "streaming" ? "open" : "ok"}
                  </td>
                  <td className="num">{r.messages}</td>
                  <td className="num">{r.protoBytes.toLocaleString("en-US")} B</td>
                  <td className="num">{r.jsonBytes.toLocaleString("en-US")} B</td>
                  <td className="num">{r.ms < 1000 ? `${r.ms.toFixed(0)} ms` : `${(r.ms / 1000).toFixed(1)} s`}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>No calls recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="section__title">The contract</h2>
      <p className="muted" style={{ maxWidth: "60ch" }}>
        Written first, before any code. The server, this website and the bots are all generated from it, so a renamed
        field breaks the build on every side at once.
      </p>
      <pre className="proto-snippet" style={{ marginTop: 16 }}>
        <code>
          <span className="k">service</span> BiddingService {"{\n"}
          {"  "}<span className="k">rpc</span> PlaceBid(PlaceBidRequest) <span className="k">returns</span> (PlaceBidResponse);{"\n"}
          {"  "}<span className="k">rpc</span> WatchFloor(WatchFloorRequest) <span className="k">returns</span> (<span className="k">stream</span> WatchFloorResponse);{"\n"}
          {"  "}<span className="k">rpc</span> WatchLot(WatchLotRequest) <span className="k">returns</span> (<span className="k">stream</span> WatchLotResponse);{"\n"}
          {"  "}<span className="k">rpc</span> SubmitAbsenteeBook(<span className="k">stream</span> SubmitAbsenteeBookRequest) <span className="k">returns</span> (SubmitAbsenteeBookResponse);{"\n"}
          {"  "}<span className="k">rpc</span> BidderSession(<span className="k">stream</span> BidderSessionRequest) <span className="k">returns</span> (<span className="k">stream</span> BidderSessionResponse);{"\n"}
          {"}\n\n"}
          <span className="k">message</span> PlaceBidRequest {"{\n"}
          {"  "}string lot_id = 1;{"\n"}
          {"  "}int32 amount_cents = 2;            <span className="c">{"// per lb, integer cents"}</span>{"\n"}
          {"  "}optional int32 max_amount_cents = 3; <span className="c">{"// enables proxy bidding"}</span>{"\n"}
          {"  "}string idempotency_key = 4;        <span className="c">{"// safe retries"}</span>{"\n"}
          {"}"}
        </code>
      </pre>
    </div>
  );
}

import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { BidRejectionSchema, CoffeeProcess, LotStatus, formatUsd } from "@cafe/contracts";
import { ConnectError } from "@connectrpc/connect";

export const usd = formatUsd;

export const millis = (ts: Timestamp | undefined): number => (ts ? timestampDate(ts).getTime() : 0);

export function countdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export const processLabel: Record<CoffeeProcess, string> = {
  [CoffeeProcess.UNSPECIFIED]: "Unknown",
  [CoffeeProcess.WASHED]: "Washed",
  [CoffeeProcess.NATURAL]: "Natural",
  [CoffeeProcess.HONEY]: "Honey",
  [CoffeeProcess.ANAEROBIC]: "Anaerobic",
  [CoffeeProcess.THERMAL_SHOCK]: "Thermal shock",
};

export const statusLabel: Record<LotStatus, string> = {
  [LotStatus.UNSPECIFIED]: "Unknown",
  [LotStatus.SCHEDULED]: "Opens soon",
  [LotStatus.LIVE]: "Live",
  [LotStatus.SOLD]: "Sold",
  [LotStatus.UNSOLD]: "Passed",
};

/** Turns any RPC failure into a sentence the bidder can act on. */
export function describeError(error: unknown): { message: string; minNextBidCents?: number } {
  const err = ConnectError.from(error);
  const [detail] = err.findDetails(BidRejectionSchema);
  return { message: err.rawMessage, minNextBidCents: detail?.minNextBidCents };
}

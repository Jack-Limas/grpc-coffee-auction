import { toBinary, toJsonString, type DescMessage, type Message } from "@bufbuild/protobuf";
import type { Interceptor } from "@connectrpc/connect";

/**
 * A client-side interceptor that records every RPC: method, call type,
 * status, latency and the size of the payload as Protobuf vs as JSON.
 * It powers the "Under the hood" page.
 */
export interface WireRecord {
  readonly id: number;
  readonly method: string;
  readonly kind: string;
  readonly status: "ok" | "error" | "streaming";
  readonly ms: number;
  readonly messages: number;
  readonly protoBytes: number;
  readonly jsonBytes: number;
  readonly at: number;
  readonly error?: string;
}

type Listener = () => void;
const MAX = 60;
let records: WireRecord[] = [];
const listeners = new Set<Listener>();
let seq = 0;

export const wireStore = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  snapshot: () => records,
  clear() {
    records = [];
    listeners.forEach((l) => l());
  },
};

function upsert(record: WireRecord) {
  const index = records.findIndex((r) => r.id === record.id);
  records = index >= 0 ? records.map((r) => (r.id === record.id ? record : r)) : [record, ...records].slice(0, MAX);
  listeners.forEach((l) => l());
}

export function measure(schema: DescMessage, message: Message): { proto: number; json: number } {
  try {
    return {
      proto: toBinary(schema, message).byteLength,
      json: new TextEncoder().encode(toJsonString(schema, message)).byteLength,
    };
  } catch {
    return { proto: 0, json: 0 };
  }
}

const KIND: Record<string, string> = {
  unary: "unary",
  server_streaming: "server stream",
  client_streaming: "client stream",
  bidi_streaming: "bidi",
};

export const wireInspector: Interceptor = (next) => async (req) => {
  const id = ++seq;
  const started = performance.now();
  const base = { id, method: `${req.service.name}/${req.method.name}`, kind: KIND[req.method.methodKind] ?? req.method.methodKind, at: Date.now() };
  try {
    const res = await next(req);
    if (!res.stream) {
      const size = measure(req.method.output, res.message);
      upsert({ ...base, status: "ok", ms: performance.now() - started, messages: 1, protoBytes: size.proto, jsonBytes: size.json });
      return res;
    }
    // Streams: count every message as it arrives.
    let messages = 0;
    let proto = 0;
    let json = 0;
    const source = res.message;
    upsert({ ...base, status: "streaming", ms: performance.now() - started, messages, protoBytes: 0, jsonBytes: 0 });
    return {
      ...res,
      message: (async function* () {
        try {
          for await (const m of source) {
            const size = measure(req.method.output, m);
            messages++;
            proto += size.proto;
            json += size.json;
            if (messages % 3 === 1) upsert({ ...base, status: "streaming", ms: performance.now() - started, messages, protoBytes: proto, jsonBytes: json });
            yield m;
          }
          upsert({ ...base, status: "ok", ms: performance.now() - started, messages, protoBytes: proto, jsonBytes: json });
        } catch (error) {
          upsert({ ...base, status: "error", ms: performance.now() - started, messages, protoBytes: proto, jsonBytes: json, error: String((error as Error).message) });
          throw error;
        }
      })(),
    };
  } catch (error) {
    upsert({ ...base, status: "error", ms: performance.now() - started, messages: 0, protoBytes: 0, jsonBytes: 0, error: String((error as Error).message) });
    throw error;
  }
};

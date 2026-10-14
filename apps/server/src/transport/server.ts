import { connectNodeAdapter } from "@connectrpc/connect-node";
import { cors as connectCors, type ConnectRouter, type Interceptor } from "@connectrpc/connect";
import http from "node:http";
import http2 from "node:http2";
import net from "node:net";
import { Duplex } from "node:stream";

/**
 * ONE PORT, THREE PROTOCOLS, TWO HTTP VERSIONS.
 *
 *   Browser (fetch)        -> Connect / gRPC-Web over HTTP/1.1
 *   Bots, grpcurl, buf curl -> native gRPC over HTTP/2 (h2c, "prior knowledge")
 *
 * Node's http2 server cannot accept HTTP/1.1 without TLS, so we sniff the
 * first bytes of every TCP connection: HTTP/2 always starts with the
 * connection preface "PRI * HTTP/2.0". In the cloud, TLS is terminated by the
 * platform's edge (Koyeb), which forwards plain HTTP/1.1 or h2c to us.
 */

const HTTP2_PREFACE = Buffer.from("PRI * HTTP/2.0");

export interface ServerOptions {
  readonly routes: (router: ConnectRouter) => void;
  readonly interceptors: Interceptor[];
  readonly corsOrigins: string;
  readonly health: () => Promise<Record<string, unknown>>;
}

/** The tiny common surface of HTTP/1.1 and HTTP/2 requests/responses we use. */
interface AnyRequest {
  readonly url?: string;
  readonly method?: string;
  readonly headers: http.IncomingHttpHeaders;
}
interface AnyResponse {
  setHeader(name: string, value: string): unknown;
  writeHead(status: number, headers?: Record<string, string>): unknown;
  end(body?: string): unknown;
}

export function createDualProtocolServer(options: ServerOptions): net.Server {
  const rpcHandler = connectNodeAdapter({
    routes: options.routes,
    interceptors: options.interceptors,
    // Same handler, all protocols on: gRPC, gRPC-Web and Connect.
    grpc: true,
    grpcWeb: true,
    connect: true,
    fallback: (req, res) => void fallback(req, res as unknown as AnyResponse, options),
  });

  const allowed = options.corsOrigins.split(",").map((o) => o.trim()).filter(Boolean);

  const handler = (req: http.IncomingMessage | http2.Http2ServerRequest, res: http.ServerResponse | http2.Http2ServerResponse) => {
    if (applyCors(req, res as unknown as AnyResponse, allowed)) return;
    rpcHandler(req, res);
  };

  const h1 = http.createServer(handler);
  const h2 = http2.createServer({}, handler);
  // Long-lived streams: never let Node time them out on its own.
  h1.requestTimeout = 0;
  h1.headersTimeout = 60_000;
  h1.keepAliveTimeout = 65_000;

  return net.createServer((socket) => {
    socket.on("error", () => socket.destroy());
    socket.once("data", (chunk: Buffer) => {
      socket.pause();
      if (chunk.subarray(0, HTTP2_PREFACE.length).equals(HTTP2_PREFACE)) {
        // The http2 core reads from the native handle and would miss the bytes
        // we already consumed, so we hand it a stream that replays them first.
        h2.emit("connection", replayingStream(socket, chunk));
      } else {
        socket.unshift(chunk);
        h1.emit("connection", socket);
        socket.resume();
      }
    });
  });
}

/** A Duplex that first emits `head`, then everything the socket receives. */
function replayingStream(socket: net.Socket, head: Buffer): Duplex {
  const stream = new Duplex({
    read() {
      socket.resume();
    },
    write(chunk, encoding, callback) {
      socket.write(chunk, encoding, callback);
    },
    final(callback) {
      socket.end(callback);
    },
    destroy(error, callback) {
      socket.destroy(error ?? undefined);
      callback(error);
    },
  });
  stream.push(head);
  socket.on("data", (data) => {
    if (!stream.push(data)) socket.pause();
  });
  socket.on("end", () => stream.push(null));
  socket.on("close", () => stream.destroy());
  socket.on("error", (error) => stream.destroy(error));
  return stream;
}

/** Returns true when the request was fully answered (preflight / rejected). */
function applyCors(req: AnyRequest, res: AnyResponse, allowed: string[]): boolean {
  const origin = req.headers.origin;
  if (!origin) return false; // not a browser cross-origin call

  const ok = allowed.includes("*") || allowed.includes(origin) || allowed.some((a) => matchesWildcard(a, origin));
  if (!ok) {
    if (req.method === "OPTIONS") {
      res.writeHead(403);
      res.end();
      return true;
    }
    return false; // the browser will block the response itself
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Expose-Headers", connectCors.exposedHeaders.join(", "));
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", connectCors.allowedMethods.join(", "));
    res.setHeader("Access-Control-Allow-Headers", [...connectCors.allowedHeaders, "Authorization"].join(", "));
    res.setHeader("Access-Control-Max-Age", "7200");
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

/** Supports entries like "https://*.vercel.app". */
function matchesWildcard(pattern: string, origin: string): boolean {
  if (!pattern.includes("*")) return false;
  const regex = new RegExp("^" + pattern.split("*").map(escapeRegex).join("[a-z0-9-]+") + "$", "i");
  return regex.test(origin);
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function fallback(req: AnyRequest, res: AnyResponse, options: ServerOptions): Promise<void> {
  if (req.url === "/healthz" || req.url === "/") {
    const body = JSON.stringify({ status: "ok", service: "cafe-subasta", ...(await options.health()) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found. This is a gRPC / Connect API — see /healthz");
}

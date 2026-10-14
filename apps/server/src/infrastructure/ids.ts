import { createHash, randomBytes, randomUUID } from "node:crypto";

export const newId = (): string => randomUUID();

/** Session tokens are random; only their SHA-256 hash is stored. */
export const newToken = (): string => randomBytes(32).toString("base64url");

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

import { storedSessionSchema, type StoredSession } from "@cafe/contracts";

/**
 * TYPE ERASURE in practice:
 *   const s = JSON.parse(localStorage.getItem(KEY)!) as StoredSession;
 * compiles fine and lies at runtime (old format, edited by hand, corrupted...).
 * Zod checks the real shape and we fall back to "no session" if it is wrong.
 */
const KEY = "cafe-subasta.session.v1";
type Listener = () => void;
const listeners = new Set<Listener>();
let cached: StoredSession | null | undefined;

export function readSession(): StoredSession | null {
  if (cached !== undefined) return cached;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = storedSessionSchema.safeParse(raw ? JSON.parse(raw) : null);
    cached = parsed.success ? parsed.data : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function saveSession(session: StoredSession | null): void {
  cached = session;
  try {
    if (session) window.localStorage.setItem(KEY, JSON.stringify(session));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage may be blocked: the session still lives in memory */
  }
  listeners.forEach((l) => l());
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

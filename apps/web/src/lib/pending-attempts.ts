/**
 * UX-035 / TD-071 / TD-073 — the browser's memory of commands whose answer it
 * never received.
 *
 * Each command that creates something (a sale draft, a cash session, a cash
 * movement) is sent with an `Idempotency-Key` the browser mints for that
 * attempt. Before sending, the key is written here; when a definitive answer
 * arrives it is removed. If the answer is lost — the network dropped, the page
 * was reloaded, the tab went Back/Forward — the next page that loads finds the
 * key and asks the API what that attempt recorded (`GET …/attempts/:key`), instead
 * of re-sending blind or guessing by comparing values.
 *
 * **Only the key, the kind and the instant are stored**: no item, price, amount,
 * customer or clinical content ever reaches browser storage (TD-071's rule). The
 * storage is the TAB's `sessionStorage`, so it survives a reload and history
 * navigation but not closing the tab, and it is never shared across tabs. Every
 * access is wrapped: storage can be unavailable (private mode, blocked site
 * data), and then the page still works, without the post-reload recovery.
 */

export type PendingAttemptKind = "sale.create" | "cash.session.open" | "cash.movement.create";

export interface PendingAttempt {
  readonly kind: PendingAttemptKind;
  /** The `Idempotency-Key` the attempt was sent with (a UUID). */
  readonly key: string;
  /** ISO instant the attempt started. */
  readonly startedAt: string;
}

const STORAGE_KEY = "newsaas.pending-attempts.v1";
/** An attempt older than this is no longer worth asking about. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 20;
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: readonly PendingAttemptKind[] = [
  "sale.create",
  "cash.session.open",
  "cash.movement.create",
];

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isAttempt(value: unknown): value is PendingAttempt {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.kind === "string" &&
    (KINDS as readonly string[]).includes(candidate.kind) &&
    typeof candidate.key === "string" &&
    KEY_PATTERN.test(candidate.key) &&
    typeof candidate.startedAt === "string" &&
    !Number.isNaN(Date.parse(candidate.startedAt))
  );
}

function readAll(now: Date): PendingAttempt[] {
  const store = storage();
  if (store === null) return [];
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isAttempt)
      .filter((attempt) => now.getTime() - Date.parse(attempt.startedAt) < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function writeAll(attempts: readonly PendingAttempt[]): void {
  const store = storage();
  if (store === null) return;
  try {
    if (attempts.length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(attempts.slice(-MAX_ENTRIES)));
  } catch {
    // Storage full or blocked: the in-page protection still holds.
  }
}

/** A fresh attempt key. `crypto.randomUUID` exists in every supported browser. */
export function newAttemptKey(): string {
  return crypto.randomUUID();
}

/** Records an attempt BEFORE it is sent. */
export function rememberAttempt(kind: PendingAttemptKind, key: string, now = new Date()): void {
  const others = readAll(now).filter((attempt) => attempt.key !== key);
  writeAll([...others, { kind, key, startedAt: now.toISOString() }]);
}

/** Forgets an attempt once its outcome is known (created, refused, or confirmed absent). */
export function forgetAttempt(key: string, now = new Date()): void {
  writeAll(readAll(now).filter((attempt) => attempt.key !== key));
}

/** The attempts of one kind still awaiting an answer, oldest first. */
export function pendingAttempts(kind: PendingAttemptKind, now = new Date()): PendingAttempt[] {
  return readAll(now).filter((attempt) => attempt.kind === kind);
}

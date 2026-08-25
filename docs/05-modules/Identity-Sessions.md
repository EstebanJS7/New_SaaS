---
type: module
module: identity-sessions
status: implemented
updated: 2026-08-24
---

# Module — Identity & Sessions

## Responsibility

First-party staff authentication: credential verification, PostgreSQL-backed
revocable sessions, hardened session cookies and the login rate limiter.

## Does Not Own

- Tenant authority (see [[Tenancy]]).
- Role/permission policy evaluation (EPIC-02).
- Password reset / account recovery (deferred: [[TD-004]], blocked on EPIC-17
  email delivery).
- Customer portal identity (separate scaffold; no shared controllers).

## Public Capabilities

- `POST /auth/login` — email+password login; issues an opaque session token.
- `POST /auth/logout` — hard-deletes the server-side session; clears cookie.
- `GET /auth/me` — server-derived identity probe for the active session.

## Main Entities

```text
UserProfile   (global person, email UNIQUE app-lowercased)
UserCredential (1:1 RESTRICTED argon2id hash; never selected by app reads)
StaffSession  (token_hash UNIQUE; SHA-256 at rest; insert-per-login rotation)
```

## Session Semantics

- Opaque token: `randomBytes(32)` base64url; only its SHA-256 is stored.
- Idle TTL 2h rolling (`SESSION_IDLE_TTL`, refreshed when >60s stale); absolute
  TTL 12h (`SESSION_ABSOLUTE_TTL`); env-tunable.
- Logout hard-deletes the row; replaying that cookie yields `401`.
- Cookie `ns_staff_session`: HttpOnly, Path=/, SameSite=Lax, Secure outside
  development (secure-by-default for unset NODE_ENV).

## Rate Limits

In-process sliding window per (email, IP-hash): ≥10 failed logins in 15 min ⇒
`429 RATE_LIMITED` envelope; success resets the counter. Single-replica scope:
[[TD-005]] tracks the distributed revision before horizontal scaling. Blocked
attempts are rejected before any database/crypto work and are NOT audited (flood
defense).

## Invariants

- Unknown email and wrong password produce byte-identical `401` envelopes; both
  paths burn one full argon2id verification (anti-enumeration).
- Hash parameters: argon2id m=19456 KiB, t=2, p=1 (OWASP floor, env-tunable);
  the hash never leaves the credentials store.
- `/auth/me` reflects ONLY server-derived session context; client-sent identity
  fields/headers are ignored.
- No recovery route exists: any forgot/reset path returns a `404` envelope.

## Security / Tenant Rules

- Login/logout are `@Public`; everything else requires a live session
  (`AuthGuard` populates the RequestContext).
- No password or hash material appears in responses or logs (redaction rules
  - leak-scan tests).

## Related Stories

- [[EPIC-01]] DAT-003 (Slice S3).

## Related ADRs

- Route-prefix deferral: [[DEC-002]] (unprefixed `/auth/*` paths shipped).

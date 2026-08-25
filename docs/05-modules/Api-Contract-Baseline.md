---
type: module
module: api-contract-baseline
status: implemented
updated: 2026-08-24
---

# Module — API Contract Baseline

## Responsibility

Cross-cutting HTTP contract: uniform error envelope, frozen error-code registry,
request-id correlation, structured logging, health probes and the transport
security baseline (CORS + security headers).

## Does Not Own

- Any business domain behavior.
- Authentication/tenancy decisions (see [[Identity-Sessions]], [[Tenancy]]).

## Public Capabilities

- `GET /health/live` — liveness; 200 while the process serves.
- `GET /health/ready` — readiness; aggregates PostgreSQL ping + Redis ping;
  `503` while ANY checked dependency is unreachable.

## Error Envelope

Every error matches (PRD §28):

```json
{ "error": { "code": "STABLE_CODE", "message": "...", "requestId": "..." } }
```

Codes come from the frozen registry (`@newsaas/shared`):
`VALIDATION_FAILED·400`, `UNAUTHENTICATED·401`, `FORBIDDEN·403`,
`NOT_FOUND·404`, `CONFLICT·409`, `RATE_LIMITED·429`, `INTERNAL·500`. Zod
failures flatten to `VALIDATION_FAILED`; unknown failures collapse to a generic
`INTERNAL` with stacks suppressed outside development.

## Request-ID & Logging

- Inbound `X-Request-Id` adopted only when valid (trimmed, ≤128 printable
  ASCII), else a UUID is generated; the resolved id is ALWAYS echoed on the
  response header and embedded in envelopes.
- pino structured logs bind the request id to every line; `req.headers.cookie`,
  `*.password`, `*.passwordHash` are redacted.

## Transport Security Baseline

Implemented natively in the shared Fastify adapter factory (no CORS runtime
dependency):

- Security headers on EVERY response, errors included:
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` emitted only
  when the HTTPS-grade posture is active (non-development NODE_ENV — the same
  condition that makes session cookies Secure).
- CORS: explicit server-side allowlist from `API_CORS_ALLOWED_ORIGINS`
  (comma-separated exact origins). Empty default = same-origin ONLY — every
  cross-origin request carrying an Origin header is rejected `403 FORBIDDEN`
  with no `Access-Control-Allow-*` headers. Allowlisted origins are echoed on
  `Access-Control-Allow-Origin` (plus `Vary: Origin`) and preflight `OPTIONS`
  answers `204` with fixed method/header allowances.

## Health Semantics

- `/health/ready` checks dependencies per request; it never caches verdicts.
- Dependency-down scenarios leave `/health/live` at 200 (process alive) while
  ready reports 503.

## Invariants

- One adapter construction point (`createFastifyAdapter`) for production and
  tests: request-id, cookie plugin, CORS and security headers behave identically
  everywhere.
- No code path can skip the security-header baseline (hook runs pre-routing).
- Unknown routes return the standard `404 NOT_FOUND` envelope.

## Related Stories

- [[EPIC-01]] DAT-002 (Slice S2); transport baseline completed in the final
  apply batch.

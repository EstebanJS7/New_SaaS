---
id: HARD-001
type: story
title: Content-Security-Policy with a per-request nonce
epic: EPIC-20
status: planned
priority: high
depends_on: []
prd_sections:
  - "29"
permissions: []
branch: feat/epic-20-production-hardening
created: 2026-10-22
updated: 2026-10-22
---

# HARD-001 — Content-Security-Policy with a per-request nonce

## Objective

Close the one security header PRD §29 requires that the repository does not
emit: a `Content-Security-Policy` with a per-request nonce on `script-src` and
`style-src`, and no `unsafe-inline` in either. [[DEC-075]] fixes the policy and
rejects the alternatives.

## Context

A search for `content-security-policy` across the repository returns zero
matches, so this is the only genuinely missing control of PRD §29's header set.
The rest already exists and is proven:

```text
x-content-type-options: nosniff          fastify-adapter.factory.ts
x-frame-options: DENY                    fastify-adapter.factory.ts
referrer-policy                          fastify-adapter.factory.ts
strict-transport-security (non-dev)      fastify-adapter.factory.ts, hstsEnabled
CORS allowlist, deny-by-default          fastify-adapter.factory.ts
no stack traces in 5xx                   global-exception.filter.ts
```

The constraint is real and not cosmetic. Three layouts emit inline nodes whose
ordering a test already pins:

```text
apps/web/src/app/layout.tsx:110          inline <script>  appearance bootstrap
apps/web/src/app/layout.tsx:115          inline <style>   product brand preset
apps/web/src/app/(app)/layout.tsx:89,93  inline <script> + <style>
apps/web/src/app/(portal)/layout.tsx:44,48
```

`apps/web/src/middleware.ts` already exists, so the nonce has a home.

## Acceptance Criteria

- [ ] `apps/web/src/middleware.ts` mints a nonce per request and sets the
      `Content-Security-Policy` response header from one exported policy
      function.
- [ ] The policy has `default-src 'self'`, `script-src 'self' 'nonce-<n>'`,
      `style-src 'self' 'nonce-<n>'`, `object-src 'none'`, `base-uri 'self'`,
      `frame-ancestors 'none'`, `form-action 'self'`, and an explicit `img-src`
      allowance for branding assets.
- [ ] The policy contains **no** `unsafe-inline` and **no** `unsafe-eval`.
- [ ] Every inline `<script>` and `<style>` in the three layouts carries the
      nonce, and the root layout's pre-paint ordering guarantee is unchanged.
- [ ] A test asserts the policy string verbatim, so a weakened directive fails a
      test rather than a review.
- [ ] A test asserts each rendered inline node carries the same nonce value the
      header declares.
- [ ] The browser lane runs green with zero CSP violations in the console, and
      the branding still applies its CSS variables on first paint.
- [ ] The already-satisfied PRD §29 items (CORS, no stack traces) are recorded as
      evidence in the story's implementation summary rather than re-implemented.

## Verification

```text
pnpm --filter @newsaas/web test
pnpm format-check && pnpm lint && pnpm typecheck && pnpm build
pnpm --filter @newsaas/e2e test        (browser lane)
```

## Technical Debt / Limitations

- A CSP that is correct today breaks when a future layout emits an inline node
  without the nonce. The mitigation is the nonce-presence test, which fails
  before the paint does.
- The API keeps its JSON-only header baseline. A `script-src` on a JSON API
  protects nothing; the policy belongs where HTML is rendered.

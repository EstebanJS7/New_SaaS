---
id: TD-047
type: tech-debt
title:
  The read surface's two advisories — a 404 for a bad filter, and an invisible
  denial on the detail read
status: resolved
severity: low
owner: notifications
related_epics:
  - EPIC-17
related_stories:
  - NOTIF-004
created: 2026-10-17
updated: 2026-10-17
---

# TD-047 — the read surface's two advisories

Raised by `review-a12969035780ff93` (EPIC-17 WU-E), which **approved this
candidate on the first pass** and left two non-blocking findings. Both are
recorded by their provider-issued coordinate, and each **reading** below is
mine, marked as such: the closure named locations, severities and dispositions,
not the findings' text.

## R3-001 — WARNING — `apps/web/src/app/api/notifications/[[...path]]/route.ts:62-65`

**Reading.** The BFF's query guard answers **`404 NOT_FOUND`** for a key outside
the allowlist, on the same path that would have served the request:

```ts
if (
  [...params.keys()].some(
    (key) => !NOTIFICATION_QUERY_KEYS[shape].includes(key)
  )
)
  return { ok: false, response: notFound() };
```

So `?status=FAILED&typo=1` is reported to the caller as "this route does not
exist", while the API behind it answers `400 VALIDATION_FAILED` for the same
class of mistake — and the surface's own suite asserts the `404`. The status is
**deliberate** (a BFF that echoes which keys it knows is a BFF that documents
its own contract to an unauthenticated shaper of requests) and it matches the
fiscal BFF's precedent, which also maps an unlisted key to `notFound()`.

The cost is diagnosability: a caller debugging a mistyped filter sees a missing
route rather than a rejected parameter, and the two layers of one request
disagree about what kind of failure it was. A future unit could align them by
answering `400` with the key's name absent — the refusal stays, only the
vocabulary changes — or leave the precedent alone and note in the code why it is
a `404`.

## R3-002 — SUGGESTION — `apps/web/src/app/(app)/app/notifications/notifications-surface.tsx:84-88`

**Reading.** The **detail** read has no permission-denied state of its own. Its
error text is suppressed whenever the error is a denial:

```tsx
errorMessage={
  detailQuery.error === null || forbiddenDetail ? null : "This delivery could not be loaded."
}
```

and the panel then falls through to its empty state, "Select a delivery to see
its detail." The list has a first-class denial state; the detail silently
pretends it has nothing to show. In practice the two reads carry the same
permission, so a caller who can see the list can see a detail — which is why
this is a suggestion and not a warning. It becomes real the moment the two reads
diverge, or the moment a key is revoked mid-session and the list's cached data
outlives the permission.

A future unit should either give the detail its own denial state or drop the
`forbiddenDetail` branch and let the generic failure message stand, since "it
could not be loaded" is true either way.

## Resolution (2026-10-17)

**R3-001 — fixed, and the refusal is unchanged.** The BFF's guard now answers
**`400 VALIDATION_FAILED`** with the message _"This notification query is not
supported."_ The key is still never forwarded and the accepted keys are still
not named — only the vocabulary changed, so the two layers of one request stop
disagreeing about what kind of failure it was. The case that asserted the `404`
now asserts the `400` and the code, and additionally that the message does not
name the accepted keys.

**A divergence this fix makes visible rather than creates**: the **fiscal BFF
still answers `404`** for an unlisted query key
(`apps/web/src/app/api/fiscal/[[...path]]/route.ts`, `resolveFiscalQuery`
returning `null`). That is pre-existing behavior in a closed epic, and this unit
does not change it. It is named here so the difference is a known one:

```text
BFF                        unlisted query key     unlisted path
-------------------------- ---------------------- -----------------
notifications (after fix)  400 VALIDATION_FAILED  404 NOT_FOUND
fiscal (pre-existing)      404 NOT_FOUND          404 NOT_FOUND
```

The next unit that touches either BFF should decide which column is right rather
than letting the table grow by accident.

**R3-002 — fixed by giving the detail read a state of its own.** The detail
panel now has `permissionDenied` and renders
`notification-detail-permission-denied`; the surface passes the denial through
instead of swallowing it into `null`. The old behavior told a reader to "select
a delivery to see its detail" about a delivery they had just selected, which is
a lie rather than a gap — benign only while both reads carry the same
permission. Its own case asserts the denial renders and that neither the empty
nor the error state is shown.

## Related

- `docs/02-stories/NOTIF-004-transactional-surface-and-permissions.md` — the
  Story.
- [[TD-046]] — the attempt log the same Story could not serve.

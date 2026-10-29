---
id: DEC-082
type: decision
title: Minimal professional display identity in agenda options
status: accepted
date: 2026-10-28
updated: 2026-10-28
related_stories: [UX-002]
prd_change_required: false
---

# DEC-082 — Professional names in agenda

The maintainer requested continuation of the outstanding professional-name UX.
The existing staff options endpoint returns membership IDs only. Reading a staff
directory would require broader permissions and expose unnecessary identity data.

Extend the existing tenant-scoped VETERINARIAN options projection with nullable
`displayName`, selected from the linked UserProfile. Keep the existing scheduling
permission, membership filtering and stable ID values. Return no email, credential,
profile ID or unrelated profile attributes. This is CONFIDENTIAL staff identity,
staff-only, without new logging or retention. No new endpoint, permission,
migration, dependency, settings or PRD scope change.

Frontend selectors and list rows use the name; missing/unreadable names retain
an explicit shortened-ID fallback. No invented identity or clinical/Core import.
Accepted as the smallest compatible implementation of the user's request.

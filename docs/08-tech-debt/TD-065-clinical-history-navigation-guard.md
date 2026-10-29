---
id: TD-065
type: tech-debt
title: Clinical draft protection for browser history navigation
status: resolved
severity: medium
owner: engineering
related_epics: [EPIC-06]
related_stories: [UX-002]
created: 2026-10-28
updated: 2026-10-28
---

# TD-065 — Clinical draft protection for browser history navigation

## Problem

App Router navigation could unmount the editor before autosave completed.
Clicked links already offered cancellation and native unload had a warning, but
same-document Back/Forward or programmatic route changes lost the working copy.

## Resolution

Recover pending content instead of trapping browser history. On editor unmount,
one pending draft per patient is retained in the existing root QueryClient
memory cache for up to ten minutes. Its encounter ID, baseline version and
content travel together. On return, a fresh authorized list read gates recovery;
the encounter opens automatically with a notice, autosave paused and explicit
manual save.

No router internals, history-state patches, extra library, browser storage, URL
content, backend endpoint or migration. Clinical content remains CONFIDENTIAL
and staff-only. New login/logout documents reset the client. Denied/not-found
reads clear recovery; an expired entry is not restored. Successful save, close
or explicitly accepted discard removes recovery. An in-flight success after
unmount either clears the saved copy or rebases a newer retained edit.

Version drift blocks save/close until the existing explicit conflict reload. If
another actor closed the encounter, retained content is shown separately as
read-only and is never applied to the immutable record.

## Verification — 2026-10-28

- 44 clinical tests passed, including seven new recovery regressions: remount
  and selection, failed save, version drift, denied fresh reads, closed records,
  in-flight save/newer edits and patient/client isolation plus expiry/clear.
- 16 detail/overview tests passed. Web typecheck and targeted ESLint passed.
- Brief real browser check: created a synthetic draft on Michi; entered an
  intentionally oversized 10,800-character field so autosave could not succeed;
  Back reached the patient list, Forward reopened the draft with the entire
  field and validation state intact. Corrected it and explicitly saved.
- Screenshot: `td065-draft-recovered.png` in the session visualization
  directory.
- Production build and output verification passed (28 generated pages). Existing
  Next.js ESLint-plugin/project-reference warnings remain informational.

## Boundary

Recovery applies to client navigation in the same document/client and lasts ten
minutes while away. It does not promise durable offline storage or survival of
reload, tab close, browser crash, expiry, logout or a new login document. Native
unload warnings remain; browsers may suppress them without user interaction.
Saving before leaving is still the durable path. Back/Forward are not cancelled;
clicked-route cancellation and same-page anchors retain their existing behavior.

## References

- [Next.js App Router navigation](https://nextjs.org/docs/app/getting-started/linking-and-navigating)
- [Chrome Navigation API history-traversal constraints](https://developer.chrome.com/docs/web-platform/navigation-api)

---
id: TD-008
type: tech-debt
title: Defer live cross-tab appearance synchronization for Branding
status: accepted
severity: low
related_epics:
  - EPIC-03
related_stories:
  - BRAND-005
created: 2026-09-08
updated: 2026-09-08
---

# TD-008 — Defer live cross-tab appearance synchronization for Branding

## Context

EPIC-03 Phase B shipped client-local appearance persistence for the staff shell:

- `apps/web/src/lib/appearance.ts` reads and writes
  `localStorage["newsaas.appearance"]`.
- A parser-blocking bootstrap script applies a stored `dark` value before first
  paint.
- The shell toggle flips `<html>.dark` without a page reload.
- Valid local appearance always wins; tenant `defaultAppearance` is only the
  bootstrap fallback input.

This satisfies the Phase B requirement that staff users can choose and persist
light/dark mode. It does **not** synchronize that choice across multiple open
tabs or windows in real time.

## Debt

There is no cross-tab broadcast for appearance changes. Each tab keeps its own
in-memory copy of the current appearance and only re-reads `localStorage` on the
next full page load. The result is:

- Toggling appearance in Tab A does not update Tab B until Tab B reloads.
- A tenant admin saving a new `defaultAppearance` does not flip the appearance
  of staff tabs that are already open.
- The local preference still wins on reload, so the long-term state is
  consistent; the gap is purely live synchronization.

## Why It Is Safe to Defer

- The authoritative brand state (server overrides, product preset, and local
  preference precedence) is implemented and tested.
- No acceptance criterion for Phase B requires live cross-tab sync; the behavior
  is a UX polish item, not a functional gate.
- Each tab remains self-consistent and falls back to the documented precedence
  order on reload.
- There is no data-integrity, security, or tenant-isolation impact: the missing
  code is purely client-side UI state propagation.
- No production tenants or end users exist yet; staff can refresh to align tabs
  during the current phase.

## Risk

Low likelihood, low impact:

- A staff member with multiple tabs open may see inconsistent light/dark modes
  until they reload.
- A tenant branding change demonstrated in one tab will not appear live in
  another open tab, which could cause momentary confusion during configuration.
- Manual refresh is required to converge tabs, creating minor support friction.

No data, authorization, or security invariant is weakened.

## Affected Phase B Behavior

- The branding settings page Save persists overrides to the server but does not
  broadcast an appearance change to other open tabs.
- The staff shell appearance toggle is per-tab.
- Tenant `defaultAppearance` changes are only picked up by new page loads or
  reloads.

## Proposed Resolution

1. Choose a propagation mechanism: `BroadcastChannel` with `storage` event
   fallback for older browsers or cross-origin windows.
2. In `apps/web/src/lib/appearance.ts`:
   - Emit a normalized `"newsaas:appearance-changed"` message whenever the user
     toggles appearance or a settings Save changes the effective mode.
   - Subscribe to the same message and update `<html>.dark` without reload.
3. Preserve the documented precedence:
   - Explicit local user choice still wins over tenant `defaultAppearance`.
   - A per-tab override set by the user must not be silently overwritten by a
     different tab's toggle.
4. Add targeted tests using a stubbed `BroadcastChannel`/event harness to prove
   that one tab's change propagates to another and that tenant fallback updates
   propagate when no local override exists.
5. Update `docs/05-modules/Branding.md` to remove this deferral note once the
   behavior is implemented and verified.

## Trigger / Target

Re-entry when:

- staff UX requires synchronized appearance across tabs, or
- the first public/staff production onboarding is planned.

Resolve before broad staff onboarding where multiple-tab usage is expected.

## Verification After Resolution

- [ ] `BroadcastChannel` or `storage` event listener is wired in
      `apps/web/src/lib/appearance.ts`.
- [ ] Toggling appearance in one tab updates a second open tab without reload.
- [ ] Saving a branding settings change that alters the effective appearance
      propagates to other open tabs when no explicit local override exists.
- [ ] A tab with an explicit local user override does not flip when another tab
      changes its own local override.
- [ ] Unit/integration tests cover multi-tab propagation and precedence.
- [ ] `docs/05-modules/Branding.md` no longer lists cross-tab sync as deferred.
- [ ] This record is closed with a link to the resolving commit.

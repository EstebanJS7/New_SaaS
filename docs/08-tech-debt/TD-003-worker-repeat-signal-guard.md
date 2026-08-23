---
id: TD-003
type: tech-debt
title: Guard worker shutdown against mid-shutdown repeated signals
status: open
severity: medium
related_epics:
  - EPIC-00
related_stories:
  - FOUND-006
created: 2026-08-23
updated: 2026-08-23
---

# TD-003 — Guard worker shutdown against mid-shutdown repeated signals

## Context

The 2026-08-23 fresh-context adversarial review of the EPIC-00 closeout change
(`openspec/changes/epic-00-closeout-and-archive/`) found that
`installSignalShutdown()` in `apps/worker/src/main.ts` removes both signal
listeners on the first SIGTERM/SIGINT, before the in-flight shutdown completes.

On a real Node process, a second SIGTERM/SIGINT arriving while shutdown is still
running therefore restores the OS default disposition and hard-kills the process
with a non-zero exit. The foundation-runtime spec scenario "second signal when
already shutting down → exit status remains `0`" is satisfied only by the unit
test's stub timing, which cannot model OS default disposition.

This behavior is inherited verbatim from the pre-change implementation (no
regression) and double-signaling also serves as a legitimate operator escape
hatch to force-kill a stuck shutdown.

## Debt

The spec-intent guarantee — a second signal during an in-flight graceful
shutdown still exits `0` after cleanup finishes — is not enforced at runtime,
only modeled in tests under a state unreachable in production.

## Why It Is Safe to Defer

Shutdown currently completes quickly (Redis disconnect + Nest close), so the
vulnerable window is narrow. No double-run of shutdown can occur. The previous
behavior was identical, so no existing guarantee was weakened by the closeout
change.

## Risk

A slow or hung shutdown followed by an impatient operator sending a second
signal produces an abrupt kill instead of the spec's exit-`0` outcome.
Likelihood low, impact low-moderate (unclean logs, skipped post-shutdown hooks).

## Evidence Gate

Resolution requires a passing automated test that exercises a second signal
delivered **while** the shutdown promise is still pending, asserting final exit
status `0`, without spawning child processes.

## Proposed Resolution

1. Replace listener removal on first signal with a running-state guard flag;
   keep listeners installed until process exit.
2. Extend `apps/worker/src/main.test.ts` with the mid-flight repeat-signal
   scenario from the evidence gate.
3. Re-run `pnpm test --filter @newsaas/worker`.

## Trigger / Target

Before any production deployment of `apps/worker` outside local development.

## Verification After Resolution

- [ ] Mid-shutdown repeat-signal test passes with exit status `0`.
- [ ] No child-process spawns added to the test suite.
- [ ] This record closed with a link to the resolving commit.

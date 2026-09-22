---
id: TD-012
type: tech-debt
title: Two load-sensitive web tests fail intermittently and now block merges
status: resolved
severity: high
related_epics:
  - EPIC-06
  - EPIC-08
related_stories: []
created: 2026-09-21
updated: 2026-09-22
---

# TD-012 — Two load-sensitive web tests fail intermittently and now block merges

## Context

**Provenance.** This record rests on **human observation from the EPIC-08
delivery session (2026-09-15 to 2026-09-21)**, not on reconstructable repository
evidence. During that session, independent verification runs of the full web
suite failed three separate times on two different test files, each time passing
on an isolated rerun and on the next full run. The individual run dates and the
run URLs were **not captured**, so the sightings cannot be reconstructed from
the repository. What can be verified independently is the two test files, the
test names and the timeout configuration named below; the three intermittent
sightings themselves are the observed part.

| Test                                                                                                                                          | Failure observed                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.test.tsx` — `does not clobber a newer local edit when a save resolves in flight` | `Expected: "Second edit" / Received: "Soft tissue injury"` |
| `apps/web/src/app/(app)/app/patients/patient-form.test.tsx` — the species option assertion                                                    | `Unable to find role="option" and name "Dog"`              |

In every sighting the suite passed when the same file was run alone, and passed
on the immediately following full run. That pattern — failing only inside the
full parallel suite and only sometimes — is what makes this load-sensitive
rather than random.

The two tests are named deliberately here because the information was otherwise
recorded nowhere: the EPIC-08 documentation pass searched the repository and
found no trace of either flake, correctly refused to invent names, and
documented the adjacent verifiable risk instead. An intermittent failure that
nobody wrote down is invisible to whoever meets it next.

## Debt

The web suite's reliability is not a property of its assertions. Two of its
tests depend on timing under parallel load, so a green local run does not
predict a green CI run.

**The severity is now operational, not cosmetic.** `main` has branch protection
with `Database migrations` and `Lint, Typecheck, Test, Build` as required checks
(see TD-001, resolved 2026-09-21). A flaky web test therefore blocks a merge on
a PR whose change has nothing to do with it, and the only remedies are to rerun
or to bypass as an administrator.

## Resolution (2026-09-22)

Fixed in PR #57. A diagnosis ran first, because the obvious reading of the
failure was wrong.

**The named guarantee was never broken.** `clinical-workspace`'s test asserts
that a newer local edit is not clobbered by an in-flight save, and the component
upheld it: the save echo is adopted only when the submitted content still equals
the current content. The `"Soft tissue injury"` in the failure was the **seed**
value, arriving because the test's `list` double ignored what its `save` double
wrote, and because the assertion **raced the component's real 30 ms autosave
debounce**.

Three changes:

1. **The test is honest**: both doubles share one mutable server row, and the
   follow-up save is gated so the assertion cannot race the debounce. It still
   catches removal of the component's guard, proven by execution.
2. **A separate, latent, real race was fixed**: the sync effect adopted any
   refetched row when the draft was clean, so an out-of-order older-version
   refetch could revert the field. Monotonicity is now enforced wherever a
   refetched row is adopted — the render-time ref the next mutation reads, the
   sync effect, and the conflict reload — refusing to regress to a strictly
   older version while keeping the same-version case admissible, which is the
   case the original failure involved. Covered by a test that fails without it,
   proven by execution.
3. **Two configuration changes close the class**, because a load run surfaced a
   **third** test of the same kind (`portal-booking-requests`): the web suite
   runs its files sequentially so it stops oversubscribing its own CPUs, and
   RTL's wait window is set explicitly to 4 s — above a default calibrated for
   an idle machine, below Vitest's own 5 s timeout so a genuinely missing
   element still fails with RTL's diagnostic rather than the runner's opaque
   one.

**Evidence**: 10/10 full-suite runs under 16 CPU burners and 5 further runs at
20 burners, all green; independently reproduced with three runs under 12 burners
at load averages up to 15.7, all green.

**Residual, stated rather than implied**: both configuration changes _tolerate_
starvation instead of removing it — a worker starved beyond 4 s can still flake
— and sequential files cost wall-clock (~17 s to ~51 s unloaded). One coverage
gap remains: the `handleReload` monotonic guard is implemented and reasoned but
has no test of its own; the render-path guard, which is the one that prevents
the avoidable `409` on the next autosave, is covered by execution.

## Why It Is Safe to Defer

No product behaviour has been observed failing: both tests pass
deterministically when run alone, and the application paths they cover are also
exercised by other suites and by the API integration tests. Nothing about the
shipped portal or clinical behaviour is currently wrong because of this.

It is not safe to defer indefinitely: the first failure in CI will block a real
merge, and a flake that gets rerun into green can also hide a genuine race.

## Risk

- **Merge friction**: an unrelated red check blocks a PR, and the habit of
  rerunning to green weakens the gate that was just made blocking.
- **Masked defect**:
  `does not clobber a newer local edit when a save resolves in flight` is a
  _race_ test by name. If the race is real and only sometimes observable, the
  flake is a symptom rather than the disease.

## Proposed Resolution

1. **Reproduce deterministically before fixing.** Establish whether the failure
   is the test's timing or the save path's behaviour: the web Vitest
   configuration raises no hook or test timeout (unlike `apps/api`), so the
   suite's default is the runner's, and a heavy parallel boot can starve a
   promise chain.
2. **Make the test independent of load.** Prefer explicit control of the
   interleaving (fake timers, an awaited promise resolution order) over a longer
   timeout; a longer timeout hides the same class of problem.
3. **If the race is real, fix the save path**, not the test. The test name
   asserts a user-visible guarantee — a newer local edit must not be clobbered
   by an in-flight save — and that guarantee is worth having regardless of the
   suite.
4. **Consider a hook timeout** in the web Vitest config so a starved suite fails
   with a diagnostic instead of an unrelated assertion mismatch.

## Trigger / Target

At the first CI failure caused by either test, or before the next epic that
touches the patient clinical workspace or the patient form. Record the failing
run URL in this record when it happens.

## Verification After Resolution

- [x] Each named test is deterministic: run the full web suite repeatedly under
      parallel load (for example with concurrent CPU work) and observe no
      failure.
- [x] A real race existed and is fixed: monotonicity is enforced for every
      adoption of a refetched row, with a test that fails without the extension.
      _(The `handleReload` guard remains untested; recorded above.)_
- [x] The full web suite passes repeatedly under artificial CPU pressure, and
      the suite no longer oversubscribes its own CPUs. _(External starvation
      beyond the widened RTL window can still flake; recorded above.)_
- [x] This record closed with PR #57, which carries the diagnosis, the fixes and
      the load evidence.

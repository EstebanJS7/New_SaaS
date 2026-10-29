---
id: TD-064
type: tech-debt
title: Windows verification portability and local Node timezone data
status: open
severity: medium
owner: engineering
related_epics: [EPIC-00]
related_stories: [DEV-001]
created: 2026-10-24
updated: 2026-10-27
---

# TD-064 — Windows verification portability and local Node timezone data

## Observed during DEV-001

The working checkout uses Windows, Node v22.14.0 and CRLF files. Full lint,
typecheck and build passed, but the global verification cannot be called green:

- `packages/shared/src/demo-seed.test.ts` launches bare `pnpm` through
  `child_process.spawn`; all five CLI cases report `spawn pnpm ENOENT` on
  Windows.
- `packages/typescript-config/src/strict.test.ts` launches bare `npx` through
  `spawnSync`; the process does not start and its string assertion receives a
  number instead of compiler output. This does not prove the compiler accepted
  implicit any.
- Database tests: 541 passed, 9 failed. Failures include LF-only regexes over
  CRLF schema/SQL and `/patients/` comparisons against backslash paths. These
  are existing assertions, not changed migrations or failed PostgreSQL commands.
- Report tests expect Asuncion June 2026 midnight at 03:00Z; this runtime's
  `Intl.DateTimeFormat` resolves it with GMT-04:00. Reproduced with
  `new Intl.DateTimeFormat('en', {timeZone: 'America/Asuncion', timeZoneName: 'longOffset'}).format(new Date('2026-06-10T03:00:00Z'))`.
  This can affect runtime report boundaries, not only tests. Validate a
  supported Node runtime with updated timezone data before relying on those
  reports.
- `pnpm format-check` flags 1599 files across untouched source/documentation.
  Formatting checks limited to DEV-001 files pass. Do not reformat the entire
  vault silently as part of a startup fix.
- Full API suite outside the sandbox: 1720 passed, 48 failed, 266 live-PG cases
  skipped. Failures include report/scheduling timezone assertions and
  `env-validation.e2e-spec.ts`: its Windows import path yields
  `ERR_UNSUPPORTED_ESM_URL_SCHEME` (protocol `c:`) before validation. New demo
  guard tests pass 8/8.
- On this Node version, Vitest's shared `.ts` configuration also requires
  `NODE_OPTIONS=--experimental-strip-types`; without it startup reports
  `ERR_UNKNOWN_FILE_EXTENSION`. Record that environment when comparing results.

## Resolution

UX-003 verification on 2026-10-27 reproduced the offset problem with the global
Node 22.14.0 (`tz=2024b`, September 2026 reported GMT-04). A portable official
Node 22.23.4 archive was downloaded and SHA-256 checked against the official
manifest: `tz=2026e`, native ABI 127, September 2026 correctly GMT-03. API,
worker and frontend start under that runtime without reinstalling dependencies.
The bundled Node 24.22.1 also has current timezone data but cannot load this
checkout's existing `libxmljs2` binary (ABI 137 vs 127); that attempted runtime
was stopped and replaced by Node 22.23.4. No native binary or global Node
installation was changed. The remaining portability/global-verification items
below are still open.

UX-001 reproduced eight web agenda/portal failures in the same June-2026
Asuncion slot/date scenarios. The full web run had 1363 passing tests and 11
failures; three new shell-provider test integration failures were subsequently
fixed, with the final UI-focused run passing 119/119. The remaining date
expectations were preserved. Web build, lint/typecheck and UI's 36 tests pass,
but UX-001 remains `review` while this environment gate is unresolved.

Choose and validate a supported Node runtime with current timezone data, make
CLI tests use explicit executable paths, normalize platform-independent text and
paths in static tests, and reconcile the formatting policy/checkout in a
dedicated change. Keep all business and isolation assertions intact.

No business rule, migration or test expectation was weakened in DEV-001 to hide
these failures. DEV-001 must remain `review` until required gates pass.

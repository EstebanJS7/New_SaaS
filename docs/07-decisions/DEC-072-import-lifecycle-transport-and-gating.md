---
id: DEC-072
type: decision
title: Always asynchronous, upload once, and ungated by feature code
status: accepted
date: 2026-10-19
related_epics:
  - "EPIC-19"
related_decisions:
  - "DEC-058"
  - "DEC-062"
  - "DEC-066"
related_stories:
  - "IMP-001"
  - "IMP-005"
prd_change_required: false
---

# DEC-072 — The import lifecycle

## Context

Three transport questions decide the shape of everything else in this epic, and
all three have an established precedent in this repository.

```
PRD §32                 "Large imports run asynchronously."
existing                apps/worker runs real BullMQ consumers
                        packages/storage exposes StoragePort (put/get/delete/
                        signedUrl) behind a @Global() StorageModule, with S3 and
                        in-memory drivers
existing precedent      DEC-058 and DEC-062 both refused a thirteenth feature code
                        DEC-066 chose synchronous for the EXPORT, deliberately
```

The export and the import differ for a reason worth stating: an export's input
is a bounded query, while an import's input is a file of unknown size that
writes thousands of records. Being asymmetric here is correct, not inconsistent.

## Questions

1. Is every import asynchronous, or only "large" ones?
2. Does the preview persist the uploaded file, or is it re-uploaded at commit?
3. Is the feature gated by a feature code?

## Options and decision

### 1 — Always asynchronous (accepted)

Every upload goes to the queue. No threshold.

A threshold is a number that has to be justified, measured, and then explained
to an operator who notices that one file was instant and the next was not. It
also means two paths producing the same summary, which is two places for the
summary to drift. An import that finishes fast simply finishes fast inside the
same state machine.

### 2 — Upload once; preview and commit read the same artefact (accepted)

The file is stored under an opaque key when it is uploaded, and both the preview
and the commit read it from there.

With a re-upload, nothing guarantees the commit sees the file the preview
validated: the operator (or a script) can upload a different file between the
two, and the commit would then apply a file whose preview was never shown. That
makes the preview a promise the commit can break.

The cost is real and accepted: a stored artefact containing personal data needs
a stated classification, a TTL and a cleanup, and it is the one place in this
epic where data sits outside PostgreSQL.

### 3 — No feature-code gate (accepted)

`imports` is not among PRD §10's twelve codes, and a thirteenth has been refused
twice ([[DEC-058]] for WhatsApp, [[DEC-062]] for reports). The `imports.*`
permission family is the guard: importing is a staff action over data the tenant
already owns.

## Consequences

### Product

An upload always returns an import id immediately; the surface polls. A preview
and its commit are bound to one artefact, so "commit what you saw" is a
structural guarantee rather than a convention.

### Architecture

One state machine, one summary shape, one queue. The storage artefact is
INTERNAL tenant data — it is a customer list — and is never served to a browser
through a public URL; the surface never downloads it back.

### Database/API

`imports.run` and `imports.read` seeded and mapped to the owning roles for run
and to the read-wide set for read. No feature-code migration.

### Delivery

[[IMP-001]] owns the aggregate, the artefact and the permissions. [[IMP-005]]
owns the polling surface. [[TD-058]] records the artefact's retention and
cleanup question if it is not closed inside the epic.

## PRD Update

No PRD change. PRD §32's "asynchronously" is satisfied by the first decision;
the other two are implementation contracts recorded here.

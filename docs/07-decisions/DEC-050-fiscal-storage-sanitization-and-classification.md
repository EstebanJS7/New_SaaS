---
id: DEC-050
type: decision
title: Fiscal storage references, sanitization and data classification
status: accepted
date: 2026-10-02
related_epics:
  - "EPIC-15"
related_stories:
  - "FISC-002"
  - "FISC-003"
prd_change_required: false
---

# DEC-050 — Fiscal storage references, sanitization and data classification

## Context

PRD §22 requires XML/KuDE storage refs and sanitized request/response snapshots.
PRD §41 classifies fiscal/secret material and forbids logging sensitive payloads
by default. `docs/06-fiscal/SIFEN.md` says tenant credentials are references to
a secure secret store and never plaintext.

## Question

What fiscal data is stored inline, what is stored as a private storage
reference, and how is it classified/sanitized?

## Options

### Option A — Store metadata and sanitized snapshots inline; private artifacts by reference (recommended)

Persist provider metadata, state, CDC/external IDs, sanitized request/response
summaries and error codes inline. Store XML/KuDE/full provider artifacts through
private storage references. Secret/certificate material is never persisted in
FiscalDocument or tenant settings; only opaque secret references are allowed.

Benefits: satisfies PRD §22 while limiting sensitive data exposure.

Costs: fake-provider tests need storage-reference stubs before real artifacts
exist.

### Option B — Store full XML/KuDE and raw provider payloads inline

Rejected: increases exposure and violates sanitization rules.

### Option C — Store only provider state, no snapshots/refs

Rejected: misses PRD §22 auditability requirements.

## Recommendation

Option A.

## Impact

### Product

Operators get useful fiscal status and error information without exposing secret
or raw provider payloads.

### Architecture

Fiscal uses controlled storage refs and closed schemas.

### Database/API

FISC-002 adds fields and classification comments; FISC-003 tests sanitization.

### Delivery

No secret fields are accepted in tenant settings.

## Decision

Accepted: FiscalDocument will persist provider metadata, state, CDC/external
IDs, sanitized request/response summaries, and error codes inline. XML, KuDE,
and full provider artifacts will be held through private storage references.
Secret/certificate material will not be persisted in FiscalDocument or tenant
settings; only opaque secret references are allowed.

## PRD Update

No PRD change is required.

---
type: architecture
status: active
updated: 2026-08-13
---

# Data Classification and Retention

## Purpose

Create a consistent baseline for handling personal, clinical, financial, fiscal
and secret information.

This document is an engineering policy, not a substitute for
jurisdiction-specific legal review.

## Classification

### PUBLIC

Information safe to expose intentionally.

Examples:

- public product name;
- approved tenant logo shown to its customers;
- public branch contact details when explicitly configured.

### INTERNAL

Operational information not intended for public disclosure but with limited
sensitivity.

Examples:

- feature flags;
- non-secret tenant preferences;
- internal UI configuration;
- catalog configuration that is not confidential.

### CONFIDENTIAL

Personal/business information requiring controlled access.

Examples:

- customer name/contact/document;
- patient/tutor relationship;
- appointment details;
- clinical history;
- invoices/payment references;
- supplier information;
- staff personal details.

### RESTRICTED

Highest sensitivity.

Examples:

- authentication/service credentials;
- private keys/certificates/PINs;
- fiscal provider secrets;
- password-reset/security tokens;
- privileged support-access records;
- security incident evidence.

Secrets should normally live in a secret manager, not application tables.

## Logging

Never log by default:

- full clinical free text;
- document numbers when not necessary;
- full request bodies from sensitive endpoints;
- auth tokens;
- secrets;
- private keys/certificates;
- payment/fiscal credentials.

Use stable IDs and sanitized error metadata.

## API

Use response DTO allowlists.

Never serialize Prisma models blindly.

Portal responses expose only explicitly approved fields.

## Files

Clinical/fiscal files are private.

Use signed URLs with short expiration.

Object keys must not expose confidential data unnecessarily.

## Development and demo

Never copy real production personal/clinical/fiscal data into development/demo
environments.

Demo seed must contain synthetic data only.

## Retention baseline for MVP

Do not implement automatic destructive deletion for:

```text
clinical records
confirmed sales
cash ledger
stock ledger
invoices
fiscal documents
audit logs
```

until an explicit retention/legal policy is approved.

Soft deletion/deactivation may be used for master records where defined by the
PRD.

## Data subject / deletion requests

If a future requirement demands deletion/anonymization:

1. classify legal/business records that must remain;
2. anonymize where allowed rather than destroying referential/audit integrity;
3. record the operation;
4. require explicit permission;
5. create an ADR/Decision if the policy affects multiple domains.

## Backups

Retention/deletion policies must account for backups and recovery windows.

A record deleted from the active database may persist temporarily inside backups
according to the approved backup-retention policy.

## New-field checklist

When adding a sensitive field, answer:

- classification?
- who can read it?
- who can write it?
- portal visibility?
- included in audit?
- safe to log?
- included in exports?
- backup implications?
- retention/deletion behavior?

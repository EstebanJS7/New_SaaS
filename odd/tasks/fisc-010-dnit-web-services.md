---
feature: fisc-010-dnit-web-services
epic: EPIC-16
story: FISC-010
status: in-progress
created: 2026-10-08
branch: feat/epic-16-fisc-010-dnit-web-services
---

# FISC-010 — DNIT web services

Feature record for **T6** of [[EPIC-16]]. Story:
`docs/02-stories/FISC-010-dnit-web-services.md`.

## Goal

Deliver the SIFEN web-service layer: the SOAP 1.2 Document/Literal transport
over TLS 1.2 with mutual authentication using the tenant's certificate, the
message shapes of the services DNIT publishes, and the asynchronous outcome
model SIFEN produces — plus the two ADRs that gate it ([[ADR-007]],
[[ADR-008]]).

It does **not** deliver `SifenDirectFiscalProvider`, provider selection, the
worker's signing stage, or the real credential wiring. Those are [[FISC-012]],
per the boundary decided with the maintainer on 2026-10-08.

## Authorization

Authorized by the maintainer on 2026-10-08 as **WU-A, docs-only**: ADR-007,
ADR-008, the Story, `SIFEN-BASELINE.md` §23 and the tracker. No source write in
WU-A.

Base: **`68b3c74`** — `main` (`ffd08a1`) plus `docs/epic-16-bookkeeping`
(`4907e65`) and `feat/epic-16-fisc-011-completion` (`68b3c74`), which are not
yet merged. The maintainer chose this base on 2026-10-08 rather than `ffd08a1`,
because both pending branches touch the two bookkeeping files WU-A edits, and
`4907e65` is the commit that corrected ADR-007's position in the epic.

## Decisions taken by the maintainer (2026-10-08)

1. **The credential boundary is FISC-010's to define, not to wire.** FISC-010
   defines the per-call credential port and proves it with a double; FISC-012
   wires the worker (the `SecretStore` module, its env keys and the read path)
   together with the signing stage. Reason: the worker has no `SecretStore`
   today, and the read-the-private-key path does not exist anywhere.
2. **A parser without a DOM.** Prefer `fast-xml-parser` over declaring
   `@xmldom/xmldom`, whose `/// <reference lib="dom" />` already broke an
   unrelated typecheck in [[FISC-009]] (recorded in [[ADR-006]]).

## Work units

- [ ] **WU-A — the decisions, the Story and the baseline retrieval record.**
      [[ADR-007]] (the port's asynchronous outcome capability), [[ADR-008]] (the
      transport, the credential port and the parser), the FISC-010 Story,
      `SIFEN-BASELINE.md` §23 (the service-schema retrieval record and the WSDL
      block), and the tracker. Docs-only, one commit.
- [ ] **WU-B — the message layer (pure).** The request and response shapes of
      the services, as types plus serializers and parsers, with the result-code
      tables. No I/O: fixtures come from the official schemas and from the
      Guide's own examples.
- [ ] **WU-C — the transport.** The SOAP 1.2 Document/Literal client over
      `node:https` with a per-call mutual-TLS agent built from the tenant's
      certificate, the `FiscalCredentialPort`, and the guardrails ADR-008
      decides (response size cap, DOCTYPE refusal, no value coercion, no
      cross-tenant socket reuse). Proven against a local TLS double that
      verifies the client certificate.
- [ ] **WU-D — the port's asynchronous capability and the schema.** The outcome
      vocabulary, the `query` capability, the migration that gives the
      asynchronous reference a column and `submitted_at` its writer, and the
      live-PostgreSQL proof of the new edges.
- [ ] **WU-E — the service facade.** One typed method per published service,
      each bound to its endpoint from baseline §8, composing WU-B and WU-C, and
      the mapping from SIFEN's result codes to the port's outcomes.

## Out of scope for this feature record

- `SifenDirectFiscalProvider`, `FISCAL_PROVIDER` selection and the worker's
  signing stage — [[FISC-012]].
- Persisting the signed DE and the submission path's logging — [[FISC-012]],
  which owns the stage that has the signed document. The acceptance criterion
  [[FISC-009]] pointed at FISC-010 is re-pointed there, with the reason recorded
  in the Story.
- Contingency and homologation evidence — [[FISC-013]].

## Evidence

```text
branch   feat/epic-16-fisc-010-dnit-web-services   from 68b3c74
WU-A     pending
```

## Review record

Pending WU-A.

## Notes

- **The v150 async batch schemas are not published.**
  `WS_SiRecepLoteDE_v150.xsd`, `WS_SiConsLote_v150.xsd` and the Manual's own
  `SiRecepLoteDE_v150.xsd` family return **HTTP 404**; the batch shapes are
  published only as **v141** files. §23 records this and the Story scopes around
  it.
- The WSDL is unreachable on **both** hosts (302 → `/vdesk/hangup.php3`), and a
  bogus path and the host root return the same redirect, so the probe says
  nothing about the paths themselves.

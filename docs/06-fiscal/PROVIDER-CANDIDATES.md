---
type: fiscal-reference
status: planning
country: PY
updated: 2026-10-03
---

# Fiscal provider candidates

Research for [[EPIC-16]], which needs **one concrete third-party provider** to
implement `ThirdPartyFiscalProvider` against (`D2` of the epic tracker). This
document is evidence, not a decision: the choice belongs to the maintainer.

Method: web search for the Paraguayan e-invoicing market, then direct retrieval
of each candidate's own API documentation, then direct retrieval of the machine
readable contract where one is published. Every fact below is quoted from a
source retrieved on **2026-10-03**; nothing is inferred from a search snippet,
and every gap is marked **not stated** rather than guessed.

## Why this is urgent

The regulatory driver is real and near-term. DNIT's _Resolución General N.°
41/25_ (Asunción, **24 December 2025**) establishes:

> «Establecer que el contribuyente que suscriba contratos en carácter de
> proveedor, contratista o consultor, a partir del **2 de enero de 2026** en
> adelante, con los sujetos mencionados en el artículo 2° de la Ley n.°
> 7021/2022 y, siempre que aún no se encuentre adherido al Sistema Integrado de
> Facturación Electrónica Nacional (SIFEN) estará obligado a su adhesión a
> partir del día siguiente de la suscripción del contrato respectivo.»

Article 3 adds that the habilitation process and the emission of electronic tax
documents must follow _Decreto n.° 872/2023_ and **the SIFEN technical
documentation**. That is the same rule PRD §23 encodes for us: the protocol
comes from the official baseline, never from memory.

## The candidates

Three providers publish real API documentation. They are not the whole market —
several others (ImagineSOFT, Neosystem/Ekuatia, SmartDoc, Element Tech, SISFE)
appeared in search but either publish no retrievable API reference or their page
could not be extracted, so they are **not evaluated here**.

### Fisnodo — recommended

Sources: <https://www.fisnodo.sun.com.py/docs/api> and the published contract
<https://api.fisnodo.sun.com.py/docs/openapi.json>.

| Aspect             | Finding                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract           | **OpenAPI 3.1.0**, `info.title: "Fisnodo API"`, `info.version: "0.1.0"` — machine readable and directly testable                                                                   |
| Servers            | `https://api.fisnodo.sun.com.py` ("Produccion") and `http://localhost:6020` ("Desarrollo local")                                                                                   |
| Auth               | `securitySchemes.bearerAuth`: `type: http`, `scheme: bearer` — "API key como Authorization: Bearer <key>"                                                                          |
| Tenant             | `X-Tenant-Id` header, required, uuid: "Tenant activo. Debe coincidir con la API key o sesion."                                                                                     |
| Idempotency        | `Idempotency-Key` header **required** on `POST /v1/documents`: "Clave obligatoria… Reenvios identicos por 24h devuelven el documento original."                                    |
| Issue              | `POST /v1/documents` — "Ingiere un documento canonico… Idempotente por 24h"                                                                                                        |
| Pre-validate       | `POST /v1/documents/validate` — "Dry-run de validacion canonica y prevalidacion SIFEN"                                                                                             |
| Status             | `GET /v1/documents/{id}`; `GET /v1/documents/{id}/timeline` — "Timeline inmutable del documento"                                                                                   |
| Artifacts          | `GET /v1/documents/{id}/artifacts` — "Artefactos con URLs presignadas de **15 minutos**"; download via `expires` + `signature` query params                                        |
| Manual re-drive    | `POST /v1/documents/{id}/retry` — "Reenvia manualmente un documento en retrying" → `202 Job encolado`, `409` otherwise                                                             |
| Cancel / inutilize | `POST /v1/documents/{id}/inutilize` — "Inutiliza un documento aceptado con motivo obligatorio"                                                                                     |
| Sandbox            | `POST /v1/sandbox/preview`, `security: []` — "Soporta modos demo_simulated, sifen_dev y autoimpresor_test… no persiste documentos, no reserva numeracion y no remite a DNIT/SIFEN" |
| API keys           | `/v1/api-keys` — "Crea API key y devuelve el valor plano **una sola vez**"; `/v1/api-keys/current` describes the authenticated key                                                 |
| Webhooks           | `/v1/webhooks` list/create/deactivate/replay/deliveries, with `X-Webhook-Signature: t=…,v1=<hmac-sha256>` and a documented verification example                                    |
| Config             | `/v1/companies`, `/v1/emission-channels`, `/v1/certificates`                                                                                                                       |
| Status cycle       | `received`, `validated`, `queued`, `signing`, `submitting`, `accepted`, `rejected`, `retrying`, `failed_terminal`                                                                  |
| Error classes      | `validation_error`, `configuration_error`, `certificate_error`, `upstream_error`                                                                                                   |
| Certificate        | The docs state explicitly: "La API key de Fisnodo **no es** el certificado digital, el token físico ni la credencial SIFEN/e-Kuatia del contribuyente."                            |
| Pricing / SLA      | **not stated** on the retrieved pages                                                                                                                                              |

### FactPy

Source: <https://factpy.com/desarrolladores>.

| Aspect        | Finding                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Style         | `POST https://api.factpy.com/facturacion-api/data.php`, `multipart/form-data` with `recordID` + `dataJson`                       |
| Auth          | A `recordID` credential sent **inside the form body**, described as "Credencial recordID" — not a bearer header                  |
| Response      | `{ "status", "recordID", "cdc", "xmlLink", "kude" }` — CDC, XML and KuDe returned directly                                       |
| Events        | `POST /facturacion-api/evento.php` — "inutilización, cancelación y nominación"                                                   |
| Status        | `POST /facturacion-api/estadoDE.php` by `receiptid`                                                                              |
| Sandbox       | "Ambiente sandbox para testear tu integración sin emitir documentos reales. **Conectado al ambiente de homologación de SIFEN.**" |
| Webhooks      | "Configurá una URL de callback para recibir notificaciones en tiempo real cuando el estado de un documento cambia en SIFEN."     |
| Docs          | `docs.factpy.com` — a reference site; **no OpenAPI document was found**                                                          |
| Support       | WhatsApp + email, "Acompañamiento en homologación"                                                                               |
| Pricing / SLA | **not stated** (a plans page exists; no figures retrieved)                                                                       |

### GOEKUA

Source: <https://goekua.com.py/api-docs.html>.

| Aspect        | Finding                                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base          | "Todos los endpoints están disponibles en `https://api.goekua.com.py`"                                                                                                                   |
| Auth          | "**API Keys**… incluyendo su clave en el encabezado `x-api-key`"                                                                                                                         |
| Coverage      | Rich: invoices, credit/debit notes, self-invoices, remission notes, advance invoices, RUC lookup, receipt payments, cancellation, inutilization, forwarding, nomination (SIFEN event 15) |
| Status values | `APPROVED, REJECTED, IN_REVIEW, INUTILIZATION, FORWARDING, FORWARDED, CANCELED`                                                                                                          |
| Sandbox       | **not stated** — no sandbox or homologation environment is mentioned                                                                                                                     |
| Webhooks      | **not stated**                                                                                                                                                                           |
| Certificate   | `POST /api/certificate/upload` takes the `.p12`/`.pfx` file **and its password** — the tenant's signing certificate material is sent to the provider                                     |
| Docs style    | Field-level mapping to the DNIT _manual técnico_ by page number (e.g. "Campo iTipTra - Página 66 del manual técnico")                                                                    |
| Pricing       | "Conocé el Plan API y solicitá tu cotización" — quote based                                                                                                                              |

## Recommendation: Fisnodo

The deciding factor is not features in the abstract but **how little of our
boundary would have to be bent**:

1. **It publishes a machine-readable OpenAPI 3.1.0 contract.** PRD §23's rule is
   that protocol details must come from a validated source, not memory. An
   OpenAPI document is exactly such a source, and it can be pinned, versioned
   and used to generate the request/response types the adapter needs. GOEKUA and
   FactPy publish prose only.
2. **Its error classes map onto our taxonomy with no translation table.**
   `validation_error` → `REJECTED`, `configuration_error` →
   `CONFIGURATION_ERROR`, `certificate_error` → `CONFIGURATION_ERROR`,
   `upstream_error` → `TRANSIENT_FAILURE`. Our `isRetryableOutcome` keeps
   exactly one meaning.
3. **`Idempotency-Key` is mandatory**, and a repeated key returns the original
   document for 24 h. That is the same idempotency model [[DEC-049]] already
   chose, so our deterministic job identity has a real counterpart instead of a
   workaround.
4. **Artifacts are served through 15-minute presigned URLs**, which is precisely
   the "private files use signed URLs" rule in `ENGINEERING-RULES.md`. We would
   store the provider's artifact reference, not a public link.
5. **The API key is explicitly not the signing certificate.** The certificate
   stays with the provider, so the only secret we hold per tenant is an API key
   — which is exactly what a `credentialRef` into a `SecretStore` is for (`D1`).
6. **`POST /v1/documents/{id}/retry` exists**, so [[TD-029]]'s operator re-drive
   can be built against a real provider primitive rather than a local invention.
7. **The sandbox needs no credentials** (`security: []` on
   `/v1/sandbox/preview`) and covers `demo_simulated`, `sifen_dev` and
   `autoimpresor_test`, which makes a deterministic integration test possible.

FactPy is a credible second: it has a real sandbox connected to SIFEN's
homologation environment and webhooks, and it returns CDC/XML/KuDe directly. It
loses on the credential being a form field rather than an auth header, the
`data.php` endpoint style, and the absence of a published contract.

GOEKUA is the weakest fit for **our** boundary despite the broadest endpoint
coverage: no sandbox, no webhooks, and it requires uploading the tenant's
signing certificate **and its password**, which would put real secret material
on the provider's side of our boundary.

## What I could not verify

Recorded so the decision is not made on an overstatement:

- **Pricing and SLA** for all three: none was retrieved.
- **Commercial availability**: whether Fisnodo's production endpoint is open to
  any taxpayer or requires a signed contract was **not stated**.
- **Provider-side SIFEN certification**: the _taxpayer_ is the one DNIT
  habilitates as an electronic issuer; whether any of these vendors holds a
  specific DNIT provider certification was **not stated** by any retrieved
  source.
- **Contract stability**: Fisnodo's OpenAPI is `version: "0.1.0"`, an early
  version. The adapter must pin the contract version it was written against and
  fail loudly on drift.
- **Market completeness**: only providers with retrievable API documentation
  were evaluated. A provider with better terms but no public docs would not
  appear here.
- **The DNIT Manual Técnico itself** (`Versión 150`) was located but **not
  retrieved**: that is the subject of FISC-011 and belongs to the SIFEN Direct
  research, not to this comparison.

## Sources

Retrieved 2026-10-03:

1. DNIT, _Resolución General DNIT N.° 41/25_, Asunción, 24 December 2025 —
   <https://ekuatia.set.gov.py/web/portal-institucional/w/resoluci%C3%B3n-general-dnit-n.%C2%B0-41/25>
2. Fisnodo, _Documentación API_ — <https://www.fisnodo.sun.com.py/docs/api>
3. Fisnodo, _OpenAPI 3.1.0, "Fisnodo API" v0.1.0_ —
   <https://api.fisnodo.sun.com.py/docs/openapi.json>
4. FactPy, _Desarrolladores — FactPy API de Facturación Electrónica SIFEN_ —
   <https://factpy.com/desarrolladores>
5. GOEKUA, _API de facturación electrónica en Paraguay_ —
   <https://goekua.com.py/api-docs.html>

Located but not retrieved: DNIT, _Manual Técnico Versión 150_ —
<https://www.dnit.gov.py/documents/20123/420592/Manual+T%C3%A9cnico+Versi%C3%B3n+150.pdf>

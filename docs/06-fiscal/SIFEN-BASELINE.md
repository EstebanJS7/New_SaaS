---
type: fiscal-reference
status: active
country: PY
manual_version: "150"
manual_date: 2019-09-10
verified: 2026-10-03
updated: 2026-10-03
---

# SIFEN baseline (revalidated)

The official DNIT baseline for SIFEN v150, revalidated on **2026-10-03** as
[[FISC-006]] requires and PRD §23 mandates. This document is the protocol source
of record for [[EPIC-16]]: every constant the epic encodes must trace to a
finding here, and a constant that is not here must not be written.

`docs/06-fiscal/SIFEN.md` remains the architectural rule (SIFEN sits behind the
provider boundary, in the `Fake → ThirdParty → SifenDirect` sequence). This
document is the technical baseline that rule points at.

## Evidence grading

| Grade   | Meaning                                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[R]** | **Directly retrieved** — the artifact itself was fetched and read. Binding for the epic.                                                                             |
| **[S]** | **Official-source synthesis** — from official DNIT pages whose own text could not be extracted. Must be confirmed against the artifact before a Story pins anything. |
| **[O]** | **Open** — not answered by any retrieved source. Recorded as a question, never filled with an assumption.                                                            |

**Retrieval note.** The Manual Técnico and the Guía de Pruebas are served as
PDFs behind a viewer; a first fetch returned only a title, which briefly looked
like a retrieval failure. Both PDFs **were** extracted in full (217 pages /
178,216 characters and 12 pages / 22,972 characters respectively). Everything
graded [R] below comes from those extractions, from the official XSD directory,
or from the XSDs themselves.

## 1. Official sources

**[R]** DNIT publishes the technical documentation at
<https://www.dnit.gov.py/web/e-kuatia/documentacion-tecnica>, whose own text
lists:

```text
Manual Técnico Versión 150
Notas técnicas (ajustes al Manual Técnico)
Recomendaciones - servicio asíncrono
Listado Checksum MD5 de las versiones del Manual Técnico
Estructura xml_DE
Estructura_DE xsd
```

and the tables at
<https://ekuatia.set.gov.py/web/e-kuatia/tablas-y-codificaciones>, which names a
**"CÓDIGO DE REFERENCIA GEOGRAFICA_NOVIEMBRE_2025"** XLSX (the geographic table
was refreshed in November 2025), its MD5 checksum document, and a **Prevalidador
SIFEN**.

## 2. Manual Técnico

**[R]** Current version **150**, dated **10/09/2019**, 217 pages, retrieved in
full. Its own changelog records that v150 reorganised the chapter numbering,
updated a SIFEN diagram, added the regulatory resolution, and **introduced
deadlines for events in the SIFEN deadlines table**.

Chapter map, which is the navigation key for every later Story:

```text
5  los DTE previstos            11 gestión de eventos
6  modelo operativo             12 validaciones
7  formato: XML, comunicación,  13 representación gráfica (KuDE)
   certificado y firma digital   14 operación de contingencia
8  aspectos tecnológicos de     15 conservación de los DTE
   los WS                        16 codificaciones
9  descripción de los WS         17 glosario
10 formato de los DE
```

## 3. XSD inventory

**[R]** The official schema directory is <https://ekuatia.set.gov.py/sifen/xsd/>
and its index was retrieved in full.

**Documento Electrónico, v150:** `DE_v150.xsd`, `DE_Types_v150.xsd`,
`DE_Ekuatiai_v150.xsd`. **All three DE schemas were retrieved on 2026-10-04,
including `DE_Types_v150.xsd`; §21 records their field-level facts.**

**Recepción, v150:** `siRecepDE_v150.xsd`, `siRecepDE_Ekuatiai_v150.xsd`,
`siRecepRDE_v150.xsd`, `siRecepRDE_Ekuatiai_v150.xsd`, `WS_SiRecepDE_v150.xsd`.

**Eventos, v150:** `Evento_v150.xsd`, `Evento_Types_v150.xsd`,
`siRecepEvento_v150.xsd`, `siRecepEventoEmisor_v150.xsd`,
`siRecepEventoReceptor_v150.xsd`, `siRecepEventoSet_v150.xsd`,
`WS_SiRecepEvento_v150.xsd`.

**Consulta:** `siConsultaDTE.xsd`, **`siConsultaDTEAsync.xsd`**,
`WS_SiConsDTE.xsd`, **`WS_SiConsDTEAsync.xsd`**, `siConsultaArchivoRuc.xsd`,
`WS_ConsultaArchivoRuc.xsd`.

**Protocolo de proceso:** `protProcesDE_v150.xsd`.

**Tablas:** `Paises_v100.xsd`, `Monedas_v100.xsd`, `Monedas_v150.xsd`,
`Departamentos_v141.xsd`, `Unidades_Medida_v141.xsd`.

**Firma:** `xmldsig-core-schema.xsd`.

**Legado v141** (still published, not the target): `FE_v141.xsd`,
`FE_Types_v141.xsd`, `Evento_v141.xsd`, `Evento_Types_v141.xsd`,
`EventoCanc_v141.xsd`, `EventoInut_v141.xsd`, `RecEventoCanc_v141.xsd`,
`RecEventoInut_v141.xsd`, `SIFEN_Types_v141.xsd`, `siRecepDE_v141.xsd`,
`WS_SiRecepDE_v141.xsd`, `WS_SiRecepLoteDE_v141.xsd`, `siRecepEvento_v141.xsd`,
`WS_SiRecepEvento_v141.xsd`, `WS_SiConsDE_v141.xsd`, `WS_SiConsLote_v141.xsd`,
`WS_SiConsRUC_v141.xsd`, `protProcesDE_v141.xsd`, `protProcesEventos_v141.xsd`.

Note the version mix: the label "v150" does **not** imply every companion table
is v150 (geography is v141, currencies exist at v100 and v150, countries at
v100). FISC-008 must pin each table's version explicitly.

## 4. DTE XML structure

**[R]** From `DE_v150.xsd` (66,117 characters, retrieved in full) and the
manual's §7.2.

```text
targetNamespace   = "http://ekuatia.set.gov.py/sifen/xsd"
elementFormDefault = "qualified"
ds                = "http://www.w3.org/2000/09/xmldsig#"
```

The root type is `rDE`, and its sequence is fixed:

```xml
<rDE xmlns="http://ekuatia.set.gov.py/sifen/xsd">
  <dVerFor>150</dVerFor>        <!-- xs:integer, pattern [1][5][0] -->
  <DE Id="<CDC>">               <!-- Id REQUIRED, type tCDC -->
    <dSisFact>1</dSisFact>      <!-- maxInclusive 1 -->
    <gOpeDE/>                   <!-- iTipEmi, dDesTipEmi, dCodSeg, dInfoEmi?, dInfoFisc? -->
    <gTimb/>                    <!-- timbrado data, carries the document type -->
    <gDatGralOpe/>
    <gDtipDE/>                  <!-- document-type-specific fields -->
    <gTotSub/>                  <!-- optional -->
    <gCamGen/>                  <!-- optional -->
    <gCamDEAsoc/>               <!-- optional, maxOccurs 99 -->
  </DE>
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/>   <!-- REQUIRED -->
  <gCamFuFD/>                   <!-- outside the signed DE -->
</rDE>
```

Binding consequences:

- **`dVerFor` is pinned by the schema** to the three digits `150`; a version
  drift is a validation failure, not a silent change.
- **The CDC is the `Id` attribute of `<DE>` and is required.** The schema
  comment records the change: "CDC pasa a ser atributo del rDE".
- **The signature's position is fixed**: after `<DE>`, before `<gCamFuFD>`. The
  signed subtree is the DE; the QR/CDC block in `gCamFuFD` sits outside it.
- **`gCamDEAsoc` admits up to 99 associated documents**, which is how a credit
  or debit note references its original.
- `dSisFact` is "1-Sistema de facturación del contribuyente", constrained to at
  most 1 — effectively a constant for our case.
- **Namespace rules (manual §7.2):** no namespaces other than the defined ones,
  **no namespace prefixes**, and every XML document declares its own namespace
  on its root element. The signature declares
  `xmlns="http://www.w3.org/2000/09/xmldsig#"` **on the `<Signature>` tag
  itself**.

The manual's field-group index (chapter 10) names the groups the DE is built
from, including **`I` — Información de la Firma Digital del DTE** and **`J` —
Campos fuera de la Firma Digital**, which is the `gCamFuFD` block.

**[O]** `DE_Types_v150.xsd` was not retrieved, so per-field lengths, patterns
and enumerations are not yet pinned.

## 5. Signature profile

**[R]** Complete, from the manual's §7.6, §7.7 and Schema XML 1. This is the
input [[EPIC-16]]'s ADR candidate 2 needs, and it is now sufficient to choose a
signing approach.

```text
Standard        XML Digital Signature, Enveloped (W3C xmldsig-core)
CanonicalizationMethod  http://www.w3.org/TR/2001/REC-xml-c14n-20010315
SignatureMethod         http://www.w3.org/2001/04/xmldsig-more#rsa-sha256
Reference URI           #<CDC>       (the CDC preceded by "#")
Transforms (exactly 2, in order)
                        http://www.w3.org/2000/09/xmldsig#enveloped-signature
                        http://www.w3.org/2001/10/xml-exc-c14n#
DigestMethod            http://www.w3.org/2001/04/xmlenc#sha256
KeyInfo                 X509Data > X509Certificate  (X.509 v3)
Key size                RSA 2048 (software); RSA 2048 or 4096 (hardware)
Digest                  SHA-2 / SHA-256
Encoding                Base64
```

- The signed subtree is the group **`A001`**, identified by the `Id` attribute
  whose value is the CDC, and that same CDC preceded by `#` is the `Reference`
  `URI`.
- **Forbidden elements** in a signed DE, because the certificate already carries
  them: `<X509SubjectName>`, `<X509IssuerSerial>`, `<X509IssuerName>`,
  `<X509SKI>`, `<KeyValue>`, `<RSAKeyValue>`, `<Modulus>`, `<Exponent>`.
- Revocation is checked by SIFEN against the CRL at validation time, so the
  emitter does **not** attach the list.

## 6. Certificate standard

**[R]** Manual §7.5 and §7.9.

- Issued by any **PSC** (Prestador de Servicios de Certificación) **habilitado
  por el MIC** (Ministerio de Industria y Comercio), which administers
  Paraguay's root CA.
- **Type F1 or F2** are the manual's own terms: _"Tipo F1: corresponde a
  Certificado de Firma Digital por Software"_ and _"Tipo F2: Certificado de
  Firma Digital por Hardware"_.
- The same certificate is used for **two distinct purposes**: signing data
  messages, and **mutual authentication** of the TLS connection.
- **Legal person:** the RUC lives in `Subject` → `SerialNumber`, OID `2.5.4.5`.
  **Natural person:** the RUC lives in `SubjectAlternativeName` →
  `SerialNumber`, and the certificate must also carry the employing entity's
  name and RUC.
- Format: `RUCXXXXXXXXX-X` — the literal `RUC`, the number, a hyphen, the check
  digit, **no spaces anywhere**.
- For the TLS connection the certificate must carry the `Extended Key Usage`
  extension with **`clientAuth`**.
- Standard: **ITU-T X.509 v3**.

## 7. Transport and protocols

**[R]** Manual §7.9 "Síntesis de definiciones tecnológicas" and §7.4:

```text
Web Services      WS-I Basic Profile 1.1
Protocolo         SOAP 1.2
Estilo/Encoding   Document/Literal
Transporte        Internet + TLS 1.2 con AUTENTICACIÓN MUTUA (certificados)
Certificado       ITU-T X.509 V.3, emitido por un PSC habilitado por el MIC
Firma             XML Digital Signature, Enveloped, X.509 v3,
                  clave privada RSA 2048, RSA, RFC5639, SHA-256
```

The manual shows a SOAP envelope example whose body carries
`<rEnviDe><dId/><xDE><rDE/></xDE></rEnviDe>`, and a response example
`<rRetEnviDe><rProtDe>…</rProtDe></rRetEnviDe>`.

## 8. Service endpoints

**[R]** Manual §7.10 "Resumen de las Direcciones Electrónicas de los Servicios
Web para Ambientes de Pruebas y Producción". This is the complete list.

| Service                 | Path                                  | Mode              |
| ----------------------- | ------------------------------------- | ----------------- |
| Recepción DE            | `/de/ws/sync/recibe.wsdl`             | Synchronous       |
| Recepción lote DE       | `/de/ws/async/recibe-lote.wsdl`       | **Asynchronous**  |
| Consulta resultado lote | `/de/ws/consultas/consulta-lote.wsdl` | Asynchronous pair |
| Consulta DE             | `/de/ws/consultas/consulta.wsdl`      | Synchronous       |
| Consulta RUC            | `/de/ws/consultas/consulta-ruc.wsdl`  | Synchronous       |
| Recepción evento        | `/de/ws/eventos/evento.wsdl`          | Synchronous       |

Hosts: **`https://sifen.set.gov.py`** (production) and
**`https://sifen-test.set.gov.py`** (test). Both publish the same paths.

Manual defects worth recording: the test-environment row spells the reception
path `recibe.wsd` (missing the `l`) while production spells it `recibe.wsdl`;
and the SOAP example uses a lowercase `<soap:body>` element and mismatched
`env`/`soap` prefixes on the same envelope. Neither is a protocol rule — treat
the path as `recibe.wsdl` and do not copy the example verbatim.

## 9. Services and message shapes

**[R]** Manual chapter 9.

- **Synchronous:** Recepción DE, Recepción evento, Consulta DE, Consulta RUC
  (plus future "Consulta DE destinados" and "Consulta DTE a entidades
  externas").
- **Asynchronous:** Recepción lote DE and Consulta resultado lote.
- `siRecepDE` takes `rEnviDe` with `dId` (a self-managed sequential control
  number, 1–15 digits) and `xDE` (the signed DE).
- `siRecepEvento` takes `rEnviEventoDe` with `dId` and `dEvReg` (the event).
- **Batch container:** `ContenedorDE`; the manual's Schema XML index lists
  `SiRecepLoteDE_v150.xsd`, `ProtProcesLoteDE_v150.xsd`,
  `resRecepLoteDE_v150.xsd`, `SiResultLoteDE_v150.xsd`,
  `resResultLoteDE_v150.xsd`.
- **[O]** The batch size limit is not confirmed in the retrieved text; an
  earlier synthesis said 50 documents and that figure is **not** verified here.
- **[O]** The WSDL documents themselves were not retrieved, so the SOAP actions,
  bindings and header requirements are unread.

## 10. Result model

**[R]** Manual chapter 9 and chapter 12's structure.

The processing result group is `gResProc`:

| Field      | Meaning                               | Type     | Values                                                          |
| ---------- | ------------------------------------- | -------- | --------------------------------------------------------------- |
| `dEstRes`  | Estado del resultado                  | A, 8–30  | **`Aprobado`**, **`Aprobado con observación`**, **`Rechazado`** |
| `dProtAut` | Número de transacción                 | N, 10    | 0–1                                                             |
| `dCodRes`  | Código del resultado de procesamiento | N, 4     | defined in chapter 12                                           |
| `dMsgRes`  | Mensaje del resultado                 | A, 1–255 | defined in chapter 12                                           |

The batch result adds `dCodResLot` (N, 4), `dMsgResLot`, and **`dTpoProces`** —
"Tiempo medio de procesamiento en segundos" (N, 1–5). `gResProc` repeats 1–100,
and **if the result is an error only the first is presented**.

Worked example from the manual: `dCodRes` `0160` with `dMsgRes` "XML
malformado".

**Mapping consequence:** SIFEN has exactly **three** outcome states, so our
lifecycle's `APPROVED` and `REJECTED` map directly and
**`Aprobado con observación` must map to `APPROVED` while preserving the
observation**. The four-digit `dCodRes` is the provider reason code our
`last_error_code` should carry, and `dMsgRes` is the operator-facing message.

**[O]** The `dCodRes` catalogue itself (chapter 12's tables) was not extracted
field by field.

## 11. Timing and deadlines

**[R]** Manual §6.2 and §6.2.1.

- **Transmission deadline: up to 72 hours** from the DE's digital signature.
  This is a benefit to the emitter that reduces the need for contingency.
- **SIFEN's maximum response time per DTE: 1 minute**, with a future target
  below 2 seconds.
- Receptor events (Notificación de Recepción, Conformidad, Disconformidad,
  Desconocimiento): **up to 360 hours (15 days)** from the first registered
  event.
- All periods are computed in **horas corridas**.

The model permits **previous or posterior validation**: a business may choose to
obtain the approval protocol before delivering the document to the receptor.
Under posterior validation the **KuDE may be generated before approval**.

## 12. Rejection and resubmission

**[R]** Manual §6.5.

If a DE fails validation and the correction **does not change the CDC**, the
**same CDC may be reused** and the document resubmitted — repeatedly, until
approval. The manual's stated purpose is that the QR already printed on the KuDE
delivered to the receptor keeps resolving to the corrected DTE. The emitter must
repeat the procedure as many times as needed, without prejudice to the sanctions
for late transmission.

**Consequence for us:** a rejected document is **retryable with the same
identity**, which is exactly the model [[DEC-049]] chose for the submission job.
A local "new document per attempt" design would contradict the manual.

## 13. Timbrado and numbering

**[R]** Manual §10.5 "Manejo del timbrado y Numeración".

The identifying sequence is exactly:

```text
Número de timbrado
Establecimiento
Punto de expedición
Tipo de documento
Número de documento
Serie
```

- A **serie** was introduced because **the timbrado no longer carries an end-of-
  validity date**: the authorised numbering is extended by moving to the next
  series instead of re-timbrando.
- Series are **all two-uppercase-letter combinations except `Ñ`**.
- The manual's worked example: timbrado `12345678`, establecimiento `001`, punto
  `001`, tipo `01`, numbers `0000001`–`9999999`, initially with no series, then
  continuing with serie `AA`, then the next serie, and so on.
- The `dDesTipEmi` field (B003) distinguishes `1 = "Normal"` from
  `2 = "Contingencia"`.

## 14. KuDE and QR

**[R]** Manual §6.2, §13, and the changelog's note that §13.8 changed the
**Código de Seguridad (CSC) to 32 alphanumeric digits**.

- The **KuDE** is an auxiliary, simplified representation of the DTE: it carries
  only representative fields and its legal validity is **conditional on SIFEN's
  approval** of the DE.
- It carries a **QR** built from the CDC and the CSC; the receptor is obliged to
  query SIFEN using fields present in the KuDE.
- Under posterior validation the KuDE may be issued **before** approval, which
  is what makes the CDC-reuse rule of §12 necessary.

**[O]** The QR's exact composition and the CSC's per-environment value were not
extracted in detail.

## 15. Environments and the test guide

**[R]** _Guía de Pruebas para el sistema e-kuatia_, 12 pages, retrieved in full.

- **Ambiente de Pruebas** — DNIT provides the web services and basic
  functionalities plus **test data (RUC, Timbrado and generic CSC)**. It covers
  mutual-auth entry, DE validation, certificate validity and revocation, the
  electronic signature, event registration and DTE query. **Documents issued
  here have no legal value.**
- **Ambiente de Producción** — for habilitated electronic issuers; approval
  carries legal effect.
- **Minimum test set** the guide prescribes: a timbrado (number and start of
  validity), one establishment, **up to three points of expedition**, and the
  taxpayer's RUC (a leading `0` may be added to the timbrado; the check digit is
  not used). The timbrado is generated through the **SGTM**.
- The prescribed test sequence is: mutual-authentication entry → DE
  transmission, validation and result → event reception, registration and
  association → DTE and event query → **KuDE generation and QR validation per
  DTE type**.
- The guide's own reference list confirms the documentation set: Manual Técnico
  v150, Notas técnicas, Recomendaciones - servicio asíncrono, Listado Checksum
  MD5, **Estructura xml_DE** and **Estructura_DE xsd**.

## 16. Notas Técnicas

**[R]** All three notes that amend v150 were retrieved in full. Each is dated
and carries its own availability dates for test and production, and each is
titled "Correcciones y ajustes sobre el Manual Técnico versión 150".

### NT 23 — 27/08/2024 · test 30/08/2024 · production 27/09/2024

Field changes:

- **D200–D299 (receptor):** `D208 iTipIDRec` — identity document type, values
  `1 Cédula paraguaya`, `2 Pasaporte`, `3 Cédula extranjera`,
  `4 Carnet de residencia`, **`5 Innominado`**,
  `6 Tarjeta Diplomática de exoneración fiscal`, `9 Otro`; required if
  `D201 = 2` and `D202 ≠ 4`, not reported if `D201 = 1`. `D210 dNumIDRec` — 1–20
  characters; **for an innominated DE, fill with `0`**.
- **`E711 dCantProSer`** — length changed to `1-10` with `p(0-8)` decimals.
- **`E797 dConKwh`** (energy sector) — occurrence changed to `0-1`.
- **New field `H018 dRucFus`** (fused RUC), 3–8 characters, **required when the
  referenced DTE's CDC corresponds to a fused RUC**.

Validations introduced or modified: `D208e` (1331), `D210` (1314), `D208f`
(1333), `D210b` (1334), `D208g` (1335), `H001` (2400), `H004g` (2439), `H018`
(2443), `H018a` (2444).

Codifications: the unit-of-measure table was extended with codes 111–140.

### NT 24 — 17/12/2024 · test and production 01/01/2025

- Modifies validation **`D208c` (code 1321)**: the receptor's identity document
  type cannot be `Innominado` (`D208 ≠ 5`) when the transaction type is not
  _Muestras médicas_ (`D011 ≠ 13`) and the operation's general total is
  `≥ 7.000.000` in guaraníes (`F023 >= 7.000.000`, or `F014 >= 7.000.000` when
  the currency is foreign). Cites _Decreto N° 872/2023_, art. 6, inciso ii),
  numeral 2.

### NT 25 — 23/04/2024 · test and production 28/04/2025

- In §11.6.1 (cancellation validation rules) the validation **`GEC002c`
  (code 4004)** is **excluded**: _"CDC ya se ha confirmado por el receptor… no
  se permite realizar la cancelación por parte del emisor"_. The cancellation
  restriction it imposed is therefore **removed**.

**[O]** The portal also lists notes **26** and **27**; their PDFs were not
retrieved, so their clauses are unknown. A Story that encodes a validation rule
must confirm it against the full note set first.

**Consequence:** the notes are where the manual is corrected, and two of the
three change receptor-identity validation. FISC-008 must implement the
**post-note** rules (`D208c` as amended by NT 24), not the manual's original
text.

## 17. Tables and codifications

**[R]** The portal names the November 2025 geographic table and the schema
directory publishes the companion XSDs.

**[O]** The tables' **contents** were not read. Chapter 16 of the manual holds
the codifications, and `DE_Types_v150.xsd` was not retrieved.

## 18. Contingency

**[R]** This is a finding, not a gap. The manual's §14 says of its own
contingency section:

> «Contingencia — Se elimina el contenido de esta sección, ya que sigue en etapa
> de definición»

and a table elsewhere marks "Contingencia (Futuro)".

So **DNIT has not defined the contingency rules** in the current baseline. The
only contiguous fact is the `dDesTipEmi = 2` flag that marks an emission as
contingent.

**Consequence:** [[EPIC-16]]'s FISC-013 cannot implement a contingency protocol
from the baseline, because there is none to implement. It must either record the
flag and treat the rules as pending DNIT, or be reframed.

## 19. Open questions

1. **Notas Técnicas.** All 27 (001–027) were retrieved and their text extracted
   on 2026-10-04 — see §22.7 and §22.10. **27 is the latest** (28 returns HTTP
   404). NT 26 excludes four B2G validation rules and NT 27 amends the
   nomination _event_ format, so neither changes a DE rule [[FISC-008]] must
   implement. **What remains open is their rule text**: eighteen notes touch DE
   fields and ten amend validations, nine of them the receptor block, so the
   rules in §22.3 and §22.4 are provisional. An earlier claim here that the set
   was complete at 23–27 was wrong and is corrected in §22.7.
2. ~~`DE_Types_v150.xsd`: per-field lengths, patterns and enumerations.~~
   **Resolved 2026-10-04 — see §21.** 140 `simpleType`s with their enumerations,
   the scalar patterns, and the `rDE`/`tDE` structures are now pinned from the
   official schema.
3. The full `dCodRes` catalogue from chapter 12.
4. The WSDL documents: SOAP actions, bindings, header requirements.
5. The batch size limit for asynchronous reception.
6. The QR composition and the CSC's per-environment value.
7. ~~The tables' contents, and chapter 16's codifications.~~ **Mostly resolved
   2026-10-04 — see §22.2 and §22.6.** The Manual's field-level rules are
   recorded, four companion tables are retrieved as official XSDs, and the
   **geography spreadsheet closes `D111`, `D113` and `D115`** (18 departamentos,
   272 distritos unique nationally, 6,766 ciudades). ~~Still open~~: **`D104` is
   retrieved (2026-10-05) — the Manual's TABLA 1 prints all eight régimenes
   inline, see §22.6; the earlier "does not contain them" claim was wrong.**
   `Tabla 3 Actividades Económicas` (`D131`) remains open: it is a link whose
   target returns an HTML portal shell, not a service (see §22.6).
8. Whether the Prevalidador is usable in an automated pre-submission check.
9. ~~How a test validates against the official XSDs without vendoring them.~~
   **Resolved 2026-10-04 by the maintainer.** A dedicated CI job fetches the
   three schemas, asserts each fetch (HTTP status and a minimum byte size) and
   runs the schema-validation suite with the skip **disabled**, so a green run
   cannot be the product of having validated nothing; a fetch that does not
   produce all three fails the job rather than degrading to a skip, and the run
   is recorded in `docs/10-qa/CI-EVIDENCE.md` with the artifact sizes and the
   case count. See [[FISC-008]]'s "The validation strategy".

Resolved since the first pass, and no longer open: the field-level types and
enumerations (§21), the field-level **rules** and the complete Nota Técnica set
(§22), the signature profile, the certificate standard and its F1/F2 types, the
transport stack, the endpoint list, the result model and its three states, the
deadlines, the CDC-reuse rule, the timbrado and numbering model, the test
environment and its test data, the contingency question — answered by DNIT's own
statement that it is undefined — and **the clauses of Notas Técnicas 23, 24 and
25**.

## 20. Consequences for the epic's Stories

| Story                                  | May now pin                                                                                                                                                           | Must still not write                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| FISC-007 signing material              | That a PSC-issued X.509 v3 certificate is used for **both** signing and mutual TLS; that the private key and password are RESTRICTED; the RUC placement rules         | Nothing beyond the certificate standard                                    |
| FISC-008 DTE XML                       | The full `rDE` structure, `dVerFor` = 150, the required CDC `Id`, the child order, the namespace rules, `gCamDEAsoc` ≤ 99                                             | Field-level types from `DE_Types_v150.xsd`, and any Nota Técnica amendment |
| FISC-009 XAdES signing                 | **The complete signature profile**: c14n, rsa-sha256, `#CDC` reference URI, the two ordered transforms, sha256 digest, X509Data, RSA 2048, and the forbidden elements | The library choice, which is the ADR                                       |
| FISC-010 DNIT web services             | **The endpoint list for both environments**, the six services, sync/async split, SOAP 1.2 Document/Literal over mutual TLS                                            | SOAP actions and WSDL details; the batch limit                             |
| FISC-011 timbrado and numbering        | The six-field sequence, the series rule (two uppercase letters, no Ñ), the no-expiry timbrado model                                                                   | The tables' contents                                                       |
| FISC-012 the provider                  | The three-state result model and the `dCodRes`/`dMsgRes` mapping, and that a rejected DE is **retryable with the same CDC**                                           | The full `dCodRes` catalogue                                               |
| FISC-013 contingency and certification | **The test guide's sequence and test data**, the test and production environments, and that documents in test have no legal value                                     | A contingency protocol: DNIT has not defined one                           |

## Sources

Retrieved **2026-10-03**:

1. **[R]** DNIT, _Manual Técnico de Sistema de Facturación Electrónica
   Nacional_, versión **150**, 10/09/2019, 217 pages —
   <https://www.dnit.gov.py/documents/20123/420592/Manual+T%C3%A9cnico+Versi%C3%B3n+150.pdf>
2. **[R]** DNIT, _Guía de Pruebas para el sistema e-kuatia_, 12 pages —
   <https://ekuatia.set.gov.py/documents/20123/424160/Guia+de+Pruebas+para+e-kuatia.pdf>
3. **[R]** DNIT, _Documentación Técnica_ —
   <https://www.dnit.gov.py/web/e-kuatia/documentacion-tecnica>
4. **[R]** DNIT, _Tablas y Codificaciones_ —
   <https://ekuatia.set.gov.py/web/e-kuatia/tablas-y-codificaciones>
5. **[R]** DNIT, _Index of /sifen/xsd_ — <https://ekuatia.set.gov.py/sifen/xsd/>
6. **[R]** DNIT, _DE_v150.xsd_ —
   <https://ekuatia.set.gov.py/sifen/xsd/DE_v150.xsd>
7. **[R]** DNIT, _xmldsig-core-schema.xsd_ —
   <https://ekuatia.set.gov.py/sifen/xsd/xmldsig-core-schema.xsd>
8. **[R]** DNIT, _Resolución General N.° 41/25_, Asunción, 24 December 2025 —
   <https://ekuatia.set.gov.py/web/portal-institucional/w/resoluci%C3%B3n-general-dnit-n.%C2%B0-41/25>
9. **[R]** DNIT, _Nota Técnica N° 23_, 27/08/2024 —
   <https://www.dnit.gov.py/documents/20123/420595/NT_E_KUATIA_023_MT_V150.pdf>
10. **[R]** DNIT, _Nota Técnica N° 24_, 17/12/2024 —
    <https://www.dnit.gov.py/documents/20123/420595/NT_E_KUATIA_024_MT_V150.pdf>
11. **[R]** DNIT, _Nota Técnica N° 25_, 23/04/2024 —
    <https://www.dnit.gov.py/documents/20123/420595/NT_E_KUATIA_025_MT_V150.pdf>

Located but **not retrieved**, each an open question above: Notas Técnicas 26
and 27, `DE_Types_v150.xsd`, the WSDL files, the best-practices guide for
sending DE, and the Prevalidador.

## 21. Field-level types and enumerations — `DE_Types_v150.xsd` (retrieved 2026-10-04)

**[R]** This section closes open question 2 of §19. FISC-006 recorded
`DE_Types_v150.xsd` as **not retrieved**, which is exactly the artifact
[[FISC-008]] needs: without it, no per-field length, pattern or enumeration was
pinned, and a generated DE could not be validated.

**Retrieval record.** All three DE schemas were fetched from the official
directory <https://ekuatia.set.gov.py/sifen/xsd/> on 2026-10-04, HTTP 200, and
their bytes were inspected rather than trusted by name:

```text
DE_Types_v150.xsd          66,452 bytes   <- the previously-open artifact
DE_v150.xsd                66,190 bytes   <- re-retrieved; FISC-006 recorded 66,117 chars
xmldsig-core-schema.xsd    10,339 bytes   <- matches FISC-006 exactly
```

The bytes are **not vendored**. `docs/06-fiscal/SIFEN-BASELINE.md` records
citations and structural facts, not DNIT's copyrighted schemas.

**Shape.** `DE_Types_v150.xsd` declares **140 `simpleType`s and zero
`complexType`s**; the structures live in `DE_v150.xsd`, which declares **49
`complexType`s and no top-level element**. Both files set
`elementFormDefault="qualified"` and
`targetNamespace="http://ekuatia.set.gov.py/sifen/xsd"`.

### 21.1 The document root

`rDE` is a `complexType`, not an element, and has exactly four children, all
required and ordered:

```text
rDE
  dVerFor     [1..1]  pattern [1][5][0]   -> pinned to 150 by pattern, not by enumeration
  DE          [1..1]  type tDE
  (anonymous) [1..1]  the ds:Signature placeholder
  gCamFuFD    [1..1]  type tgCamFuFD      -> outside the signature, as §4 records
```

### 21.2 The `DE` body

`tDE` has eleven children, in this order:

```text
dDVId        [1..1]  tDVer      check digit of the CDC
dFecFirma    [1..1]  fecHhmmss  pattern \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d
dSisFact     [1..1]
gOpeDE       [1..1]  tgCOpeDE   operation: emission type, security code, issuer info
gTimb        [1..1]  tgDTim     timbrado
gDatGralOpe  [1..1]  tgDaGOC    general operation data
gDtipDE      [1..1]  tgDtipDE   document-type specific
gTotSub      [0..1]  tgTotSub   totals
gCamGen      [0..1]  tgCamGen   general fields
gCamDEAsoc   [0..99] tgCamDEAsoc associated documents
```

`gCamDEAsoc` at `0..99` confirms §4's upper bound. The order is schema-enforced:
a DE with the same children in a different order is invalid, not merely
unconventional.

### 21.3 Identity, numbering and date patterns

| Type                       | Pattern / bounds                                                    | Note                                                                      |
| -------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `tCDC`                     | `[0-9]{2}([0-9]{7}[0-9A-D])[0-9]{34}`, `length=44`                  | the CDC is 44 characters; position 10 admits `A`–`D`                      |
| `tRuc`                     | `minLength=3`, `maxLength=8`, `[1-9][0-9]*[0-9A-D]?`                | the DV letter is optional here, unlike the certificate's `RUCXXXXXXXXX-X` |
| `tDVer`                    | `[0-9]`                                                             | one digit; used by `dDVId` and by the version fields                      |
| `tdEst` / `tdPunExp`       | `[0-9]{3}`, `minLength=3`                                           | establishment and expedition point are **zero-padded to three digits**    |
| `tdNumDoc`                 | `length=7`, `0+[1-9][0-9]*\|[1-9]+[0-9]+`                           | exactly seven digits, no leading zeros beyond the padding rule            |
| `tdSerieNum`               | `[A-Z]{2}`                                                          | matches §13's series rule                                                 |
| `tdNumTim` (via `dNumTim`) | see the manual                                                      | the timbrado number                                                       |
| `tFecAAAAMMDD`             | `[2-9][0-9]{3}([0][1-9]\|[1][0-2])([0][0-9]\|[1-2][0-9]\|[3][0-1])` | `AAAAMMDD`, no separators                                                 |
| `tFecAAAAMMDDguion`        | same with `-`                                                       | `AAAA-MM-DD`                                                              |
| `tFecDDMMAAAAguion`        | `DD-MM-AAAA`                                                        |                                                                           |
| `fecHhmmss`                | `\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d`                                    | `dFecFirma`, **no timezone suffix and no fractional seconds**             |
| `tdFeIniT` / `tdFeIniS`    | `date`, `minInclusive=2018-05-01`                                   | no validity date may precede the SIFEN start                              |
| `dNomRazSocial`            | `minLength=4`, `maxLength=60`                                       |                                                                           |

### 21.4 Money and quantity patterns

Every monetary field is a **decimal with an explicit scale**, so the XML must
carry the right number of fraction digits per field rather than a single house
style:

| Type              | totalDigits | fractionDigits | Bounds                          |
| ----------------- | ----------- | -------------- | ------------------------------- |
| `tMontoBase`      | 23          | 8              | `0 .. 999999999999999.99999999` |
| `tMontoBase4`     | 19          | 4              | `0 .. 999999999999999.9999`     |
| `tMontoBase6`     | 10          | 4              | `0 .. 999999.9999`              |
| `tTipoCambioBase` | 9           | 4              | `0 < x < 99999.9999`            |
| `tPorcDesc8`      | 11          | 8              | `0 .. 100`                      |
| `tdTasaIVA`       | 2           | — (integer)    | `>= 0`                          |
| `tdCantProSer`    | 18          | 8              | `0 .. 9999999999.99999999`      |

### 21.5 Enumerations the emitted documents depend on

Recorded as `type (base) -> values`, transcribed from the schema. Where the
schema carries both a code and a description type, both are listed: the DE
carries the code, the description type is what the manual's tables expand.

```text
tiTipEmi        (positiveInteger, pattern [1-2])   tdDesTipEmi: Normal, Contingencia
tiTiDE          (integer, pattern 1|[4-7]|9|10)    tdDesTiDE: Factura electrónica,
                                                   Autofactura, Nota de crédito,
                                                   Nota de débito, Nota de remisión,
                                                   Boleta de venta, Boleta resimple
tiTipTra        (integer, 1..13)                   tdDesTiTran: 13 transaction types
tiCondOpe       (integer, 1|2)                     tdDCondOpe: Contado, Crédito
tiTiPago        (integer, 22 values incl. 99)      payment means
tiAfecIVA       (positiveInteger, 1..4)            tdDesAfecIVA: Gravado IVA,
                                                   Exonerado (Art. 100 - Ley 6380/2019),
                                                   Exento, Gravado parcial
tiNatRec       (integer, 1|2)                      tdDesNatVen: No contribuyente, Extranjero
tiNatVen        (integer, 1|2)                     same two values
tiTipDoc       (integer, 1..4)                     tdDtipDoc: Cédula paraguaya, Pasaporte,
                                                   Cédula extranjera, Carnet de residencia
tiTipDocRec    (integer, 1-6|9)                    receptor identity document
tiIndPres      (integer, 1-6|9)                    presence indicator
tiTipCont      (integer, 1|2)                      contributor type
tiMotEmi       (noEmptyString, [1-8])              emission motive
tiTImp         (integer, 1..5)                     tdDesTImp: IVA, ISC, Renta, Ninguno, IVA - Renta
tiForProPa     (short, 1|2|9)                      payment form
tiDenTarj      (integer, 1-6|99)                   card denomination
tiTipIDRespDE  (integer, 1-4|9)                    responsible for the DE
```

### 21.6 The DE's internal groups, in schema order

**[R]** §21.1 and §21.2 give `rDE` and `tDE`; the members _inside_ `tDE`'s
groups live in `DE_v150.xsd` and were not transcribed by §21.2, which is why
[[FISC-008]]'s builder needed them. They are recorded here from the same
retrieved artifact (66,190 bytes, HTTP 200, 2026-10-04), so no group membership
in the generator rests on an assumption.

```text
gOpeDE   tgCOpeDE   iTipEmi, dDesTipEmi, dCodSeg, dInfoEmi?, dInfoFisc?
         (matches §4's comment exactly: the security code lives HERE)
gTimb    tgDTim     iTiDE, dDesTiDE, dNumTim, dEst, dPunExp, dNumDoc,
                    dSerieNum?, dFeIniT
gDatGralOpe tgDaGOC dFeEmiDE, gOpeCom?, gEmis, gDatRec
gOpeCom  tgOpeCom   iTipTra?, dDesTipTra?, iTImp, dDesTImp, cMoneOpe,
                    dDesMoneOpe, dCondTiCam?, dTiCam?, iCondAnt?,
                    dDesCondAnt?, gOblAfe 0..12
gEmis    tgEmis     dRucEm, dDVEmi, iTipCont, cTipReg?, dNomEmi,
                    dNomFanEmi?, dDirEmi, dNumCas, dCompDir1?, dCompDir2?,
                    cDepEmi, dDesDepEmi, cDisEmi?, dDesDisEmi?, cCiuEmi,
                    dDesCiuEmi, dTelEmi, dEmailE, dDenSuc?, gActEco 1..9,
                    gRespDE?
gDatRec  tgDatRec   iNatRec, iTiOpe, cPaisRec, dDesPaisRe, iTiContRec?,
                    dRucRec?, dDVRec?, iTipIDRec?, dDTipIDRec?, dNumIDRec?,
                    dNomRec, dNomFanRec?, dDirRec?, dNumCasRec?, cDepRec?,
                    dDesDepRec?, cDisRec?, dDesDisRec?, cCiuRec?,
                    dDesCiuRec?, dTelRec?, dCelRec?, dEmailRec?, dCodCliente?
gCamFuFD tgCamFuFD  dCarQR (100..600), dInfAdic? (1..5000)
```

**Three structural facts this resolves, each of which a generator can get
wrong:**

1. **`dCodSeg` lives in `gOpeDE`, not in a general-operations group**, and
   `gOpeDE` carries nothing else beyond the emission type, its description and
   two optional free-text fields.
2. **`gDatGralOpe` is the wrapper**: `dFeEmiDE` first, then the optional
   `gOpeCom`, then `gEmis` and `gDatRec`. The receptor block is `gDatRec`, and
   inside it `dRucRec`/`dDVRec` precede `iTipIDRec`/`dDTipIDRec`/`dNumIDRec`.
   `cPaisRec` and `dDesPaisRe` are **required** and sit between `iTiOpe` and the
   optional `iTiContRec`.
3. **`iCondOpe`/`dDCondOpe` and `iIndPres`/`dDesIndPres` are NOT in `gOpeCom`.**
   They are document-type-specific: `iCondOpe` sits in `gCamCond` and `iIndPres`
   in `gCamFE`, both inside `gDtipDE`.

**What this still does not transcribe.** The _optional_ members of `gDtipDE`,
`gTotSub`, `gCamGen` and `gCamDEAsoc` are **not** recorded here. `gDtipDE` alone
spans 11 optional/required groups including `gCamItem` (`1..999`), and §22.10
records that the item, imputation and title areas are amended by Notas Técnicas
whose rule text is not transcribed. A generator that typed them today would be
encoding a provisional area, so FISC-008 carries them as caller-supplied ordered
elements instead.

**The schema's own requirement inside `gDtipDE` is small, and that is worth
recording because it is what makes a document validatable at all.** Of the 11
groups, only `gCamItem` is required — `gCamFE`, `gCamAE`, `gCamNCDE`, `gCamNRE`,
`gCamCond`, `gCamEsp`, `gTransp` and `gCamRDE` are all `minOccurs="0"` — and
`tgCamItem` requires exactly five elements: `dCodInt`, `dDesProSer`, `cUniMed`,
`dDesUniMed`, `dCantProSer`. Everything else in the item (`gValorItem`,
`gCamIVA`, the discounts, the ISC) is optional _to the schema_, while the
Manual's conditional rules for them stay provisional per §22.10. In the same way
`gTotSub`, `gCamGen` and `gCamDEAsoc` are `minOccurs="0"` inside `tDE`, so a
schema-valid DE may omit all three.

### 21.7 What validating against these schemas actually requires

**[R]** Three operational facts, each verified against the published artifacts
while building the FISC-008 validation gate. They are recorded because each one
silently breaks the naive version of "fetch the schemas and validate".

1. **It is seven artifacts, not three.** `DE_v150.xsd` `xs:include`s
   `Paises_v100.xsd`, `Departamentos_v141.xsd`, `Monedas_v150.xsd`,
   `Unidades_Medida_v141.xsd` and `DE_Types_v150.xsd`; without those five the
   schema does not compile at all. `xmldsig-core-schema.xsd` is a relative
   `xs:import`. A directory holding only the three the Story names cannot
   validate anything.
2. **Co-locating them is not enough, because five of those includes are absolute
   HTTPS URLs.** Verified: with the network blocked, compilation fails with
   `global component '{http://ekuatia.set.gov.py/sifen/xsd}tCDC' not found` —
   the local `DE_Types_v150.xsd` sitting next to `DE_v150.xsd` is ignored in
   favour of the URL. A validator therefore reaches DNIT at validation time
   unless the `schemaLocation`s are rewritten to file names first, which also
   means a byte assertion only covers the artifacts that were actually used.
3. **`DE_v150.xsd` declares no top-level element.** `rDE` is a `complexType` —
   §21's Shape says so — so a bare `<rDE>` document has no element declaration
   to validate against. Addressing it needs either DNIT's container protocol or
   a local entry schema declaring `<xs:element name="rDE" type="rDE"/>` and
   including the official file. FISC-008 takes the second path, because the
   document it emits is a bare `<rDE>`, and every constraint still comes from
   DNIT's bytes.

**One consequence for the [[FISC-008]]/[[FISC-009]] boundary: an unsigned DE
cannot validate.** The signature in §4's root shape is `ds:Signature`, whose
type is `ds:SignatureType` with **`SignedInfo` required**, so `<Signature/>` is
schema-invalid (`Missing child element(s). Expected 'ds:SignedInfo'`). The
validation gate therefore validates a document whose signature block carries the
real _structure_ — the two ordered transforms, the SHA-256 digest method,
`X509Data/X509Certificate` — with placeholder contents. Producing the real
signature is [[FISC-009]]'s work, not the gate's.

### 21.8 What this still does not pin

Two of §19's open questions survive this retrieval and they matter to
[[FISC-008]]:

- **Notas Técnicas 26 and 27** remain unretrieved. NT 23/24/25 already changed
  receptor-identity validation and excluded a cancellation restriction, so a
  later note may change a rule this schema encodes. The schema is the
  _structure_; the notes are the _validation rules_, and FISC-008 must not treat
  the schema as the whole answer.
- **The tables' contents and chapter 16's codifications** are still unread, so
  the _meaning_ of each enumeration value above is not yet recorded here beyond
  the description types the schema itself carries. The schema gives the allowed
  values; the manual's tables give what each value means for the issuer.

## 22. Field-level rules and the complete Nota Técnica set (retrieved 2026-10-04)

**[R]** This section closes open questions 1 and 7 of §19. It exists because the
XSD alone is **not** enough to produce an acceptable DE: `DE_Types_v150.xsd`
pins structure, lengths, patterns and allowed values, while the Manual Técnico
pins the **conditional obligations and cross-field invariants** that SIFEN
actually validates. A document built from the schema alone is schema-valid and
still rejectable.

### 22.1 Retrieval record

```text
Manual Técnico v150 (already retrieved by FISC-006)   181,808 chars   read locally
Nota Técnica N° 26  06/06/2025  test 09/06/2025  prod 16/06/2025   152,348 bytes
Nota Técnica N° 27  09/03/2026  test 09/03/2026  prod 09/03/2026   171,022 bytes
Nota Técnica N° 28  HTTP 404 -> does not exist; 27 is the latest
Departamentos_v141.xsd                              6,198 bytes
Monedas_v150.xsd                                   57,236 bytes
Unidades_Medida_v141.xsd                           27,240 bytes
Paises_v100.xsd                                    53,266 bytes
```

The Notas Técnicas follow
`https://www.dnit.gov.py/documents/20123/420595/NT_E_KUATIA_0NN_MT_V150.pdf`.
**The Nota Técnica set is 001 to 027 — 27 notes — and only 23 to 27 are
retrieved.** The DNIT documentation page lists every one of them
(`/web/e-kuatia/documentacion-tecnica`). An earlier claim in this section that
the set was "complete" at 23–27 was **wrong**: it was made after finding 26 and
27 and a 404 for 28, without ever checking whether _earlier_ notes existed. They
do, from 001. **All 27 were retrieved on 2026-10-04 and their text extracted**,
and §22.10 profiles which of the earlier ones amend DE rules: **eighteen touch
DE fields and ten amend validations**, including nine that touch the receptor
block. The Manual's field-level rules are a 2019 baseline amended in part, so
§22.3 and §22.4 are **provisional** until those notes are read field by field.

**How the Manual was read, and why it matters (2026-10-05).** The extraction
method used for a PDF decides what this vault can see, and two families of
content are invisible to a plain text extractor:

- **Tables.** The Manual was re-fetched (HTTP 200, 5,204,470 bytes, 217 pages,
  `https://www.dnit.gov.py/documents/20123/420592/Manual+T%C3%A9cnico+Versi%C3%B3n+150.pdf`)
  and read with `pdfplumber`, which recovers the table bodies that the earlier
  `pypdf` pass and the `fetch_content` extraction both dropped. **Chapter 15
  _CODIFICACIONES_ exists and is mostly inline** — see §22.6, where the earlier
  claim that the Manual "references but does not contain" those tables is
  corrected.
- **Embedded images.** The CDC's composition in §10.1 is not text and not a
  ruled table: page 56 carries **four embedded images** (`extract_text` yields
  684 characters, `lines: 0`, and `extract_tables()` returns nothing), two of
  them exactly where the composition belongs. Rendering the page to an image and
  reading it recovers the composition — see §22.9.

The lesson, recorded because it cost two sessions and two false claims: **"the
source does not contain it" and "the source does not pin it" are different
claims, and only the second is safe to make after reading a PDF with one tool.**

### 22.2 The Manual's field-level specification

The Manual carries **73 distinct `D`-code field identifiers** and **59 parseable
field rows** of the shape

```text
<group> <D-code> <field> <description> <parent> <type> <length> <occurrence> <observations>
```

Each row's observations carry three things the schema does not: the field's
**semantics**, its **conditional obligation**, and its **value meanings**.
Extract them with a row-shape regex over the Manual text — a split on `D`-codes
does not work, because a `D`-code also appears _inside_ other fields'
observations as a cross-reference.

### 22.3 The receptor block — the rules that shape the generator

This is the highest-value finding of the retrieval. The receptor's identity is
**conditional on two other fields**, and the Manual's document-type enumeration
is **not** the schema's:

```text
D201  iNatRec    1 = contribuyente, 2 = no contribuyente
D202  iTiOpe     1..4  (D202 = 3 is B2G, D202 = 4 is B2C)
D206  dRucRec    Obligatorio si D201 = 1 ; No informar si D201 = 2
D207  dDVRec     Obligatorio si existe el campo D206   (algoritmo módulo 11)
D208  iTipIDRec  Obligatorio si D201 = 2 y D202 ≠ 4 ; No informar si D201 = 1 o D202 = 4
                 1 = Cédula paraguaya   2 = Pasaporte   3 = Cédula extranjera
                 4 = Carnet de residencia   5 = Innominado
                 6 = Tarjeta Diplomática de exoneración fiscal   9 = Otro
D209  dDTipIDRec Obligatorio si existe el campo D208
D210  dNumIDRec  Obligatorio si D201 = 2 y D202 ≠ 4 ; "En caso de DE innominado, completar con 0 (cero)"
```

Two consequences worth naming:

- **`D208` is a superset of the schema's `tiTipDoc`.** `DE_Types_v150.xsd`
  restricts `tiTipDoc` to `[1-4]`; the Manual's receptor document type adds
  `5 = Innominado`, `6 = Tarjeta Diplomática de exoneración fiscal` and `9`. The
  schema's `tiTipDocRec` (`[1-6]|9`) is the one that matches. **The generator
  must use the receptor enumeration, not the emitter's.**
- **A B2C document (`D202 = 4`) carries no identity document at all**, by the
  `No informar` rule. That is a rule no schema expresses.

**Nota Técnica 24 already amended this block** (§16): it amends `D208c`
(code 1321) about the receptor's identity document type and a 7,000,000
threshold. Neither NT 26 nor NT 27 touches it, so the amended rule stands as
FISC-006 recorded it.

### 22.4 Other conditional and cross-field rules

```text
D011  iTipTra    Obligatorio si C002 = 1 o 4 ; No informar si C002 ≠ 1 o 4
D012  dDesTipTra Obligatorio si existe el campo D011
D018  dTiCam     Obligatorio si D017 = 1 ; No informar si D017 = 2 ; No informar si D015 = PYG
D114  dDesDisEmi Obligatorio si existe el campo D113
D222  dDesCiuRec Obligatorio si existe el campo D221
D015  cMoneOpe   ISO 4217, and "Se requiere la misma moneda para todos los ítems del DE"
D101  dRucEm     "Debe corresponder al RUC del certificado digital utilizado para firmar el DE"
D102  dDVEmi     "Según algoritmo módulo 11"
D104  cTipReg    "Según Tabla 1 – Tipo de Régimen"
D108  dNumCas    "Si no tiene numeración, colocar 0 (cero)"
D111  cDepEmi    "Según XSD de Departamentos"   -> Departamentos_v141.xsd
D113  cDisEmi    "Según Tabla 2.1 – Distritos"
D115  cCiuEmi    "Según Tabla 2.2 – Ciudades"
D131  cActEco    "Según Tabla 3 – Actividades Económicas"
D103  iTipCont   1 = Persona Física, 2 = Persona Jurídica
D013  iTImp      1 = IVA, 2 = ISC, 3 = Renta, 4 = Ninguno, 5 = IVA - Renta
```

### 22.5 The test-environment rule

`D105 dNomEmi` carries a rule that no schema encodes and that homologation
depends on:

> "En caso de ambiente de prueba, debe contener obligatoriamente el literal
> **«DE generado en ambiente de prueba - sin valor comercial ni fiscal»**"

The generator must emit that literal as the emitter's name whenever it builds a
test-environment document. Without it the document is schema-valid and the test
environment rejects it.

### 22.6 The companion table schemas

Four are published as official XSDs and were retrieved:

| Schema                     | Pins                                         |
| -------------------------- | -------------------------------------------- |
| `Departamentos_v141.xsd`   | the department codes `D111 cDepEmi`          |
| `Monedas_v150.xsd`         | the currency codes `D015 cMoneOpe`, ISO 4217 |
| `Unidades_Medida_v141.xsd` | the unit-of-measure codes for the item lines |
| `Paises_v100.xsd`          | the country codes                            |

**The geography table is retrieved and closes `D111`, `D113` and `D115`.** It is
published as a spreadsheet rather than an XSD:

```text
CÓDIGO DE REFERENCIA GEOGRAFICA_NOVIEMBRE_2025__.xlsx   469,941 bytes
  updated 03/November/2025, sourced from the INE geographic code 2022
  7,735 data rows: 18 departamentos, 272 distritos,
  6,766 ciudades/localidades, 1,104 barrios
  columns: departamento (code, name), distrito (code, name),
           ciudad/localidad (code, name), barrio (code, name)
  distrito codes run 1-289 and are UNIQUE NATIONALLY, so D113 can be validated
  as a national code; ciudad codes run 1-6,793
```

Both ranges sit inside the schema's bounds (`tcDisEmi` 1-4 digits, `tcCiuEmi`
1-5 digits up to 99999), so the two sources agree.

**`D104` is INLINE in the Manual, and an earlier claim here was wrong.** Chapter
15 _CODIFICACIONES_ prints **TABLA 1 – TIPO DE REGIMEN** in full:

```text
1  Régimen de Turismo                 5  Ley N° 60/90
2  Importador                         6  Régimen del Pequeño Productor
3  Exportador                         7  Régimen del Mediano Productor
4  Maquila                            8  Régimen Contable
```

That is exactly `tcTipReg`'s `[1-8]` from `DE_Types_v150.xsd`, so **`D104` is
retrieved and needs no further search**. The earlier record said the Manual
"references them but does not contain them": that conclusion came from reading
the chapter-10 field rows that _point at_ the tables, and chapter 15 never
appeared in the extracted text because the extractor dropped its tables.

**`D131` is a link, and its target no longer answers as a service.** The Manual
prints `TABLA 3 – ACTIVIDADES ECONÓMICAS` as
`https://servicios.set.gov.py/eset-publico/consultarActividadEconomicaIService.do`,
and that URL (with or without `?wsdl`) returns **HTTP 200 `text/html`, 10,190
bytes — the Marangatu portal shell**, not a service descriptor. So the activity
catalogue is still unretrieved, and its shape (`tcActEco`, `[0-9A-Z]{1,8}`) is
all the schema gives. Retrieval path: the SET's Marangatu/RUC documentation, not
an e-kuatia page.

**What else chapter 15 prints inline**, all of it previously recorded as unread:

- **TABLA 5 – CODIFICACIÓN DE UNIDADES DE MEDIDA** — code, representation and
  description (e.g. `87 m Metros`, `77 UNI Unidad`, `625 Km`). The XSD
  `Unidades_Medida_v141.xsd` (27,240 bytes) remains the better source: it is
  machine-readable and carries all 64 values.
- **TABLA 6 – CÓDIGOS DE AFECTACIÓN** — `1 Gravado IVA`,
  `2 Exonerado (Art.83 - 125)`, `3 Exento`, `4 Gravado parcial`. **These
  disagree with the schema, which wins**: `tiAfecIVA`'s descriptions say
  `Exonerado (Art. 100 - Ley 6380/2019)`. The Manual is from 2019 and the law
  changed, so the XSD's wording is the current one and the Manual's is
  historical.
- **TABLA 7 / TABLA 8 – ISC** (categories and rates), **TABLA 10 – INCOTERMS**
  (11 codes), **TABLA 4 – países** = ISO 3166-1 alpha-3 (the XSD carries it).
- **TABLA 2.1** points at the geography spreadsheet already retrieved in §22.6;
  **TABLA 9** and **TABLA 11** are links.

So the corrected picture is: **the only catalogue this vault still lacks is
`D131`'s**, and the only table family still genuinely absent from the Manual is
the one it replaces with a link.

### 22.7 The Notas Técnicas 26 and 27

**NT 26 — 06/06/2025, test 09/06/2025, production 16/06/2025.** It **excludes
four validation rules**, all of them about public purchases (B2G):

```text
E020   1400  "Grupo de informaciones de Compras Públicas es obligatorio"      EXCLUDED
E020a  1401  "no requerido para el tipo de operación"                          EXCLUDED
E704   1800  "Código de DNCP - Nivel General es obligatorio para B2G"          EXCLUDED
E705   1801  "Código de DNCP – Nivel Específico es obligatorio"                EXCLUDED
```

and it relaxes `E704 dDncpG` and `E705 dDncpE` from mandatory to
`Opcional si D202 = 3`. **Consequence for FISC-008**: none of its rules apply to
a B2C or B2B invoice. It matters only if the product ever issues a B2G document,
and it means a B2G document must **not** be rejected for a missing `gCompPub`.

**NT 27 — 09/03/2026, test and production 09/03/2026.** It amends the **Evento
de Nominación de Factura Electrónica** — an _event_ format, not the DE:

```text
GENFE010  iTipIDRec    Obligatorio si GENFE004 = 2
                       1 = Cédula paraguaya   2 = Pasaporte   3 = Cédula extranjera
                       4 = Carnet de residencia
                       6 = Tarjeta Diplomática de exoneración fiscal   9 = Otro
GENFE011  dDTipIDRec   Obligatorio si existe el campo GENFE010
```

**Consequence for FISC-008**: none. NT 27 changes no DE field and no DE
validation rule; it belongs to the events capability the epic's later stories
own. It is recorded here so a future reader does not have to re-fetch it to
learn that.

One asymmetry worth noting: the **event's** receptor document type includes
`6 = Tarjeta Diplomática de exoneración fiscal` and `9`, while the **DE's**
`D208` includes `5 = Innominado` as well. The two enumerations are close but not
identical, so they must not be shared as one constant.

### 22.8 What remains open after this retrieval

- **`Tabla 2.1 – Distritos` and `Tabla 2.2 – Ciudades` contents** (`D113`,
  `D115`), plus `Tabla 1 – Tipo de Régimen` (`D104`) and
  `Tabla 3 – Actividades Económicas` (`D131`). The Manual states where they
  apply; their values come from the portal's tables, whose contents are unread.
- The **full `dCodRes` catalogue** from chapter 12.
- The **WSDL documents**: SOAP actions, bindings, header requirements.
- The **batch size limit** for asynchronous reception.
- The **QR composition** and the CSC's per-environment value.
- Whether the **Prevalidador** is usable in an automated pre-submission check.
- **The rule text of Notas Técnicas 001–022** (§22.10). All 27 notes are
  retrieved and profiled, but their _rule text_ is not transcribed: eighteen of
  them touch DE fields and ten amend validations, so §22.3 and §22.4 — read from
  the 2019 Manual — are **provisional**. Nine notes amend the receptor block
  alone.
- **`Tabla 1 – Tipo de Régimen` (`D104`)** — **CLOSED 2026-10-05**: the Manual's
  TABLA 1 prints all eight régimenes inline and the earlier "absent from it"
  claim was wrong (§22.6). **`Tabla 3 – Actividades Económicas` (`D131`)** stays
  open: the Manual prints a link and that target now returns an HTML portal
  shell (§22.6).
- **The CDC's check-digit algorithm** (§22.9) — and only that. **The composition
  is CLOSED 2026-10-05**: it is a picture of a table on page 56, recovered by
  rendering the page, and the Manual's worked example decomposes into exactly
  those widths and matches the KuDE specimen byte for byte. What remains is the
  verifier: §10.2 names `módulo 11`, the verifier document's URL now serves the
  portal's HTML shell, and the Manual plus all 27 Notas Técnicas contain **one
  usable specimen**, which is not enough to fix a variant. Until it is pinned,
  the generator takes the CDC and `dDVId` as inputs rather than publishing an
  identity whose check digit it cannot verify.

### 22.9 The CDC and the security code

Two fields the generator needs, with very different evidential status.

**`dCodSeg` — the security code — is fully pinned** by the Manual's §10.3:

> "Debe ser un número positivo de 9 dígitos. • Aleatorio. • Debe ser distinto
> para cada DE y generado por un algoritmo de complejidad suficiente para evitar
> la reproducción del valor. • Rango NO SECUENCIAL entre 000000001 y 999999999.
> • No tener relación con ninguna información específica o directa del DE o del
> emisor de manera a garantizar su seguridad. • **No debe ser igual al número de
> documento campo `dNumDoc`**. • En caso de ser un número de menos de 9 dígitos
> completar con 0 a la izquierda."

So it is a random 9-digit value, zero-padded, never equal to the document
number, and deliberately unrelated to the document or the issuer. `tdCodSeg` in
`DE_Types_v150.xsd` restricts it to nine digits, so the two agree.

**The CDC's composition IS now pinned — recovered 2026-10-05 — and the earlier
record here was wrong about why it looked absent.** The Manual has the section —
§10.1 _"Estructura del código de control (CDC) de los DE"_ — and its text reads:

> "Conformación del CDC. Para lograr una mayor comprensión se describe a
> continuación un ejemplo de cómo generar un CDC: Consideraremos: … Por lo
> tanto, el CDC estará conformado como sigue:"

and then the composition is **not text at all**. Page 56 carries **four embedded
images** — `extract_text()` yields 684 characters, the page has `lines: 0`, and
`extract_tables()` returns nothing — two of them exactly where the composition
belongs. It is a **picture of a table**, which is why the first two extraction
passes dropped it. Rendering the page and reading it gives the composition in
full:

```text
Descripción             Campos   ID         Longitud   Observación
Tipo de Documento       C002     iTiDE      2          completar con cero a la izquierda hasta 2 dígitos
RUC del Emisor          D101     dRucEm     8          completar con ceros a la izquierda si es menor a 8
DV del Emisor           D102     dDVEmi     1          Dígito Verificador del RUC del emisor
Establecimiento         C005     dEst       3          Establecimiento
Punto de Expedición     C006     dPunExp    3          Punto de Expedición en donde es emitido el DE
Número de Documento     C007     dNumDoc    7          completar con ceros a la izquierda hasta 7 dígitos
Tipo de Contribuyente   D103     iTipCont   1          Tipo de contribuyente, código correspondiente
Fecha de Emisión        D002     dFeEmiDE   8          tomar el campo, solo el formato AAAAMMDD
Tipo de Emisión         B002     iTipEmi    1          Tipo de emisión según lo establecido en el campo
Código de Seguridad     B004     dCodSeg    9          número aleatorio generado conforme a este MT
Dígito Verificador      A003     dDVId      1          resultado de aplicar el algoritmo Módulo 11
Longitud del CDC                          44
```

**The Manual's own worked example decomposes exactly into those widths**, which
is what turns the KuDE specimen from a length check into a decomposition:

```text
01 | 44444401 | 7 | 001 | 001 | 0014528 | 2 | 20170125 | 1 | 587326098 | 8
1    2          3   4     5     6         7   8          9   10          11
= 01444444017001001001452822017012515873260988   (44)
```

and that string is **byte-identical to the KuDE specimen §22.9 previously
recorded as `0144 4444 0170 0100 1001 4528 2201 7012 5158 7326 0988`**, so the
two sources corroborate each other. The widths sum to
`2+8+1+3+3+7+1+8+1+9+1 = 44`, which is `tCDC`'s length.

**The check digit is still NOT pinned, and it is now the ONLY part of the CDC
that is not.** §10.2 says:

> "Para el cálculo del dígito verificador del código de control se debe utilizar
> el **módulo 11**, con el cual se determina su validez. La documentación acerca
> de cómo generar este dígito, la cual se basa en la conformación antes
> descripta, se encuentra en la siguiente dirección: [digito-verificador.pdf]"

The modulus is named; the weight sequence, the treatment of the remainder and
the rule for the resulting digit live in that document, and **its published URL
now serves an HTML portal page**:
`https://www.set.gov.py/portal/PARAGUAY-SET/detail?content-id=/repository/collaboration/sites/PARAGUAY-SET/documents/herramientas/digito-verificador.pdf`
returns **HTTP 200, `text/html`, 197,272 bytes**, with no reference to the
document anywhere in it, and neither e-kuatia page links to it either.

**How narrow the gap is.** A scan of the whole Manual and of all 27 Notas
Técnicas for 44-digit runs finds only **three**, and two of them are unusable
(the all-zero placeholder, and a truncated paste of the §7.2.2.1 signature
example). That leaves **one usable specimen**, the worked example above, with
`dDVId = 8`. Candidate variants were then tested against it:

```text
r = sum(digits) mod 11; DV = (r == 0) ? 0 : 11 - r        -> 8   matches
weights 2..7 repeating FROM THE RIGHT, mod 11             -> 4
weights 2..7 repeating FROM THE LEFT, mod 11              -> 0
```

So the plain-sum variant reproduces the specimen, and the RUC-style weighting
does not — **but one equation does not fix a variant**, and the Manual never
states which one it uses. Deriving the algorithm from a single data point is
exactly the guessing this vault forbids, so the gap stays open. It is now
narrowed from "nothing is known" to "`módulo 11` with one of a small number of
variants, one of which reproduces the only specimen we have".

**Consequences, recorded rather than worked around:**

1. **The generator still takes the CDC and `dDVId` as inputs** — but the reason
   has changed. It is no longer "we do not know how to build one"; it is that
   **composing a CDC means publishing a document identity whose check digit we
   cannot verify**, and an identity error is not recoverable by re-sending: the
   Manual's §6.5 requires a rejected DE to be resubmitted with the SAME CDC. So
   the seam stays where it is until the verifier document is retrieved or a
   second independent specimen confirms a variant.
2. **Two retrieval paths remain**, both cheap: find the `digito-verificador.pdf`
   on the DNIT/SET portal under its current URL (the old one is now the portal
   shell), and — if the Manual's KuDE chapter prints more worked CDCs than the
   text scan could see, since those are graphics too — render chapter 13's pages
   as images the same way page 56 was read here. **A second specimen is the
   cheapest fix and a rendered page is the cheapest source of one.**
3. **The composition is evidence and the specimen is now a decomposition.** The
   field order and the widths no longer rest on inference: the Manual's table
   and its worked example agree with each other and sum to 44.

### 22.10 Notas Técnicas 001–022: which of them amend DE rules

All 27 notes were retrieved on 2026-10-04 (001–027) and their text extracted
locally. This section records the profile that matters to [[FISC-008]]: **which
of the earlier notes touch the DE**, because §22.3 and §22.4 were read from the
Manual Técnico, which is dated **10/09/2019**, and every note is titled
"Correcciones y ajustes sobre el MT versión 150".

**Eighteen of the twenty-seven touch DE fields, and ten amend validations.** The
Manual's field-level rules are therefore a **2019 baseline that later notes have
amended in part**, and none of them may be encoded as if it were current.

| NT  | Date       | DE field codes it mentions                                                                              | Amends a validation?                           |
| --- | ---------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 001 | —          | D002, E711, E721                                                                                        | —                                              |
| 002 | 16/07/2020 | **D200, D201, D202, D208, D210**                                                                        | —                                              |
| 003 | 18/11/2020 | **D200, D202**, D213, D219, D223                                                                        | —                                              |
| 004 | 29/12/2020 | none                                                                                                    | —                                              |
| 005 | 09/02/2021 | D200, D204, E960, E965, E967                                                                            | —                                              |
| 006 | 25/03/2021 | D010, D099                                                                                              | —                                              |
| 007 | 01/02/2022 | none (KuDE)                                                                                             | —                                              |
| 008 | 21/09/2021 | **D015, D017, D018**, E701                                                                              | —                                              |
| 009 | 09/09/2021 | E700, E701, E708, E899                                                                                  | —                                              |
| 010 | 04/02/2022 | **D010, D011, D012, D099, D140, D141, D142, D160, D200, D201, D202, D208, D219, D220, D299**, E500–E967 | —                                              |
| 011 | 20/10/2022 | none (services)                                                                                         | —                                              |
| 012 | 21/02/2023 | D010, **D015**, D022, D099                                                                              | **yes** — adds a currency validation on `D022` |
| 013 | 20/03/2023 | D013, E730–E739                                                                                         | **yes** — adds fields and a validation         |
| 014 | 20/03/2023 | **D208**                                                                                                | —                                              |
| 015 | 14/08/2023 | none (events)                                                                                           | **yes** (events)                               |
| 016 | 14/08/2023 | none (services)                                                                                         | —                                              |
| 017 | 17/11/2023 | **D200, D221, D222, D223, D224, D299**                                                                  | —                                              |
| 018 | 17/11/2023 | D010, D030, D031, D032, D040, D099                                                                      | adds a subgroup                                |
| 019 | 17/11/2023 | none (events)                                                                                           | **yes** (events)                               |
| 020 | 17/11/2023 | **D200, D202, D206, D299**, E820, E829                                                                  | **yes**                                        |
| 021 | 29/12/2023 | **D011, D200, D208, D299**                                                                              | **yes**                                        |
| 022 | 09/02/2024 | D030, D031, D040                                                                                        | **yes** — RG90 imputation                      |
| 023 | 27/08/2024 | **D200, D201, D202, D208, D210**, E700–E899                                                             | **yes**                                        |
| 024 | 17/12/2024 | **D011, D200, D208, D299**                                                                              | **yes**                                        |
| 025 | 23/04/2024 | none                                                                                                    | **excludes** `GEC002c`                         |
| 026 | 06/06/2025 | D202, E010–E899                                                                                         | **excludes** four B2G rules                    |
| 027 | 09/03/2026 | none (event)                                                                                            | **yes** (event)                                |

**The receptor block is the most amended part of the DE.** `D200`, `D201`,
`D202`, `D208` and `D210` — the fields §22.3 pins — are touched by **NT 002,
003, 010, 014, 017, 020, 021, 023 and 024**: nine notes, spanning 2020 to 2024.
FISC-006 already recorded NT 24 amending `D208c` (code 1321) about the
receptor's identity document type and a 7,000,000 threshold, and that is one of
nine. **§22.3 must therefore be treated as a historical baseline, not as the
current rule set**, until those nine notes are read field by field.

The other DE areas with amendment history: the currency and exchange fields
(`D015`, `D017`, `D018` — NT 008, and a new validation on `D022` in NT 012), the
emitter's activity and imputation fields (`D030`, `D031`, `D040` — NT 018 and NT
022), the item fields (`E700`–`E899` — NT 009, 010, 013, 023, 026), and the
titles (`D011` — NT 021, 024).

**What this section does and does not claim.** It claims, with the notes in
hand, _which_ notes touch _which_ DE fields and which amend validations. The
receptor block's rule text **is** transcribed, in §22.11, and the four
non-receptor areas were transcribed on 2026-10-05 in **§22.12** (currency and
exchange), **§22.13** (titles, transaction type and affected obligations) and
**§22.14** (items). **Every DE area this profile names now has its rule text
recorded**, with one exception: the notes whose only effect is on _events_ — NT
018's transport-update rules, NT 019 and NT 027 — which belong to [[FISC-010]]
rather than to the DE.

### 22.11 The receptor block's current rules, with their amendment trail

§22.3 recorded the receptor block from the Manual. This section records it
**consolidated through the nine notes that amend it**, and it is the section
[[FISC-008]] must implement. Every rule below is quoted from the note that last
touched it.

**Field conditions, as last set by NT 023 (27/08/2024):**

```text
D208 iTipIDRec  Obligatorio si D201 = 2 y D202 != 4
                No informar si D201 = 1
                1 Cédula paraguaya  2 Pasaporte  3 Cédula extranjera
                4 Carnet de residencia  5 Innominado
                6 Tarjeta Diplomática de exoneración fiscal  9 Otro
D210 dNumIDRec  Obligatorio si D201 = 2 y D202 != 4 ; No informar si D201 = 1
                length 1-20 ; "En caso de DE innominado, completar con 0 (cero)"
```

**The one substantive delta from §22.3, and it matters.** The Manual and NT 002
both read `No informar si D201 = 1 o D202=4`. **NT 023 removed the `o D202=4`
clause**: the receptor's identity document is now forbidden _only_ when the
receptor is a contributor. For a B2C document the field is neither required nor
forbidden — and NT 010's `D208b` (1319) and NT 023's `D208f` (1333) are what
actually constrain `Innominado` by operation type. Implementing §22.3's old
condition would have made a B2C document with a receptor document invalid, which
the current rules allow.

**NT 003 (18/11/2020)** moved two geographic conditions onto the fields
themselves and **excluded** the validations that used to enforce them:

```text
D219 cDepRec   Obligatorio si se informa D213 y D202 != 4 ; no informar si D202 = 4
D223 cCiuRec   Obligatorio si se informa D213 y D202 != 4 ; no informar si D202 = 4
  EXCLUDED: D219 / 1324  "Es obligatorio informar el departamento del receptor"
  EXCLUDED: D223 / 1327  "Es obligatorio informar la ciudad del receptor"
```

**Validations in force, with the note that last set each:**

| Id      | Code | Condition                                                                                                                                           | Last set by |
| ------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `D202`  | 1300 | if the receptor is a non-contributor (`D201=2`), the operation type must be B2C (`D202=2`) or B2F (`D202=4`)                                        | NT 010      |
| `D202b` | 1332 | if the receptor's RUC (`D206`) is an Organismo o Entidad del Estado, the operation type must be B2G (`D202=3`)                                      | NT 020      |
| `D208b` | 1319 | `D208` cannot be `Innominado` (5) when `D202 != 2`                                                                                                  | NT 010      |
| `D208c` | 1321 | if `D011 != 13` (not Muestras médicas), `D208` cannot be 5 when the total in guaraníes is **>= 7,000,000** (`F023 >= 7000000` or `F014 >= 7000000`) | **NT 024**  |
| `D208e` | 1331 | if the document type is Nota de Crédito, Nota de Débito **or Nota de Remisión** (`C002 = 5, 6, 7`), `D208 != 5`                                     | **NT 023**  |
| `D208f` | 1333 | `D208` cannot be 5 when `D202 != 2`                                                                                                                 | NT 023      |
| `D210`  | 1314 | if `D201=2` and `D202 != 4`, the identity document number must be informed                                                                          | NT 023      |
| `D220`  | 1325 | the receptor department description must match `D219`                                                                                               | NT 010      |
| `D222`  | 1326 | the receptor district description must match `D221`                                                                                                 | NT 017      |
| `D224`  | 1329 | the receptor city description must match `D223`                                                                                                     | NT 017      |

**Two corrections to earlier records, both verified against the note text:**

1. **NT 021 (29/12/2023) set `D208c`'s threshold at 35,000,000**, and **NT 024
   (17/12/2024) lowered it to 7,000,000**, citing "el inciso ii), Numeral 2 del
   Artículo N° 6 del Decreto N° 872/2023" while NT 021 cited Numeral 1.
   FISC-006's record of "7,000,000" attributed to NT 24 was **correct**; this
   retrieval confirms it and shows the intermediate value, so a reader who finds
   NT 021 alone does not conclude that 35,000,000 is current.
2. **NT 002 (16/07/2020) excluded `D208d` (1322) and `D210a` (1323)**, the two
   validations that forbade the receptor document when `D201=1` or `D202=4`.
   That is the same change NT 023 later completed at the field level, which is
   why the `No informar` clause and those validations must not both be
   implemented.

**What this section does not claim.** It transcribes the receptor block's rules
and their amendment trail, and it stops there. The other DE areas §22.10 lists —
currency and exchange (`D015`/`D017`/`D018`/`D022`), emitter activity and
imputation (`D030`–`D040`), items (`E700`–`E899`) and titles (`D011`) — were
**transcribed on 2026-10-05 in §22.12, §22.13 and §22.14**, so §22.4's rules for
them are no longer the only record. What no section here claims is that the
_code_ implements them: §22.12's `D208c` correction and §22.14's item formulas
are rules FISC-008's builder does not yet encode.

### 22.12 Currency and exchange: `D015`, `D017`, `D018`, `D022`, `F023`

**Transcribed 2026-10-05 from the note text.** §22.4 read these fields from the
2019 Manual and §22.10 flagged them as provisional; this section closes that for
currency and exchange, which is what a confirmed invoice's `currency` and any
exchange rate must satisfy.

**NT 008 (21/09/2021) rewrote `F023`'s formulas.** `F023 dTotalGs` is "Total
general de la operación en Guaraníes" and the note gives it as an arithmetic
rule rather than a free total:

```text
F023 dTotalGs   Total general de la operación en Guaraníes        N 1-15p(0-8)  0-1
  Si D015 != PYG y D017 = 1  ->  corresponde al cálculo aritmético: F014 * D018
  Si D015 != PYG y D017 = 2  ->  corresponde a la suma de todas las ocurrencias de EA009
  No informar si D015 = PYG
  Cuando C002 = 4 corresponde a F014
```

Two consequences that matter beyond `F023` itself:

- **`D017` has two values, not one.** `1` means a single global rate and `2`
  means per item — matching `tdCondTiCam`'s enumerations, which
  `DE_Types_v150.xsd` states as `1 GLOBAL` and `2 POR ITEM`. So the conditional
  rule in §22.4 ("`D018` obligatory if `D017 = 1`") applies to the global case
  only; when `D017 = 2` the rate is per item.
- **`F023` must NOT be informed when `D015 = PYG`.** So a PYG document has no
  guaraníes total at all, and anything that compares against it has to switch
  fields. §22.11's `D208c` is exactly that case — see the correction below.

**NT 012 (21/02/2023) added one validation, `D022`/1213:**

```text
D022  Moneda de la operación no corresponde al tipo de documento informado   1213
      Si el tipo de documento informado es Autofactura Electrónica (C002 = 4)
      la moneda de la operación debe ser igual a PYG (D015 = PYG)
      Observación: conforme al Dictamen DEINT N° 344 de 27/12/2022
```

**A correction to §22.11, from NT 021's and NT 024's own text.** §22.11 recorded
`D208c`/1321 as "`D208` cannot be 5 when the total in guaraníes is >= 7,000,000
(`F023 >= 7000000` or `F014 >= 7000000`)". The notes state the condition **field
by field**, and it is not two alternatives for the same document:

```text
NT 021 (35.000.000) and NT 024 (7.000.000), verbatim:
  "... no puede ser Innominado (D208 != 5) cuando el total general de la
   operación EN GUARANÍES (cuando la moneda es EXTRANJERA) o el total general
   de la operación (cuando la moneda es PYG) es mayor o igual a ..."
```

So it is **one field selected by the currency**: `F023` when `D015 != PYG`, and
`F014` when `D015 = PYG` — which is consistent with NT 008's "`F023` no informar
si `D015 = PYG`", because for a PYG document `F023` does not exist to compare.
Reading the two field names as a disjunction would over-reject nothing but would
also make the PYG case compare a field the document must not carry.

**`dSisFact` has a second recorded value.** NT 010 gives it as
`1 = Sistema de facturación del contribuyente, 2 = SIFEN solución gratuita`,
while `DE_v150.xsd` constrains it with `maxInclusive value="1"`. FISC-008 emits
`1`, which is correct for an issuer's own system, and the schema is the stricter
authority; the discrepancy is recorded rather than resolved.

### 22.13 Titles, transaction type and affected obligations: `D011`, `D012`, `D030`–`D040`

**NT 010 (04/02/2022) pins the `D011` -> `D012` pairing**, which §21.5 recorded
only as "13 transaction types":

```text
D011 iTipTra      Tipo de transacción        1..13
D012 dDesTipTra   Descripción del tipo de transacción   A 5-39  0-1
                  Obligatorio si existe el campo D011
  1 "Venta de mercadería"                       8  "Donación"
  2 "Prestación de servicios"                   9  "Anticipo"
  3 "Mixto (Venta de mercadería y servicios)"   10 "Compra de productos"
  4 "Venta de activo fijo"                      11 "Compra de servicios"
  5 "Venta de divisas"                          12 "Venta de crédito fiscal"
  6 "Compra de divisas"                         13 "Muestras médicas (Art. 3 RG 24/2014)"
  7 "Promoción o entrega de muestras"
```

`13` is the value §22.11's `D208c` excludes from the `Innominado` prohibition,
so this table and that validation are the same fact seen from two sides.

**NT 018 (17/11/2023) added the affected-obligations subgroup and its
catalogue.** Inside "campos inherentes a la operación comercial (`D010`-`D099`)"
— which is `gOpeCom`, the same placement FISC-008's builder uses:

```text
D030 gOblAfe     Grupo de campos que identifican las obligaciones afectadas  D010  G  0-11
D031 cOblAfe     Código de la obligación afectada        D030  N  3     1-1  Según Tabla 12
D032 dDesOblAfe  Descripción de la obligación afectada   D030  A  21-65 1-1  Referente a D031
```

Note the occurrence bound: the note says **`0-11`** while `DE_v150.xsd` declares
`gOblAfe` with `maxOccurs="12"`. The schema is the structural authority, so 12
is the bound the validator enforces; the note's 11 is recorded here as the
Manual's wording.

**Two validations, both new in NT 018, and the catalogue they need:**

```text
D031  Código de la obligación afectada inexistente                        1220
      Debe ser un código según la tabla 12 - Tipo de obligaciones
D032  Descripción de la obligación afectada no corresponde al código      1221
      Descripción no coincidente con lo informado en D031
```

```text
TABLA 12 - TIPO DE OBLIGACIONES   (printed in NT 018, verbatim order)
113  IMPUESTO A LA RENTA IRACIS - REGÍMENES ESPECIALES
143  TRIBUTO UNICO MAQUILA
211  IMPUESTO AL VALOR AGREGADO - GRAVADAS Y EXONERADAS - EXPORTADORES
311  IMPUESTO SELECTIVO AL CONSUMO - GENERAL
321  IMPUESTO SELECTIVO AL CONSUMO COMBUSTIBLES
700  IMPUESTO A LA RENTA EMPRESARIAL - RÉGIMEN GENERAL
701  IMPUESTO A LA RENTA EMPRESARIAL - SIMPLE
703  IMPUESTO DE ZONA FRANCA
702  IMPUESTO A LA RENTA EMPRESARIAL - RESIMPLE
715  IMPUESTO A LA RENTA PERSONAL - SERVICIOS PERSONALES
716  IMPUESTO A LA RENTA PERSONAL - RENTAS Y GANANCIAS DE CAPITAL
```

**NT 022 (09/02/2024) added one more, `D031a`/1222:** "Cuando se informa el
campo `D031` no se permite repetir los códigos en el mismo documento."

**What NT 018 also touches but this Story does not implement:** the same note
adds eleven validations to the **transport-update event** (`GET022`-`GET030`,
codes `4325`-`4335`) and one to `GET002`/`4336`. Those are event rules, not DE
rules — [[FISC-010]]'s territory — and are recorded here only so a reader does
not think they were missed.

### 22.14 Items: `E700`-`E899`

**Transcribed 2026-10-05.** This is the area WU-C's mapping needs most, because
a confirmed invoice's lines become `gCamItem`.

**The item's own fields, as last set by NT 009 (09/09/2021):**

```text
E701 dCodInt      Código interno                            A 1-50   1-1
      "No se pueden tener ítems distintos de mercadería o servicio con el mismo
       código interno en su catastro de productos o servicios. Este código se
       puede repetir en el DE siempre que el producto o servicio sea el mismo."
E708 dDesProSer   Descripción del producto y/o servicio     A 1-2000 1-1
      "Equivalente a nombre del producto establecido en la RG 24/2019"
```

Both lengths are already what `DE_Types_v150.xsd` carries (`tdCodInt` 1-50, and
`dDesProSer`'s inline `1-2000`), so NT 009 is **reflected in the current
schema** — the two sources agree, and the note is the reason the widths are what
they are.

**NT 023 (27/08/2024) widened the quantity:**

```text
E711 dCantProSer  Cantidad del producto y/o servicio  N 1-10p(0-8) 1-1
```

`tdCantProSer` in the schema is `totalDigits=18, fractionDigits=8` bounded to
`0..9999999999.99999999` — ten integer digits — so the schema and the note agree
again.

**NT 013 (20/03/2023) pins the per-item IVA arithmetic, with formulas.** This is
the part that makes `gCamIVA` computable rather than guessed:

```text
E735 dBasGravIVA  Base gravada del IVA por ítem  N 1-15p(0-8) 1-1
  Si E731 = 1 o 4  ->  [100 * EA008 * E733] / [10000 + (E734 * E733)]
  Si E731 = 2 o 3  ->  0

E737 dBasExe      Base Exenta por ítem           N 1-15p(0-8) 1-1   (NEW in NT 013)
  Si E731 = 4      ->  [100 * EA008 * (100 - E733)] / [10000 + (E734 * E733)]
  Si E731 = 1, 2 o 3 ->  0
```

and the totals those feed:

```text
F002 dSubExe  Subtotal de la operación exenta   N 1-15p(0-8) 0-1
  Suma de todas las ocurrencias de EA008 cuando E731 = 3
  + todas las ocurrencias de E737 cuando E731 = 4

F004 dSub5    Subtotal con IVA incluido al 5%   N 1-15p(0-8) 0-1
  Suma de EA008 cuando E734 = 5 y E731 = 1
  + suma de (E735 + E736) cuando E734 = 5 y E731 = 4
  No debe existir el campo si D013 != 1 o D013 != 5

F005 dSub10   Subtotal con IVA incluido al 10%  N 1-15p(0-8) 0-1
  Suma de EA008 cuando E734 = 10 y E731 = 1
  + suma de (E735 + E736) cuando E734 = 10 y E731 = 4
  No debe existir el campo si D013 != 1 o D013 != 5
```

**The validations that enforce them**, all from NT 013:

| Id      | Code | Condition                                           |
| ------- | ---- | --------------------------------------------------- |
| `E735a` | 1910 | if `E734 = 5`, `E735` must equal the formula above  |
| `E735b` | 1911 | if `E734 = 10`, `E735` must equal the formula above |
| `E737`  | 1921 | `E737` must equal its formula, or 0                 |
| `F002a` | 2353 | `F002` must equal the sum defined above             |
| `F004a` | 2357 | `F004` must equal the sum defined above             |
| `F005a` | 2359 | `F005` must equal the sum defined above             |

Note `E731` is `iAfecIVA` (`1..4`) and `E734` is the IVA rate, so the formulas
are keyed on the affectation and the rate — which is exactly the pair a
confirmed invoice line's `rateCode` resolves to.

**NT 010 also reshaped the merchandise-tracking subgroup `E750`-`E761`**
(`E751 dNumLote` 1-80, `E756 dNomImp` 4-60, `E757 dDirImp` 1-255, `E758 dNumFir`
20, `E759`/`E760 dNumReg`/`dNumRegEntCom` 1-20, `E761 dNomPro` 1-30), all `0-1`
and tied to agrochemical registration obligations (RG 16/2019, RG 106/2021,
SENAVE). **NT 023 also changed `E791 gGrupEner` to `0-9` occurrences and
`E797 dConKwh` to `N 1-11p2`.** These are conditional subgroups of the item;
they are recorded so the shapes are known, not because FISC-008 encodes their
conditions.

**NT 026 (06/06/2025) is already recorded in §22.7** and is the only item-area
note whose effect is an _exclusion_: the four B2G/DNCP rules (`E020`/1400,
`E020a`/1401, `E704`/1800, `E705`/1801) were removed, so a B2G document must not
be rejected for a missing `gCompPub` or DNCP code.

**What this closes, and what it does not.** The four non-receptor areas §22.10
listed as provisional are now transcribed: currency and exchange (§22.12),
titles and affected obligations (§22.13) and items (§22.14). **The rule text of
Notas Técnicas 001–022 is therefore transcribed for every area FISC-008 or its
mapping touches**, except the notes whose only effect is on events (NT 018's
transport rules, NT 019, NT 027) — those belong to [[FISC-010]].

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
`DE_Ekuatiai_v150.xsd`.

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

1. **Notas Técnicas 26 and 27.** The portal lists them; their clauses are
   unknown, and they may amend what NT 23/24/25 left.
2. `DE_Types_v150.xsd`: per-field lengths, patterns and enumerations.
3. The full `dCodRes` catalogue from chapter 12.
4. The WSDL documents: SOAP actions, bindings, header requirements.
5. The batch size limit for asynchronous reception.
6. The QR composition and the CSC's per-environment value.
7. The tables' contents, and chapter 16's codifications.
8. Whether the Prevalidador is usable in an automated pre-submission check.

Resolved since the first pass, and no longer open: the signature profile, the
certificate standard and its F1/F2 types, the transport stack, the endpoint
list, the result model and its three states, the deadlines, the CDC-reuse rule,
the timbrado and numbering model, the test environment and its test data, the
contingency question — answered by DNIT's own statement that it is undefined —
and **the clauses of Notas Técnicas 23, 24 and 25**.

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

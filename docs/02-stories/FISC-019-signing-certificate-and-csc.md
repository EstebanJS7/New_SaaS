---
id: FISC-019
type: story
title: Signing certificate and CSC from the fiscal settings screen
epic: EPIC-16
status: in-progress
priority: high
depends_on: [FISC-007, FISC-018]
prd_sections: []
permissions: [fiscal.signing_material.manage]
branch: docs/dec-095-fiscal-issuance-point
created: 2026-11-09
updated: 2026-11-09
---

# FISC-019 — Certificado de firma y CSC desde «Configuración fiscal»

## Objetivo

Que Propietario y Administración suban y retiren el certificado de firma y
carguen y retiren el CSC desde la aplicación, para que una factura electrónica
quede aprobada y una anulación emita la nota de crédito. Tercera entrega de
[[DEC-095]].

## Contexto

- El certificado ya tiene API ([[FISC-007]], [[ADR-005]]): `POST`/`GET`
  `/fiscal/signing-material` (multipart PKCS#12 + contraseña + ambiente, tope 64
  KiB) y `POST /fiscal/signing-material/:id/retire`, bajo
  `fiscal.signing_material.manage`. La clave privada vive cifrada en
  `tenant_secret`; la contraseña nunca se guarda. FISC-007 dejó la web fuera de
  alcance.
- El CSC tiene tabla (`tenant_fiscal_csc`, valor en `tenant_secret` por
  `secretRef`, hasta dos activos por ambiente) y lector en el worker
  (`CSC_UNAVAILABLE`), pero **ninguna ruta lo escribe**.
- El CSC usa el mismo permiso que el certificado: los dos son secretos que
  autentican al contribuyente ante SIFEN; no hace falta una función nueva.

## En alcance

- API CSC: `POST /fiscal/csc`, `GET /fiscal/csc`, `POST /fiscal/csc/:id/retire`.
- Proxy web: rutas de certificado (incluida la subida multipart) y de CSC.
- Secciones «Certificado de firma» y «CSC» en «Configuración fiscal».
- Carril de navegador con el worker fiscal y el proveedor simulado; prueba de
  NCE-001.

## Fuera de alcance

- Cambiar cómo se guarda o se valida el certificado (FISC-007).
- El proveedor SIFEN real y la habilitación.

## Criterios de aceptación

### API CSC

- [x] `POST /fiscal/csc` con cuerpo estricto `{ environment, idCsc, value }`:
      ambiente `TEST|PRODUCTION`, `idCsc` con el formato de SIFEN (4 caracteres,
      ver SIFEN-BASELINE §24), valor de 32 caracteres alfanuméricos. El valor se
      guarda solo en el almacén de secretos y nunca se devuelve, se registra en
      logs ni entra en la auditoría.
- [x] Un `idCsc` ya activo en ese ambiente, o un tercer CSC activo, es `409` sin
      escribir nada (ni fila ni secreto).
- [x] `GET /fiscal/csc` lista solo metadatos (id, ambiente, idCsc, estado,
      fechas).
- [x] `POST /fiscal/csc/:id/retire` con motivo: destruye el secreto en la misma
      transacción y conserva la fila; id de otro tenant o inexistente `404`; ya
      retirado `409`.
- [x] Auditoría `fiscal.csc.loaded` / `fiscal.csc.retired` con
      `{ environment, idCsc }` únicamente.
- [x] Las tres rutas exigen la función `fiscal` y
      `fiscal.signing_material.manage`; figuran en el probe de permisos.
- [x] El lector del worker encuentra el CSC cargado por la ruta (live-pg o
      integración), sin SQL directo.

### Web

- [ ] El proxy agrega exactamente: `GET`/`POST signing-material` (la subida
      reenvía el multipart sin leer el archivo ni la contraseña),
      `POST     signing-material/:id/retire`, `GET`/`POST csc`,
      `POST csc/:id/retire`; ids solo UUID; el resto sigue rechazado.
- [ ] «Certificado de firma»: subir (archivo, contraseña, ambiente), listar
      metadatos, retirar con motivo y confirmación. La contraseña no queda en el
      estado ni en el DOM después del envío.
- [ ] «CSC»: cargar (idCsc y valor enmascarado), listar, retirar con motivo y
      confirmación. El valor no queda en el estado ni en el DOM después del
      envío.
- [ ] Sin `fiscal.signing_material.manage`, esas dos secciones muestran un
      estado de permiso; el resto de la pantalla sigue funcionando.
- [ ] Estados de carga, vacío, error y éxito; textos es-PY; tokens semánticos.

### Navegador

- [ ] El carril da a la API y al worker fiscal el mismo
      `SECRET_STORE_MASTER_KEYS`, con `FISCAL_PROVIDER=fake` y
      `SIFEN_ENVIRONMENT=TEST`.
- [ ] Una spec sube un certificado generado en tiempo de ejecución (RUC del
      perfil), carga un CSC, confirma una factura electrónica que llega a
      `APPROVED` y anula la venta: la UI muestra la nota de crédito (cierra el
      criterio de navegador de [[NCE-001]]).

### Seguridad

- [ ] Verificación independiente y revisión propia de la entrega (riesgo alto,
      ítem 2).

## Implementation progress (resumed session)

- Added CSC controller/service and strict request schemas in `apps/api/src/fiscal/csc/`;
  registered all three routes and their existing signing-material permission in the route probe.
- Metadata-only responses, tenant-scoped reads, transactional load/retirement and minimal audits
  are covered by 10 focused unit tests; 27 permission/route-probe tests also pass.
- Loads use a SERIALIZABLE transaction: the existing migration explicitly records that its
  two-active trigger alone cannot prevent a READ COMMITTED concurrent-insert race.
- Local API typecheck, focused ESLint and `git diff --check` pass. Initial type/probe failures
  were corrected; no prior RED evidence is claimed for the recovered FISC-018 edits.
- Encrypted HTTP/worker-reader integration and the concurrent two-active cap now pass on
  disposable PostgreSQL. Proxy multipart passthrough and secret-clearing forms are implemented;
  the combined settings/proxy suite passes 51 tests. The API gate at the CSC snapshot passed
  2384 unit tests, 282 live-pg tests, lint, typecheck and build.
- Still pending: current full suites after FISC-020 changes, NCE-001 browser flow, differentials,
  independent verification and native review. DEC-097 proposes the final missing public
  declaration (catalog unit); it is not silently added to this Story.
- Initial live-pg invocation failed on absent `DATABASE_URL_TEST`; rerun against the documented
  disposable PostgreSQL at port 55432 passed. A generated test-only key selected the encrypted
  store. The user supplied the secrets-module code directly after the guard blocked its path;
  no alternate read or guard bypass was attempted and no application database was used.
- No migration, commit, push or PR was created in this resumed session. Acceptance criteria
  remain unchecked until the required public-interface and security proof is observed.

## Verificación (API CSC, 2026-11-09)

Observed on branch `docs/dec-095-fiscal-issuance-point`, uncommitted tree:

- RED: `src/fiscal/csc/csc.test.ts` 4 failed / 6 passed before the service
  change (stable conflict messages, `fcsc_` prefix, row-before-secret order,
  `retirementReason`); `secret-keys.test.ts` 1 failed before `fiscalCsc`.
  Mutation check: disabling the trigger mapping turns the live-pg third-CSC
  `409` into `500`.
- GREEN: `vitest run src/fiscal src/rbac` 286 passed; `@newsaas/secret-store`
  51 passed; `apps/api pnpm test` 2125 passed, 276 skipped; build ok;
  `test:live-pg` 282 passed, including «FISC-019 CSC routes» (encrypted
  `EnvelopeSecretStore`, worker reader returns the loaded value, tenant
  isolation, duplicate and trigger `409` with row/secret/audit counts unchanged,
  concurrent load `201`/`409`).
- `tsc --noEmit` (api, secret-store), ESLint and Prettier on changed files: clean.
- Limits: no browser/web criteria in this unit; the in-memory unit fake
  emulates the database rules, which live-pg proves for real.

## Decisiones / ADRs

- [[ADR-005]], [[DEC-057]], [[DEC-090]], [[DEC-095]]

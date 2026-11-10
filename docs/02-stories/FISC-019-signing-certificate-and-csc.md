---
id: FISC-019
type: story
title: Signing certificate and CSC from the fiscal settings screen
epic: EPIC-16
status: done
priority: high
depends_on: [FISC-007, FISC-018]
prd_sections: []
permissions: [fiscal.signing_material.manage]
branch: docs/dec-095-fiscal-issuance-point
created: 2026-11-09
updated: 2026-11-10
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

- [x] El proxy agrega exactamente: `GET`/`POST signing-material` (la subida
      reenvía el multipart sin leer el archivo ni la contraseña),
      `POST     signing-material/:id/retire`, `GET`/`POST csc`,
      `POST csc/:id/retire`; ids solo UUID; el resto sigue rechazado.
- [x] «Certificado de firma»: subir (archivo, contraseña, ambiente), listar
      metadatos, retirar con motivo y confirmación. La contraseña no queda en el
      estado ni en el DOM después del envío.
- [x] «CSC»: cargar (idCsc y valor enmascarado), listar, retirar con motivo y
      confirmación. El valor no queda en el estado ni en el DOM después del
      envío.
- [x] Sin `fiscal.signing_material.manage`, esas dos secciones muestran un
      estado de permiso; el resto de la pantalla sigue funcionando.
- [x] Estados de carga, vacío, error y éxito; textos es-PY; tokens semánticos.

### Navegador

- [x] El carril da a la API y al worker fiscal el mismo
      `SECRET_STORE_MASTER_KEYS`, con `FISCAL_PROVIDER=fake` y
      `SIFEN_ENVIRONMENT=TEST`. (2026-11-09: `playwright.config.ts` genera la
      clave por corrida y `support/fiscal-worker.ts` lanza el worker con esas
      variables; con el proveedor fake el worker no descifra nada, así que el
      descifrado compartido no queda ejercitado por esta spec.)
- [x] Una spec sube un certificado generado en tiempo de ejecución (RUC del
      perfil), carga un CSC, confirma una factura electrónica que llega a
      `APPROVED` y anula la venta: la UI muestra la nota de crédito (cierra el
      criterio de navegador de [[NCE-001]]). Bloqueado 2026-11-09 por un defecto
      del worker: con `FISCAL_PROVIDER=fake` (`requiresSignedDocument = false`)
      `stageDocument` devuelve `READY` sin pasar `SIGNING → SENDING`, y
      `persistResult` solo actualiza filas en `SENDING`; el documento queda en
      `SIGNING` y el job termina sin error
      (`apps/worker/src/fiscal-submission/fiscal-submission.handler.ts`). La
      spec `apps/e2e/specs/electronic-credit-note.spec.ts` recorre toda la
      configuración por la UI/BFF y falla esperando `APPROVED`.

### Seguridad

- [x] Verificación independiente y revisión propia de la entrega (riesgo alto,
      ítem 2).

## Implementation progress (resumed session)

- Added CSC controller/service and strict request schemas in
  `apps/api/src/fiscal/csc/`; registered all three routes and their existing
  signing-material permission in the route probe.
- Metadata-only responses, tenant-scoped reads, transactional load/retirement
  and minimal audits are covered by 10 focused unit tests; 27
  permission/route-probe tests also pass.
- Loads use a SERIALIZABLE transaction: the existing migration explicitly
  records that its two-active trigger alone cannot prevent a READ COMMITTED
  concurrent-insert race.
- Local API typecheck, focused ESLint and `git diff --check` pass. Initial
  type/probe failures were corrected; no prior RED evidence is claimed for the
  recovered FISC-018 edits.
- Encrypted HTTP/worker-reader integration and the concurrent two-active cap now
  pass on disposable PostgreSQL. Proxy multipart passthrough and secret-clearing
  forms are implemented; the combined settings/proxy suite passes 51 tests. The
  API gate at the CSC snapshot passed 2384 unit tests, 282 live-pg tests, lint,
  typecheck and build.
- Still pending: current full suites after FISC-020 changes, NCE-001 browser
  flow, differentials, independent verification and native review. DEC-097
  proposes the final missing public declaration (catalog unit); it is not
  silently added to this Story.
- Initial live-pg invocation failed on absent `DATABASE_URL_TEST`; rerun against
  the documented disposable PostgreSQL at port 55432 passed. A generated
  test-only key selected the encrypted store. The user supplied the
  secrets-module code directly after the guard blocked its path; no alternate
  read or guard bypass was attempted and no application database was used.
- No migration, commit, push or PR was created in this resumed session.
  Acceptance criteria remain unchecked until the required public-interface and
  security proof is observed.

## Verificación (API CSC, 2026-11-09)

Observed on branch `docs/dec-095-fiscal-issuance-point`, uncommitted tree:

- RED: `src/fiscal/csc/csc.test.ts` 4 failed / 6 passed before the service
  change (stable conflict messages, `fcsc_` prefix, row-before-secret order,
  `retirementReason`); `secret-keys.test.ts` 1 failed before `fiscalCsc`.
  Mutation check: disabling the trigger mapping turns the live-pg third-CSC
  `409` into `500`.
- GREEN: `vitest run src/fiscal src/rbac` 286 passed; `@newsaas/secret-store` 51
  passed; `apps/api pnpm test` 2125 passed, 276 skipped; build ok;
  `test:live-pg` 282 passed, including «FISC-019 CSC routes» (encrypted
  `EnvelopeSecretStore`, worker reader returns the loaded value, tenant
  isolation, duplicate and trigger `409` with row/secret/audit counts unchanged,
  concurrent load `201`/`409`).
- `tsc --noEmit` (api, secret-store), ESLint and Prettier on changed files:
  clean.
- Limits: no browser/web criteria in this unit; the in-memory unit fake emulates
  the database rules, which live-pg proves for real.

## Conflicto al retirar un CSC

2026-11-10: un error Prisma `P2034` al retirar un CSC se convierte en
`409 CONFLICT`, con el mismo mensaje estable de concurrencia que al cargarlo:
`Another operation changed the CSCs at the same time; refresh and try again.` No
se reintenta la operación ni se incluye el error original en la respuesta. La
regresión inyecta el fallo después de actualizar la fila y eliminar el secreto:
la transacción revierte fila, secreto y auditoría. Otros errores conservan su
comportamiento. RED: 1 falla / 10 pasan; GREEN: CSC, signing-material y RBAC
111/111.

Risk: item 2 (manejo de errores en el ciclo de vida del secreto, sin cambiar la
transacción ni las reglas de autorización).

## Validación del identificador CSC

2026-11-10: el formulario acepta exactamente los cuatro caracteres ASCII `!`–`~`
que admite la API (`[\x21-\x7E]{4}`), sin transformar el identificador. El valor
secreto conserva su regla de 32 caracteres alfanuméricos. Regresión: `!~A1` se
envía sin cambios y se limpian ambos campos; identificadores cortos, largos, con
espacios, DEL o Unicode se rechazan sin petición de escritura. RED observado: 1
fallo / 10 pasan; GREEN: configuración fiscal web 31/31.

Risk: item 2 (validación del formulario de secretos; se mantiene la autoridad de
la API y la limpieza de los campos).

## Comportamiento conocido: orden de autorización

2026-11-10: se conserva el orden actual, aceptado por el usuario. En las rutas
CSC y signing-material, el guard de permisos del controlador se ejecuta antes
del chequeo de la función `fiscal` del servicio. Si faltan ambos, responde
`403 FORBIDDEN`, no `FEATURE_NOT_ENTITLED`. Con el permiso presente pero sin la
función se conserva `FEATURE_NOT_ENTITLED`. No se cambia ningún guard ni se
relaja el acceso a los secretos.

Risk: none (documentación del comportamiento existente; sin cambio de
ejecución).

## Límite del cuerpo JSON en el proxy web

2026-11-10: el proxy de `/api/fiscal` acepta cuerpos JSON de hasta **65536
bytes** (64 KiB) y, por encima, responde `413` estable antes de llamar a la API:

```json
{
  "error": {
    "code": "PAYLOAD_TOO_LARGE",
    "message": "Fiscal request body exceeds 65536 bytes."
  }
}
```

La respuesta no reenvía el cuerpo ni credenciales y el cuerpo rechazado no se
registra.

| Regla                     | Comportamiento                                                        |
| ------------------------- | --------------------------------------------------------------------- |
| Lectura                   | incremental desde `request.body`; se acumulan como máximo 65536 bytes |
| Tamaño medido             | bytes UTF-8 realmente leídos, no el `content-length` declarado        |
| `content-length`          | solo pista temprana: declarado > 65536 → 413 sin leer el cuerpo       |
| Exceso                    | se cancela el lector y se responde 413 sin ninguna petición upstream  |
| Límite exacto             | aceptado si el JSON es válido, incluso con relleno de espacios        |
| Multipart del certificado | sin cambios: sigue en streaming y sin tope JSON                       |
| GET                       | sin cambios: no lee ni reenvía cuerpo                                 |

El cuerpo dentro del límite se decodifica UTF-8 no fatal, igual que antes con
`request.text()`, así que el texto que llega a la API es el mismo. Si el stream
del cliente no puede cancelarse, la respuesta sigue siendo el mismo 413.

### Evidencia RED/GREEN (2026-11-10)

- RED: los tests finales contra el módulo de `HEAD` en scratch aislado dieron
  `8 failed | 27 passed (35)`. Fallan solo los ocho casos nuevos del bloque
  «bounded JSON bodies (S6)»: límite exacto con relleno, cuerpo troceado
  ensamblado, exceso de un byte con cancelación, `content-length` declarado
  excesivo sin lectura, longitud declarada que miente, conteo UTF-8, no eco del
  cuerpo/secreto y stream que no se deja cancelar. Los 27 casos previos pasan
  sin cambios.
- GREEN: `pnpm exec vitest run 'src/app/api/fiscal/[[...path]]/route.test.ts'`
  35/35.
- Diferencial (módulo base de `HEAD` contra una copia idéntica del árbol de
  trabajo, en scratch fuera del repositorio): 33/33. Los 32 casos ordinarios
  —documentos, ajustes, secretos, CSC, clasificaciones, GET, multipart del
  certificado, rutas inválidas, sesión ausente/portal, cuerpo rechazado y error
  upstream— coinciden en estado, cuerpo, cabeceras y reenvío. La única
  diferencia es la solicitada: un cuerpo JSON de 65537 bytes pasa de `200` con
  reenvío a `413` sin reenvío.
- `pnpm --filter @newsaas/web typecheck`, Prettier, ESLint enfocado y
  `git diff --check`: limpios.

Archivos: `apps/web/src/app/api/fiscal/[[...path]]/route.ts` y
`apps/web/src/app/api/fiscal/[[...path]]/route.test.ts`.

Risk: item 2 (tope de tamaño de la petición); verificación independiente al
cierre de la entrega.

## Verificación de las observaciones (2026-11-10)

- Proxy y formularios fiscales: 66 pruebas pasan; CSC/signing-material/RBAC: 111
  pruebas pasan. Verificación independiente: CSC 11/11 y proxy/formulario 46/46,
  sin bloqueantes de producto.
- Después de reparar las dependencias locales con autorización del usuario:
  `pnpm build` 17/17; `pnpm lint`, `pnpm format-check` y `pnpm typecheck` pasan.
- Navegador afectado: sucursales, anulación de venta y nota de crédito
  electrónica, 3/3. El flujo fiscal usa los XSD oficiales, certificado y CSC
  desde la pantalla y descifrado compartido con el worker.
- Suites completas unitarias de API/web y CI remoto: no ejecutadas en este
  cierre; corresponden al CI según instrucción del usuario.
- Evaluación nativa adicional indisponible: rechaza la configuración local no
  rastreada aun después de `inspect` con exclusión y en rango comprometido. No
  se inició una revisión ni se modificó esa configuración.

## Decisiones / ADRs

- [[ADR-005]], [[DEC-057]], [[DEC-090]], [[DEC-095]]

2026-11-09 (cierre): `apps/e2e/specs/electronic-credit-note.spec.ts` sube el
certificado y carga el CSC por la pantalla; el worker con
`FISCAL_FAKE_REQUIRES_SIGNED_DOCUMENT=true` y los XSD oficiales arma, firma y
valida el DE (descifra certificado y CSC con la clave compartida), la factura
llega a `APPROVED` con CDC y la anulación emite la nota de crédito. Spec 1/1
(31,5 s); carril completo 31/31. Verificación independiente de la entrega (CSC,
proxy multipart, sección de secretos, FISC-020): sin bloqueantes. Corregidos en
el camino: el worker no avanzaba `SIGNING → SENDING` con un proveedor sin firma,
y el simulado no devolvía el CDC aprobado.

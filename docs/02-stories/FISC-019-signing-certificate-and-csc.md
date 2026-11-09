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

- [ ] `POST /fiscal/csc` con cuerpo estricto `{ environment, idCsc, value }`:
      ambiente `TEST|PRODUCTION`, `idCsc` con el formato de SIFEN (4 caracteres,
      ver SIFEN-BASELINE §24), valor de 32 caracteres alfanuméricos. El valor se
      guarda solo en el almacén de secretos y nunca se devuelve, se registra en
      logs ni entra en la auditoría.
- [ ] Un `idCsc` ya activo en ese ambiente, o un tercer CSC activo, es `409` sin
      escribir nada (ni fila ni secreto).
- [ ] `GET /fiscal/csc` lista solo metadatos (id, ambiente, idCsc, estado,
      fechas).
- [ ] `POST /fiscal/csc/:id/retire` con motivo: destruye el secreto en la misma
      transacción y conserva la fila; id de otro tenant o inexistente `404`; ya
      retirado `409`.
- [ ] Auditoría `fiscal.csc.loaded` / `fiscal.csc.retired` con
      `{ environment, idCsc }` únicamente.
- [ ] Las tres rutas exigen la función `fiscal` y
      `fiscal.signing_material.manage`; figuran en el probe de permisos.
- [ ] El lector del worker encuentra el CSC cargado por la ruta (live-pg o
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

## Decisiones / ADRs

- [[ADR-005]], [[DEC-057]], [[DEC-090]], [[DEC-095]]

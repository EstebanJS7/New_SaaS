---
id: FISC-020
type: story
title: Explicit customer and tenant tax declarations for fiscal issuance
epic: EPIC-16
status: in-progress
priority: high
depends_on: [FISC-015]
prd_sections: []
permissions: [customers.create, customers.update, fiscal.profile.manage]
branch: docs/dec-095-fiscal-issuance-point
created: 2026-11-09
updated: 2026-11-09
---

# FISC-020 — Declaraciones fiscales explícitas

## Objetivo y autorización

DEC-096, opción A elegida por el usuario: «Completar las declaraciones
faltantes». Agregar «API, proxy y formularios mínimos para declarar el tipo de
operación fiscal del cliente y la clasificación tributaria del IVA del tenant,
con permisos, aislamiento y pruebas. Después ejecutar NCE-001 sin SQL ni
aprobaciones fabricadas.»

No cambiar el PRD, inferir valores predeterminados, modificar el protocolo SIFEN
ni agregar permisos, proveedores o migraciones para campos/tablas que ya
existen.

## Criterios de aceptación

### Cliente (unidad T6)

- [ ] Crear/editar un cliente admite su `fiscalOperationType` explícito con los
      valores ya definidos por DEC-057 y el esquema. Ausente o null no inventa
      una declaración; una edición que omite el campo preserva la declaración
      previa.
- [ ] Las respuestas de detalle y el formulario de cliente permiten ver y editar
      la declaración. El proxy reenvía solo la superficie autorizada existente.
- [ ] Se mantienen autenticación, permisos actuales de clientes, aislamiento
      tenant y auditoría vigente; no se expone el dato a portales por accidente.
- [ ] Pruebas de validación, persistencia/lectura por API, aislamiento y
      preservación del comportamiento anterior; typecheck/lint aplicables.

### Clasificación tributaria (unidad T7)

- [ ] Configuración fiscal permite listar y guardar explícitamente por tenant y
      alícuota las clasificaciones ya definidas en DEC-057/esquema; no crea
      clasificaciones automáticas ni modifica los valores globales de IVA.
- [ ] API y proxy exigen la función fiscal y `fiscal.profile.manage`, validan
      campos estrictamente, verifican alícuota existente y el rango/condición de
      proporcionalidad que exige el modelo existente.
- [ ] Cada lectura/escritura se limita al tenant autenticado y las escrituras
      quedan auditadas. No se confía en tenantId enviado por el cliente.
- [ ] Sección mínima con estados de carga, vacío, error, éxito y permiso; textos
      es-PY y tokens semánticos, sin rediseñar la pantalla.
- [ ] Pruebas de validación, permisos, aislamiento, lectura/escritura y
      preservación de rutas anteriores; typecheck/lint aplicables.

### Unidad de medida del catálogo (unidad T9, [[DEC-097]])

- [x] Alta y edición de artículos aceptan `unitOfMeasureCode` opcional, validado
      contra el catálogo SIFEN de unidades ya implementado; ausente no inventa
      unidad y una edición que omite el campo preserva la anterior; `null`
      explícito la quita.
- [x] El detalle de artículo y el formulario de catálogo muestran y editan la
      unidad con un selector mínimo; textos es-PY. (2026-11-09: 7 pruebas web
      nuevas de formulario/detalle y 2 de cliente pasan; catálogo web 119/119.)
- [x] Se mantienen permisos de catálogo, aislamiento tenant y auditoría vigente.
- [x] Pruebas de validación, persistencia/lectura por API, preservación del
      comportamiento anterior y del formulario.

### Integración (unidad T3)

- [ ] NCE-001 carga las declaraciones por superficies públicas, configura
      certificado/CSC y obtiene una factura APPROVED con worker/proveedor fake;
      la anulación muestra la nota de crédito, sin SQL de aprobación.
- [ ] Verificación independiente por riesgo de permisos y contratos compartidos.

## Clasificación de datos

Las nuevas superficies usan campos fiscales de configuración ya existentes:
INTERNAL, accesibles solo al personal autorizado; no contienen secretos. No se
agregan datos personales ni valores predeterminados o políticas de retención.

## Implementación

Cliente implementado por T6: paquete 18, API 58 y web 62 pruebas pasan;
typecheck, lint y formato focalizados pasan. Preserva omisión/null y la
auditoría vigente. Clasificación implementada por T7: GET/PUT
`/fiscal/tax-classifications`, proxy y sección mínima; 6 pruebas del servicio y
51 combinadas de configuración/proxy pasan, junto con typechecks y lint
focalizados. Sin nuevas migraciones.

Pendientes: diferencial base/candidato, integración HTTP/live-pg de las nuevas
declaraciones, suites completas sobre el candidato final y verificación
independiente. El gate NCE-001 sigue pendiente: DEC-097 propone agregar la
unidad fiscal del artículo que el ensamblador ya exige, pero aún no existe una
ruta para declararla. Esa ampliación requiere decisión explícita y no modifica
estos criterios sin aprobación.

### Unidad del catálogo — T9 (2026-11-09)

Implementado: `unitOfMeasureCode` opcional en alta/edición (`.strict()`,
validado contra `DTE_UNITS_OF_MEASURE`; ausente no inventa unidad, una edición
que lo omite lo preserva, `null` lo quita), incluido en las respuestas y
nombrado (nunca su valor) en la auditoría existente. Nueva lectura
`GET /catalog/units-of-measure` (`catalog.read`) y su forma en el proxy;
selector y detalle web. Sin migraciones ni cambios en artículos existentes.

Observado: API catálogo + sonda de rutas 96/96 (RED previo: 17 fallas); web
catálogo 119/119 (RED previo: 11 fallas); typecheck API/web y lint/formato de
archivos cambiados limpios. Diferencial contra c96fb45 sin el campo nuevo:
mismos estados, errores y auditoría en 14 solicitudes; solo se agrega
`unitOfMeasureCode: null` a cada respuesta de artículo y
`/catalog/units-of-measure` pasa de 400 a 200.

Bloqueante abierto: la suite completa de API falla 1 prueba
(`fiscal-boundary.test.ts`: los imports de `@newsaas/fiscal` deben quedar en
`apps/api/src/fiscal/`). El catálogo debe consumir la lista mediante un archivo
del área fiscal; hasta resolverlo, los criterios de API, permisos/auditoría y
pruebas quedan sin marcar. La persistencia por HTTP se prueba con un fake del
servicio, porque la base en memoria compartida aún no guarda la columna.

2026-11-09 (T9 cierre): el test de frontera fiscal fallaba porque Catalog
importaba `@newsaas/fiscal`; ahora importa
`apps/api/src/fiscal/units-of-measure.ts` (reexport). `fiscal-boundary` +
catalog + rbac: 146/146; tsc, eslint y prettier limpios.

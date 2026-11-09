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

DEC-096, opción A elegida por el usuario: «Completar las declaraciones faltantes».
Agregar «API, proxy y formularios mínimos para declarar el tipo de operación fiscal del cliente y la clasificación tributaria del IVA del tenant, con permisos, aislamiento y pruebas. Después ejecutar NCE-001 sin SQL ni aprobaciones fabricadas.»

No cambiar el PRD, inferir valores predeterminados, modificar el protocolo SIFEN
ni agregar permisos, proveedores o migraciones para campos/tablas que ya existen.

## Criterios de aceptación

### Cliente (unidad T6)

- [ ] Crear/editar un cliente admite su `fiscalOperationType` explícito con los
      valores ya definidos por DEC-057 y el esquema. Ausente o null no inventa
      una declaración; una edición que omite el campo preserva la declaración previa.
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
- [ ] Sección mínima con estados de carga, vacío, error, éxito y permiso;
      textos es-PY y tokens semánticos, sin rediseñar la pantalla.
- [ ] Pruebas de validación, permisos, aislamiento, lectura/escritura y
      preservación de rutas anteriores; typecheck/lint aplicables.

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

Cliente implementado por T6: paquete 18, API 58 y web 62 pruebas pasan; typecheck,
lint y formato focalizados pasan. Preserva omisión/null y la auditoría vigente.
Clasificación implementada por T7: GET/PUT `/fiscal/tax-classifications`, proxy
y sección mínima; 6 pruebas del servicio y 51 combinadas de configuración/proxy
pasan, junto con typechecks y lint focalizados. Sin nuevas migraciones.

Pendientes: diferencial base/candidato, integración HTTP/live-pg de las nuevas
declaraciones, suites completas sobre el candidato final y verificación
independiente. El gate NCE-001 sigue pendiente: DEC-097 propone agregar la
unidad fiscal del artículo que el ensamblador ya exige, pero aún no existe una
ruta para declararla. Esa ampliación requiere decisión explícita y no modifica
estos criterios sin aprobación.

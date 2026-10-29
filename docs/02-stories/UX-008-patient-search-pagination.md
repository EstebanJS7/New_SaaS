---
id: UX-008
type: story
title: Server patient search and pagination
epic: EPIC-05
status: done
priority: high
depends_on: [UX-003, UX-007]
prd_sections: ["9", "12", "41"]
branch: main
created: 2026-10-28
updated: 2026-10-28
---

# UX-008 — Buscar y recorrer pacientes

Alcance aprobado: búsqueda paginada de pacientes por nombre o responsable,
filtros y orden de servidor, contexto al abrir una ficha y volver, estados
claros y aislamiento. Primera etapa: pacientes; ventas y nuevas capacidades
clínicas quedan fuera de esta Story. No se modifica el PRD ni el selector de
agenda.

## Criterios

- [x] Lectura aditiva paginada con cuerpo estricto, límites, orden estable y
      conteo del mismo tenant/filtro; conserva GET y lookup existentes.
- [x] `patients.read`, staff y entitlement veterinario obligatorios; nombres y
      búsqueda por responsable solo con `customers.read`, sin impedir lectura de
      pacientes a quien no tenga ese permiso. Sin autoridad tenant desde el
      cliente.
- [x] UI en español: búsqueda explícita, activos/inactivos/todos, orden,
      paginación real y estados de carga/vacío/error/reintento.
- [x] Abrir una ficha y volver conserva búsqueda/filtros/página en el mismo
      documento, sin texto confidencial en URL ni almacenamiento persistente.
- [x] Pruebas API/aislamiento/paginación y UI dirigidas, lint, tipos, builds y
      documentación con evidencia y límites.

## Datos

Nombres y búsqueda CONFIDENTIAL; POST de lectura sin cuerpos/resultados en logs.
DTO sin notas, contacto, pagos ni datos fiscales. Contexto de listado solo en
memoria con expiración de diez minutos; recarga/reingreso lo descarta (UX-007).

## Implementación

`PatientSearchController` valida `POST /patients/search`. `PatientSearchService`
reaplica permiso/entitlement, filtra por el tenant autenticado y ejecuta conteo,
página y proyección autorizada de responsables en una transacción
RepeatableRead. Tamaño fijo 20, página 1–10000, nombre ascendente o creación
descendente con UUID de desempate. Página fuera de rango se ajusta al último
resultado disponible.

El DTO solo devuelve ID, nombre, estado, sexo, especie/raza y responsable
principal, además de metadatos de página. Las búsquedas por responsable y sus
nombres solo se consultan con `customers.read`; sin ese permiso se conserva
búsqueda por paciente y se informa el límite. El BFF existente conserva
`private, no-store`.

`patients-list.tsx` usa el nuevo contrato, cancelación de lecturas y estados
separados. `patients-list-state.ts` mantiene el contexto aplicado solo en
memoria, con expiración; no altera historial ni URLs. La validación y reintento
están en español. Se mantiene la confirmación explícita para desactivar
pacientes.

## Límites

- Primera etapa: pacientes. Ventas y ampliaciones clínicas quedan posteriores.
- La búsqueda por responsable considera el principal activo y su cliente activo,
  como el lookup existente; no todos los responsables secundarios.
- Contexto confidencial con vida máxima de diez minutos desde su actualización;
  solo en el mismo documento. No se restaura después de recargar/reingresar.
- Paginación por offset y conteo exacto; cambios entre peticiones pueden mover
  registros. Cada respuesta mantiene un snapshot coherente; no se promete una
  sesión de búsqueda congelada ni búsqueda tolerante a errores/acentos.
- Las rutas antiguas no se eliminan ni se restringen como parte de esta Story.
- Sin nueva ronda de navegador ni certificación visual/lector de pantalla. Las
  pruebas de componentes no se presentan como un recorrido E2E real.
- Sin commit ni push solicitado.

## Verificación

Evidencia separada de PostgreSQL real, HTTP con guardas y UI/proxy en
[[UX-VALIDATION-2026-10-27]]. Comandos principales:

- PostgreSQL real: 7/7 en base temporal eliminada al terminar, con el servicio
  real y decisiones de permisos/entitlements controladas.
- HTTP: 14/14 del nuevo contrato con guardas reales y lectura sustituida, más
  18/18 de lookup existente. Validación estricta, identidad, permisos y logs.
- Web: 12/12 del listado, 9/9 del proxy y 4/4 del selector de agenda. Los tres
  casos de recuperación/reintento se reejecutaron tras ajustar la suscripción
  del contexto; los otros nueve se omitieron en esa reejecución por haber pasado
  antes. No se suman ejecuciones repetidas.
- 64 casos distintos comprobados en ejecuciones dirigidas; no es una suite
  global.
- Tipos API/web, lint dirigido y build API correctos. Build web final y
  verificador de salida correctos.
- No se usó navegador ni se modificaron datos demo. No se afirma una revisión
  visual o Back/Forward real a partir de pruebas de remonte de componentes.

```powershell
pnpm --filter @newsaas/api test:patient-search
pnpm --filter @newsaas/api exec vitest run src/patients/patient-search.integration.test.ts src/patients/patient-lookup.integration.test.ts
pnpm --filter @newsaas/web exec vitest run 'src/app/(app)/app/patients/patients-list.test.tsx' 'src/app/api/patients/[[...path]]/route.test.ts' 'src/app/(app)/app/agenda/patient-selector.test.tsx'
```

Runtime smoke after restart: API health 200, web health proxy 200, worker connected
to Redis, and POST /patients/search without a session returned 401. No browser,
credentials, patient data or mutating command was used for this check.

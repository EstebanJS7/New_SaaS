---
id: UX-009
type: story
title: Server sales search and pagination
epic: EPIC-12
status: done
priority: high
depends_on: [UX-006, UX-007, UX-008]
prd_sections: ["9", "18", "41"]
branch: main
created: 2026-10-29
updated: 2026-10-29
---

# UX-009 — Buscar y recorrer ventas

Consulta exclusivamente; conserva POS, comandos, vínculos clínicos y GET
existentes. Referencias: [[Sales]], [[UX-008-patient-search-pagination]],
[[DEC-026]], [[DEC-027]], [[DEC-028]]. ID verificado disponible al comenzar.

## Criterios

- [x] POST de lectura estricto, paginado (20), conteo consistente y orden
      estable.
- [x] Autenticación staff, sales.read, entitlement sales y aislamiento de
      tenant.
- [x] Buscar UUID completo y nombre del cliente únicamente con customers.read.
- [x] Filtrar estados reales; ordenar por creación reciente/antigua sin inventar
      numeración, pagos ni datos fiscales.
- [x] Listado accesible en español/es-PY con carga, vacío, error y reintento.
- [x] Abrir detalle y volver conserva contexto temporal en memoria; sin búsqueda
      en URL, logs ni almacenamiento persistente.
- [x] Pruebas acotadas, lint, tipos, builds y documentación; distinguir
      simulación, PostgreSQL real y revisión visual. Sin cobros ni mutaciones
      financieras reales.

## Datos y límites previstos

Texto de búsqueda y nombres CONFIDENTIAL; DTO mínimo, sin contactos, líneas,
pagos o datos clínicos/fiscales. Estado/contexto únicamente en memoria del mismo
documento, diez minutos; recarga/reingreso lo descarta. Offset no congela el
conjunto entre peticiones. Sin cambios al PRD, dependencias, commit ni push.

## Implementación

Lectura aditiva `POST /sales/search` en `sale-search.controller.ts`,
`sale-search.dto.ts`, `sale-search.service.ts`; validación estricta,
RepeatableRead y proyección mínima sin montos/líneas. Tenant del contexto,
entitlement sales antes del permiso, nombres solo con customers.read. No hay
migraciones. BFF permite únicamente la forma POST y sus cuatro claves; conserva
bytes del cuerpo, cookie staff y no-store. GET permanece intacto.

`sales-list.tsx` y `sales-list-state.ts` aplican la experiencia UX-008 en
`/app/sales/history`. Se agregan enlaces desde POS y detalle, y retorno seguro
tras sesión expirada a esa ruta sin parámetros. Mantiene el contexto aplicado
solo en memoria diez minutos. Sin nuevos cálculos, comandos ni asociaciones.

Se reconciliaron pruebas antiguas con textos españoles ya existentes y el
inventario de rutas UX-006/UX-008 con sus permisos múltiples exactos. Se
mantiene el control de inventario completo; no se relajaron guardas ni
contratos.

## Verificación y límites

Evidencia y comandos: [[UX-VALIDATION-2026-10-29]]. Sin nueva ronda de
navegador, Back/Forward real ni certificación de lector de pantalla. La
restauración se prueba mediante remonte con el mismo QueryClient. PostgreSQL usa
una base temporal con fixtures sintéticos, sin comandos de cobro ni cambios a
datos demo.

Búsqueda parcial de cliente sin tolerancia especial a errores/acentos; UUID
completo. Página limitada a 10000 como UX-008. Offset no congela resultados
entre peticiones; el snapshot coherente aplica a cada respuesta. El listado
omite importes; el detalle conserva sus líneas y total autoritativo. No se
identificaron atajos nuevos que requieran Tech Debt o cambios arquitectónicos.
No commit ni push.

Verificación final: 121 casos distintos aprobados (8 PostgreSQL, 39
HTTP/guardas, 74 web/proxy/transporte/retorno), lint completo API/web, tipos
API/web y builds aislados API/web con verificación de salida correctos. Sin
gates pendientes dentro del alcance automatizado acordado. Revisión visual fuera
de esta etapa.

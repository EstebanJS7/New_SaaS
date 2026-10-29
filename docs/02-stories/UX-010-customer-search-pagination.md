---
id: UX-010
type: story
title: Server customer search and pagination
epic: EPIC-04
status: done
priority: high
depends_on: [UX-007, UX-008, UX-009]
prd_sections: ["9", "11", "41"]
branch: main
created: 2026-10-29
updated: 2026-10-29
---

# UX-010 — Buscar y recorrer clientes

Alcance aprobado: listado de clientes con búsqueda, filtros, orden y paginación
de servidor siguiendo UX-008/UX-009. ID verificado disponible antes de empezar.
Referencias: [[Customers]], [[ADR-001]], [[DEC-073]], [[DEC-080]]. Sin cambiar
PRD, CRUD, contactos, direcciones, Portal ni consumidores del GET.

## Criterios

- [x] POST de lectura con cuerpo estricto y límites; páginas de 20, conteo del
      mismo filtro/tenant y orden estable con UUID de desempate.
- [x] Staff, membresía activa y customers.read en backend; tenant resuelto desde
      el contexto. Sin nuevo entitlement para Customers Core.
- [x] Búsqueda por nombre visible, razón social, documento y RUC existentes;
      filtros activos/inactivos/todos y persona/empresa/todos; orden nombre o
      creación reciente. Sin agregar teléfonos, correos o datos fiscales nuevos.
- [x] UI del listado en español/es-PY y tokens semánticos; controles accesibles,
      carga, vacío, error, reintento y límites de navegación.
- [x] Abrir cliente y volver conserva contexto aplicado en memoria diez minutos;
      sin búsqueda ni datos personales en URL, logs o almacenamiento
      persistente.
- [x] Conservar GET, DTOs y comandos existentes; no emitir desactivaciones u
      otras mutaciones por navegar, filtrar o paginar.
- [x] Pruebas dirigidas de API/aislamiento/UI/proxy, lint, tipos, builds
      aislados y documentación. Separar simulación, PostgreSQL y revisión
      visual.

## Datos y verificación prevista

Búsqueda e identidad personal son CONFIDENTIAL. DTO reducido a la identidad y
estado necesarios para las filas, sin documentos/RUC completos, contactos,
direcciones, datos clínicos o fiscales. Sin persistencia de QueryClient.
Contexto solo dentro del mismo documento; recarga/reingreso lo descarta. Pruebas
con datos sintéticos y base PostgreSQL temporal; sin nueva ronda de navegador,
datos demo modificados, cobros, commit ni push.

## Implementación

`customer-search.controller.ts`, `customer-search.dto.ts` y
`customer-search.service.ts` implementan POST /customers/search con autorización
defensiva, validación estricta, tenant de contexto, select de identidad mínimo,
conteo/página en RepeatableRead y desempate por UUID. Sin migraciones.

`customer-search-api.ts`, `customers-list-state.ts` y el listado existente
conectan esa lectura. El BFF nuevo `api/customers/search/route.ts` usa solo
cookie staff, cuerpo exacto, allowlist de claves y no-store. No se cambian GET
/customers, customers-api.ts, CustomersService, paquetes compartidos,
controladores de comandos o proxy CRUD anterior. El detalle agrega un enlace de
retorno y no altera su contenido.

Se traducen listado, estados y mensajes de su confirmación existente. Los
errores de lectura son españoles y no exponen mensajes internos. No se
generalizó la búsqueda a un framework común ni se incorporaron dependencias.

## Límites

Búsqueda parcial sin distinguir mayúsculas, sin tolerancia especial a errores o
acentos ni normalización de documentos. Página 1–10000. Offset no congela el
conjunto entre peticiones; cada respuesta mantiene un snapshot coherente. Estado
temporal en memoria, diez minutos; no sobrevive recarga o reingreso. Solo el
listado y enlace de retorno se consideran traducidos en esta etapa.

Sin nueva ronda de navegador, Back/Forward observado, lector de pantalla ni
certificación WCAG. Restauración cubierta por remonte con mismo QueryClient.
Pruebas de mutaciones anteriores usan únicamente dobles/datos sintéticos; las
pruebas PostgreSQL nuevas solo usan una base temporal. Ningún cobro, comando
financiero o cambio de datos demo. No commit ni push. No se detectaron atajos
nuevos que requieran Tech Debt ni cambios de arquitectura.

## Verificación

Resultados, comandos y fronteras en [[UX-010-VALIDATION-2026-10-29]].

Resultado final: 114 casos distintos aprobados (11 PostgreSQL, 44 HTTP/guardas,
28 regresión de Customers y 31 web/proxies). Lint completo API/web, tipos
API/web, build API y build web aislados con verificador de salida aprobados. Sin
gates pendientes dentro del alcance automatizado acordado.

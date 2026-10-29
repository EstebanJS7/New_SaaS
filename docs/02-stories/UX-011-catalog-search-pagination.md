---
id: UX-011
type: story
title: Server catalog search and pagination
epic: EPIC-09
status: done
priority: high
depends_on: [UX-008, UX-009, UX-010]
prd_sections: ["9", "15", "41"]
branch: main
created: 2026-10-29
updated: 2026-10-29
---

# UX-011 — Buscar y recorrer el catálogo

ID verificado disponible. Alcance aprobado: consulta paginada del catálogo
siguiendo UX-008/UX-010. Referencias: [[Catalog-Taxes]], [[ADR-001]],
[[DEC-010]], [[DEC-025]], [[DEC-080]]. Sin cambios de PRD, precios, impuestos,
stock, POS o comandos. Sin dependencias nuevas, abstracción genérica, commit ni
push.

## Criterios

- [x] POST de lectura estricto con límites, páginas reales de 20, conteo del
      mismo tenant/filtro y orden estable con desempate UUID.
- [x] Staff, membresía activa y catalog.read obligatorios; permiso reafirmado en
      servicio y tenant del contexto. Sin nuevo entitlement para Catalog Core.
- [x] Búsqueda por nombre existente; tipos PRODUCT/SERVICE/MEDICATION/SUPPLY y
      todos; estados activos/inactivos/todos; orden nombre o creación reciente.
      No agregar SKU, código de barras, categorías o campos buscables
      inventados.
- [x] Conservar presentación de impuesto/precio de referencia, como Decimal
      exacto y formato es-PY, sin cálculos, conversiones o cambios de valores.
- [x] Listado en español y tokens semánticos; controles etiquetados, carga,
      vacío, error, reintento y límites de navegación.
- [x] Abrir artículo y volver conserva búsqueda/filtros/orden/página durante
      diez minutos en memoria; sin texto en URL/logs ni almacenamiento
      persistente.
- [x] GET, tax-rates, DTOs y consumidores existentes del POS/agenda conservados;
      filtrar, paginar o navegar no emite mutaciones.
- [x] Pruebas dirigidas, lint, tipos, builds aislados y documentación; separar
      respuestas simuladas, PostgreSQL real y revisión visual.

## Datos y verificación prevista

Configuración del catálogo INTERNAL; búsqueda tratada conservadoramente como
CONFIDENTIAL por ser texto libre. Respuesta mínima sin clientes, clínica, stock,
pagos o datos fiscales documentales. Contexto solo en memoria del mismo
documento, sin persistencia de QueryClient; recarga/reingreso lo descarta.
Pruebas sintéticas/base PostgreSQL temporal. Sin nueva ronda de navegador,
mutaciones operativas, cobros o modificaciones de datos demo.

## Implementación

CatalogSearchController/Service y DTO propios agregan POST /catalog/search sin
cambiar CatalogService o CatalogRepository. Consulta Prisma con select mínimo,
permiso reafirmado, tenant de contexto, conteo y página en RepeatableRead. La
proyección del precio usa el Decimal de la columna a escala dos, sin aritmética.
No hay migraciones ni cambios a precios, tasas, tracksStock o movimientos.

catalog-search-api.ts y catalog-list-state.ts conectan el listado existente con
el nuevo BFF api/catalog/search/route.ts. Ese BFF admite solo cookie staff y
claves permitidas, cuerpo exacto, cancelación y no-store. Se agrega un enlace de
retorno en el detalle. No se modifican catalog-api.ts, GET, tax-rates, proxy
CRUD, comandos, formularios o consumidores del POS/agenda.

Se mantienen los comportamientos de las nueve pruebas anteriores del listado,
adaptados a POST paginado, texto español y confirmación mediante el diálogo real
del componente (el test previo aún usaba window.confirm). Se añade un caso de
precios ausentes/moneda USD. Dos expectativas antiguas del cliente se alinean
con la traducción ya existente; su implementación/contrato no cambia.

## Límites y verificación

Evidencia y comandos en [[UX-011-VALIDATION-2026-10-29]]. Sin nueva revisión
visual ni Back/Forward observado: contexto probado mediante remonte con el mismo
QueryClient. No se certifican WCAG, teclado real o lector de pantalla. La
traducción cubre listado/confirmación/enlace de retorno, no todo Catalog o POS.

Búsqueda por nombre sin normalización especial de acentos ni búsqueda fonética;
orden de PostgreSQL existente. Offset no congela el conjunto entre peticiones, y
el contexto temporal no sobrevive recarga/reingreso. Hasta 10000 páginas.

Configuración INTERNAL y búsqueda libre tratada como CONFIDENTIAL. Sin logs de
cuerpos/resultados, URLs con texto o almacenamiento persistente. Datos
sintéticos con base PostgreSQL temporal; sin mutaciones operativas o comandos
financieros. No se detectaron atajos que requieran Tech Debt nueva o cambios de
arquitectura. Sin commit ni push.

Resultado final: 150 casos distintos aprobados (11 PostgreSQL real, 79
API/guardas/repositorio y 60 web/transporte/proxies), lint completo API/web,
tipos API/web y builds aislados API/web con verificador de salida correctos. Sin
gates pendientes dentro del alcance automatizado acordado.

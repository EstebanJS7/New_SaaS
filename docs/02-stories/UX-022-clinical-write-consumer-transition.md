---
id: UX-022
type: story
title: Transition owned clinical write consumers to protected commands
epic: EPIC-06
status: done
priority: high
depends_on: [UX-019, UX-020, UX-021]
prd_sections: ["9", "12.1", "13", "28", "41"]
branch: main
created: 2026-10-30
updated: 2026-10-30
---

# UX-022 — Transición compatible de consumidores clínicos

ID disponible verificado antes de implementar. Continuación autorizada del
inventario/migración de consumidores y plan explícito de transición, sin romper
consumidores desconocidos. [[Clinical]], [[TD-066]],
[[DEC-084-weight-measurement-unit]], [[ADR-001 Modular Monolith]].

## Criterios

- [x] Inventariar consumidores reales de POST/PUT de tratamientos, estudios y
      pesos, distinguiendo UI, transporte/BFF, backend, pruebas y fixtures. No
      interpretar ausencia en el repo como ausencia de clientes externos.
- [x] Los transportes staff controlados exigen clave caller-owned para crear y
      versión para corregir, en tipos y antes de fetch; sin generar nueva clave,
      retry automático, deducción por valores o fallback a comandos sin guardia.
- [x] Formularios conservan clave/comando UX-019 y baseline UX-020. Recuperación
      UX-018 intacta. Peso confirmado con lectura fallida solo repite GET,
      manteniendo precisión/unidad y respuesta legada del comando.
- [x] API y BFF existentes conservan contratos opcionales para consumidores
      legados; autorización, aislamiento, DTOs y unidades desconocidas intactos.
      Documentar pasos y condiciones para retirar compatibilidad, sin activar
      exigencia global ni afirmar CAS/idempotencia para escritores sin token.
- [x] Pruebas negativas antes de red, transporte/proxy/formularios/recuperación,
      regresión backend y PG real exclusivamente desechable; lint/tipos y builds
      aislados aplicables. Visual/E2E no requiere nueva ronda al no cambiar UI.
- [x] Actualizar Clinical, TD-066, guía, changelog y QA, separando evidencia
      simulada/PG/build de navegador no ejecutado; sin PRD, dependencias,
      migraciones operativas, commit/push o cambios de otros dominios.

## Clasificación y límites

Sin nuevos datos persistidos. Claves/versiones CONFIDENTIAL por asociación
clínica; errores locales constantes sin contenido, sin URL/log/Storage nuevos,
ni política de retención destructiva. TD-066 seguirá abierta para historial,
durable y exigencia global pendiente de transición verificada.

## Plan

Inventario estático → endurecer contratos locales/migrar invocaciones →
verificar compatibilidad y garantías en pruebas → documentar transición y
límites. No forzar cambios del contrato público ni inventar clientes productivos
ausentes.

## Inventario verificado

Búsqueda en apps/, packages/ y scripts/: nombres create/update de los tres
tipos, writeTreatment/Study/Weight, rutas concretas/dinámicas y escrituras
Prisma. Revisión de invocaciones, no solo exportaciones.

| Consumidor/capa                   | Ubicación                                                                          | Resultado y transición                                                                                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI staff productiva               | apps/web/src/app/(app)/app/patients/[id]/{treatment,study,weight}-form.tsx         | Únicos tres escritores de aplicación encontrados. Ya conservaban clave/comando/baseline; invocaciones ahora separan creación y corrección para satisfacer overloads estrictos.                                              |
| Transporte staff                  | Mismo directorio, {treatment,study,weight}-write-api.ts                            | Antes permitían omitir intento o versión. Ahora obligatorios por modo, con rechazo local constante antes de fetch. Sin generar claves, refrescar baseline o reintentar.                                                     |
| BFF                               | apps/web/src/app/api/clinical/[[...path]]/route.ts                                 | Reenvío transparente de cuerpos legados o protegidos. No fabrica guardias. Cookies staff/no-store/allowlist/autorización sin cambios.                                                                                       |
| API                               | apps/api/src/clinical/clinical.records.controller.ts y clinical.records.service.ts | Campos siguen opcionales y contratos originales se conservan. No otros callers productivos del servicio encontrados fuera del controller.                                                                                   |
| Lecturas                          | *-search-api.ts, *-list.tsx, controllers search, reportes                          | No son escritores de estos tres tipos. clinical-api.ts/clinical-records.tsx escriben otros tipos y quedan intactos.                                                                                                         |
| Pruebas HTTP/BFF/PG/Playwright    | clinical*.test.ts, proxy tests, clinical-specs/                                    | Clientes de prueba explícitos. Mantener tanto comandos protegidos como legados para verificar compatibilidad, no migrarlos todos para esconderla. El test unitario directo de writeStudy sí se adapta a la firma protegida. |
| Demo/fixtures Prisma              | packages/database/src/demo-seed.ts y fixtures de tests                             | seedDemoClinical crea peso sintético por UUID fijo/createMany skipDuplicates en transacción. No usa POST/PUT; no es consumidor operativo ni se ejecuta/cambia aquí.                                                         |
| Consumidores externos/desplegados | Fuera del repositorio                                                              | No identificables por búsqueda local. Ausencia de código no es censo de integraciones ni autorización de corte.                                                                                                             |

## Implementación y transición

Sin endpoint, migración, dependencia o framework nuevo. Overloads de cada
helper: crear exige id undefined y objeto de intento con key; corregir exige id
string y expectedVersion entero. El DTO de contenido ya no declara versión
opcional. Guardia runtime valida UUID de clave o entero 1..2147483647 y rechaza
mezcla de modos. Error local INVALID_WRITE_GUARD, status 0, uncertain false, sin
contenido. No sustituye autorización o validación backend.

Excepción segura de peso: si el intento ya contiene savedId confirmado, entra
primero en lectura staff y nunca en POST, incluso si la antigua clave es
inutilizable. GET fallido sigue READ_AFTER_COMMIT_FAILED y solo permite repetir
lectura; no se infiere unidad/éxito por valores. Correcciones inciertas no se
reintentan. Clave/comando y versión original permanecen en recuperación UX-018.

[[DEC-085-clinical-write-legacy-contract-transition]] propone condiciones del
corte público futuro: inventario externo, migración/verificación por responsable
y decisión de despliegue explícita. Sigue proposed, sin obligatoriedad global
activada ni cambios de PRD. TD-066 mantiene ese corte, historial y durable.

## Verificación y cierre

407 pruebas distintas aprobadas: 327 web/proxy (incluye 52 del nuevo contrato y
3 de compatibilidad BFF), 29 backend simuladas y 51 PostgreSQL real (25
creación, 26 corrección). Siete llamadas negativas de compilación comprobadas
por tsc, sin ejecutarlas. No se suman las 52 reejecutadas tras correcciones de
lint. ESLint web completo, tipos web y API/build API aislado, build Next aislado
y verificador de salida aprobados. Migraciones existentes aplicadas solamente en
dos DB de prueba dentro de un contenedor PG temporal propio, eliminado al
terminar; sin base configurada/de desarrollo.

Primera compilación web detectó cuatro errores de lint en mocks nuevos;
corregidos y build repetido con éxito, sin repetir PG/backend ya aprobados. Sin
nueva ronda visual/E2E por no modificar markup/flujo/diseño; UX-021 es evidencia
anterior, no una ejecución actual. Sin dependencia, migración nueva, base
operativa, PRD, commit o push. Cambios acumulados conservados.

Story done para el alcance local compatible y documentación de transición, no
para obligatoriedad pública.
[[DEC-085-clinical-write-legacy-contract-transition]] permanece proposed; TD-066
open. Evidencia: [[UX-022-VALIDATION-2026-10-30]].

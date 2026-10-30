---
id: TD-055
type: tech-debt
title: Specialized clinical staff entry gap resolved
status: resolved
severity: medium
owner: product
related_epics:
  - EPIC-18
  - EPIC-06
related_stories:
  - REP-001
  - REP-006
  - UX-012
  - UX-013
  - UX-014
  - UX-015
  - UX-016
  - UX-017
related_decisions:
  - "DEC-065"
  - "DEC-084"
created: 2026-10-19
updated: 2026-10-30
---

# TD-055 — Specialized clinical staff entry gap resolved

## Cierre funcional — UX-017, 2026-10-30

Tratamientos (UX-015), estudios (UX-016) y pesos (UX-017) disponen de entrada y
corrección staff desde la ficha, junto a vacunas/desparasitación de REP-010.
Pesos implementa KG explícito, precisión exacta y confirmación auditada para
asignar KG a valores desconocidos, sin inferir o convertir históricos. Lectura
staff diferencia KG/null y rangos por unidad. Cambio de esquema aditivo sin
default ni backfill, probado solo en bases desechables; sin despliegue sobre
datos operativos. Ver [[UX-017-VALIDATION-2026-10-30]].

Se cierra la falta funcional de superficie staff tras los gates de UX-017; no se
certifica revisión visual ni Playwright. La recomendación original de E2E y los
límites de navegación, concurrencia, idempotencia y respuesta incierta quedan
explícitos en [[TD-066]]. Los apartados siguientes conservan los estados
históricos, no describen pendientes actuales.

## Estado actual — UX-012, 2026-10-30

[[UX-012]] agrega consulta paginada y detalle de tratamientos dentro de la ficha
del paciente. No incluye creación ni corrección: esta deuda continúa `open`.
Tratamientos ya tiene lectura staff; estudios y pesos siguen API-only. El
hallazgo y la división de alcance siguientes conservan el contexto original. No
se reclama cobertura visual ni Playwright por las pruebas de componentes.

## Estado actual — UX-013, 2026-10-30

[[UX-013]] agrega consulta paginada y detalle de estudios. Tratamientos y
estudios tienen lectura staff; entrada/corrección de ambos sigue pendiente,
igual que la superficie de pesos. La deuda permanece open; no se cierra por una
entrega de lectura ni por pruebas de componentes.

## Estado actual — UX-014, 2026-10-30

Los tres tipos pendientes ya tienen lectura staff: tratamientos, estudios y
pesos. Ninguno gana creación/corrección en estas etapas; esta deuda sigue open.
El contrato de peso guarda cantidad/fecha, sin unidad: UX-014 lo indica
explícitamente y [[DEC-084-weight-measurement-unit]] propone definir la unidad y
los históricos antes de habilitar entrada/corrección. No se infiere kg.

## Estado actual — UX-015, 2026-10-30

Tratamientos ya tiene creación y corrección explícitas mediante contratos
existentes, con confirmación, auditoría y contexto de listado conservado. La
deuda se reduce a estudios y pesos; permanece open. Unidad de peso aún requiere
definición aprobada (DEC-084); límites de comandos/formulario de tratamientos se
registran en [[TD-066]]. Las secciones anteriores son estados históricos.

## Estado actual — UX-016, 2026-10-30

Estudios ya tiene entrada/corrección confirmada y auditada por contratos
existentes. TD-055 queda abierto exclusivamente para entrada/corrección de
pesos, incluyendo la definición aprobada de unidad/históricos de DEC-084.
Tratamientos y estudios comparten los límites explícitos de TD-066; no se
pretende resolverlos mediante validación frontend.

## Decisión de unidad aprobada — 2026-10-30

[[DEC-084-weight-measurement-unit]] fue aceptada por el responsable del
producto: KG para nuevas cargas staff, hasta tres decimales exactos. PRD §12.1
actualizado explícitamente. Históricos/consumidores sin unidad permanecen
desconocidos, sin conversión ni backfill automático. La definición ya no está
pendiente; sí su implementación, validación y entrada/corrección de pesos.
TD-055 sigue open. Las secciones anteriores conservan el estado histórico de
cada entrega.

## What was found

Discovered while implementing [[REP-001]], which had assumed a vaccination form
existed to extend. It does not.

`apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx` (693 lines)
handles **encounters** only: create a draft, close it, amend it. There is no
staff form for any of the five specialized clinical record kinds that
`apps/api/src/clinical/clinical.records.controller.ts` exposes and `apps/api`
fully implements:

```text
kind          API routes                                                      staff UI
treatments    GET|POST /patients/:patientId/clinical/treatments               UX-012 read; UX-015 entry/correction
vaccinations  GET|POST /patients/:patientId/clinical/vaccinations             REP-010
deworming     GET|POST /patients/:patientId/clinical/deworming                REP-010
studies       GET|POST /patients/:patientId/clinical/studies                  UX-013 read; UX-016 entry/correction
weights       GET|POST /patients/:patientId/clinical/weights                  UX-014 read-only; no entry
```

**Narrowed by [[REP-010]]** ([[DEC-067]]): vaccinations and deworming gained a
staff surface, because [[EPIC-18]] introduced `next_due_at` on exactly those two
kinds and therefore owned the smallest path that can fill it. The three kinds
with `none` remain API-only, which is what this item now tracks.

Three surfaces exist for them and none is a staff write path:

- the API, complete with validation, audit and permissions;
- a web BFF proxy, `apps/web/src/app/api/clinical/[[...path]]/route.ts`, so the
  browser _can_ reach them;
- the **portal**, read-only (`portal-pet-detail.tsx` renders what is there).

So a tenant can display a patient's vaccinations to its owner but has no screen
on which to record one. The capability is reachable only by calling the API
directly, which no staff role does.

## How the gap divided, and why

PRD §31 asks for "upcoming/overdue vaccines" and "upcoming deworming".
[[DEC-065]] made those computable by adding a nullable `next_due_at`, entered by
staff, because the veterinarian knows the booster interval and the system must
not guess it.

[[REP-001]] delivered the column and the API contract, and **could not deliver
the entry surface, because there was no surface to add a field to.**

[[DEC-067]] then split the gap on a boundary instead of taking all of it:

- **vaccinations and deworming → [[REP-010]]**, because this epic introduced the
  field those two kinds carry. An epic that creates a field and ships the report
  reading it owns the smallest path that can fill it.
- **treatments, studies and weights → this item**, because no report this epic
  delivers reads them. They have different shapes (dose, study type, weight plus
  unit) and together they are a UI epic, not a work unit.

The proxy (`apps/web/src/app/api/clinical/[[...path]]/route.ts`) already
allowlists all five kinds and `vet.clinical.create/update/read` are already
seeded and granted, so REP-010 needed neither: it is a client module and a form.

## What a fix would need

- A staff surface for the five record kinds under the patient workspace, reusing
  the BFF proxy that already exists.
- A decision on whether these records are edited after creation. The API exposes
  `PATCH`; the UI has no `PATCH` story. [[REP-001]] made `next_due_at` clearable
  by an explicit `null`, which presumes editing is eventually possible.
- Permission and empty/error states consistent with the encounter workspace.
- Playwright coverage in `apps/e2e`, which the workspace has none of today.

## Why it is not simply "EPIC-06 forgot"

[[EPIC-06]] closed on its own acceptance criteria, which covered the encounter
aggregate and its invariants; the specialized records were delivered as API
capability. Nothing in that epic's scope said otherwise, and this item does not
reopen it. It records that the _combined_ state of the product ships a
displayable but unrecordable clinical history, which is a product gap rather
than a defect in either epic.

## Pointers

- `apps/web/src/app/(app)/app/patients/[id]/clinical-workspace.tsx` — the
  surface that stops at encounters.
- `apps/api/src/clinical/clinical.records.controller.ts` — the five route groups
  and their permissions.
- `apps/web/src/app/api/clinical/[[...path]]/route.ts` — the BFF proxy that
  already forwards them.
- [[DEC-065]] — the due date this item is the entry path for.
- [[REP-006]] — the veterinary reports that depend on it.

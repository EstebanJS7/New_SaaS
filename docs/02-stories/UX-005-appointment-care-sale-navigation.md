---
id: UX-005
type: story
title: Appointment context through care and POS navigation
epic: EPIC-06
related_epics: [EPIC-07, EPIC-12]
status: review
priority: high
depends_on: [UX-004]
prd_sections: ["12", "13", "14", "18", "19", "29"]
permissions: []
branch: main
created: 2026-10-28
updated: 2026-10-28
---

# UX-005 — Contexto de cita durante atención y venta

Primera etapa de la petición del usuario de conectar el recorrido mejorando
UX/UI. Ver [[DEC-083-appointment-clinical-sale-journey]] para la propuesta
persistente, que no se implementa en esta Story.

## Alcance

Composición frontend de lecturas y navegación existentes. ID de cita en query
string, nunca contenido clínico, importe ni identidad del tenant. Lectura actual
autorizada y comparación del paciente antes de mostrar contexto. No
persistencia, endpoint, permiso, dependencia, evento o transición financiera
nuevos. Datos de cita/profesional CONFIDENTIAL: staff-only, sin nuevos
logs/almacenamiento.

## Criterios

- [x] Desde agenda se abre la ficha conservando el ID de cita.
- [x] Ficha y POS muestran contexto autorizado, horario, estado, profesional y
      servicio; carga/error/ID inválido/paciente distinto no inventan
      asociación.
- [x] La consulta cerrada ofrece continuar al POS conservando contexto; navegar
      no crea venta, no cobra, no completa cita ni modifica registro clínico.
- [x] Lecturas sin permisos no impiden usar la ficha/POS independiente.
- [x] Pruebas dirigidas, lint, tipos y build; límites de revisión registrados.

## Verificación

- 108 casos dirigidos relacionados: 43 agenda, 45 clínica, 10 detalle de
  paciente, 5 contexto y 5 recuperación POS. El contexto se reejecutó 5/5 tras
  corregir la aserción sobre opciones GET; el enlace de agenda se reejecutó
  individualmente después de agregar su aserción de contexto.
- TypeScript y ESLint dirigidos pasaron. Build de producción y verificación de
  salida pasaron.
- Sin nueva revisión de navegador ni mutación financiera real, conforme al
  alcance acotado solicitado. Se verifica composición/estados y navegación con
  respuestas sintéticas; no se afirma validación visual completa o E2E
  persistente.
- Sin commit ni push solicitado.

## Implementación y límites

AppointmentJourney compone lecturas existentes de cita, opciones de
profesionales e identidad del paciente. Usa tokens semánticos y feedback
accesible. El ID de cita viaja como query param por página de paciente/POS;
nunca como autoridad ni como contenido de comandos financieros. No hay nuevas
migraciones/endpoints.

Esta etapa no afirma que una consulta o venta provenga formalmente de una cita.
Tampoco preselecciona cargos, responsable de facturación o profesional autor. La
segunda etapa de integración está descrita como propuesta en DEC-083; no se
cambia el PRD ni se marca esa integración como entregada.

Actualización 2026-10-28: el límite anterior describe UX-005. DEC-083 fue
aceptada y la persistencia se implementa en [[UX-006-persistent-care-links]].

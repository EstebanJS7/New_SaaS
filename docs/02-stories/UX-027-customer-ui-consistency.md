---
id: UX-027
type: story
title: Customer UI consistency and staff localization
epic: EPIC-04
related_epics: [EPIC-03]
status: done
priority: high
depends_on: [UX-010]
prd_sections: ["9", "10.1", "11", "29", "41"]
branch: main
created: 2026-10-31
updated: 2026-10-31
---

# UX-027 — Completar la experiencia de Clientes

## Contexto y autorización

Usuario aprobó preparar inventario y Story para comenzar la consistencia UI y
localización de la V1, primero Clientes y después Pacientes/Catálogo. Inventario
estático terminado en [[UX-027-BASELINE-2026-10-31]]. ID UX-027 libre verificado
en docs y comandos antes de crearlo. La Story pasó de ready a in-progress antes
del código en esta continuación; la evidencia de implementación y verificación
se registra al final.

El listado ya fue completado en UX-010. Se trabaja sobre las superficies de
Clientes existentes, con DEC-080 y ADR-002; sin cambio de producto, PRD,
arquitectura, backend, esquema, permisos o comandos. Las siguientes etapas de
Pacientes/Catálogo tendrán Stories propias.

## Alcance

- Defaults staff de feedback y error de ruta, conservando configuración
  explícita de consumidores y las protecciones de navegación de UX-025.
- Listado como regresión; alta y edición de persona/empresa, detalle de cliente,
  alta/listado/desactivación de direcciones/contactos y desactivación de
  cliente.
- Etiquetas/ayudas españolas, estados claros, errores accesibles, pendiente y
  éxito, layout adaptable y comportamiento de cancelación/salida definido.
- Mensajes seguros a partir de códigos/status del contrato existente, con tipos
  locales en Customers y validación de payload desconocido si es necesario.

## Criterios de aceptación

- [x] Alta, edición, detalle, direcciones/contactos y estados de Clientes usan
      terminología española consistente; enums enviados y nombres/datos del
      usuario se conservan. No forzar traducciones de valores personales.
- [x] Inputs/selects tienen etiquetas visibles asociadas, instrucciones y
      required comprensibles. Errores de reglas ya existentes identifican campo
      y enfocan el primero inválido; no truncar ni borrar entrada tras rechazo.
- [x] Pendiente impide envíos repetidos; éxito/anuncios se basan en respuesta
      confirmada. Fallo incierto conserva datos sin retry automático ni afirmar
      que no hubo escritura. La consulta de estado no prueba una creación por
      comparar nombres/valores.
- [x] Cancelación/enlaces explícitos con cambios sin guardar advierten y dejan
      volver al formulario. Documentar el límite de Back/Forward, recarga y
      reingreso; no prometer borrador durable ni interceptar historial global.
- [x] Carga, vacío, error/reintento de lectura, 401/403/404 y ausencia de dato
      son distinguibles. Acciones usan los permisos disponibles sin inferir
      escritura desde lectura; backend sigue siendo autoridad. Nunca reintentar
      una mutación automáticamente al resolver sesión/permisos.
- [x] Diálogos de desactivación conservan consecuencia, cancelación sin comando,
      bloqueo pendiente y error visible con retorno de foco. Confirmar no genera
      dobles submits ni añade borrados físicos.
- [x] Persona/empresa y campos condicionales mantienen cuerpos actuales, kind
      inmutable en edición y semántica omisión/vacío/null. Contactos siguen las
      reglas vigentes; no añadir regex/email/teléfono/RUC nuevas (TD-059).
- [x] Navegación lista→detalle→edición→retorno preserva contexto UX-010 durante
      diez minutos en el mismo documento. Búsqueda/datos personales no llegan a
      URLs, logs o almacenamiento persistente del navegador.
- [x] Se reutilizan componentes/tokens y formatos existentes. Defaults
      compartidos y error staff quedan en español, con regresión de consumidores
      afectados; sin nueva librería, framework de formularios, colores de marca
      literales o loading.tsx global.
- [x] Pruebas significativas de formulario/detalle y regresión de listados,
      feedback/diálogos, lint, tipos, build aislado/verificador aprobados. No
      modificar tests solo para hacerlos pasar ni debilitar escenarios.
- [x] Lane de navegador de Clientes con backend/base desechables y datos
      sintéticos aprobada; revisión de escritorio/390 px, claro/oscuro, textos
      largos, teclado, errores/foco y diálogos documentada con capturas. Sin
      bases dev/operativas o equivalencia entre simulación y navegador real.
- [x] Story, Customers, guía, QA y changelog de comportamiento actualizado;
      limitaciones y deuda registradas. Done solo cuando todos los gates pasen.

## Fuera de alcance

Pacientes/Catálogo solo inventariados; no se implementan aquí. Sin cambios de
clínica/Portal/agenda/POS/finanzas/inventario; no agregar edición de contactos o
direcciones actualmente sin control UI, campos o validaciones de producto. Sin
backend nuevo, CAS/idempotencia de Customers, filtros nuevos, recuperación
persistente de formularios, política de retención o migraciones. No resolver
TD-059, TD-007 completo ni cerrar las Stories UX anteriores por inferencia. Sin
commit/push, despliegue o CI remota asumida.

## Mapa de implementación

- `apps/web/src/components/feedback.tsx`
- `apps/web/src/components/confirm-action-dialog.tsx` (reutilizar; cambios solo
  si existe un defecto demostrado que afecte a este alcance)
- `apps/web/src/app/(app)/error.tsx`
- `apps/web/src/app/(app)/app/customers/customer-form.tsx`
- `apps/web/src/app/(app)/app/customers/customers-api.ts`
- `apps/web/src/app/(app)/app/customers/new/page.tsx`
- `apps/web/src/app/(app)/app/customers/[id]/edit/page.tsx`
- `apps/web/src/app/(app)/app/customers/[id]/customer-detail.tsx`
- Listado, estado de búsqueda y pruebas: preservar UX-010 y ampliar regresión
  según consumidores; no cambiar sus contratos por uniformidad visual.

## Secuencia de trabajo

1. Al empezar implementación, confirmar Git y cambiar a in-progress con fecha y
   rama; conservar todos los cambios locales de UX-026/TD-068.
2. Aplicar ajustes compartidos mínimos y localizar formularios/detalle de
   Clientes.
3. Completar accesibilidad de campos/errores y estados de interacción,
   respetando límites de contratos y recuperación indicados arriba.
4. Verificar según el inventario, corregir fallos del alcance y registrar
   evidencia de cada gate; reconciliar documentación al finalizar.
5. Después preparar la Story de Pacientes, seguida por Catálogo, reutilizando el
   patrón verificado sin convertirlo en una abstracción genérica.

## Datos y seguridad

Identidad, documento/RUC, direcciones y contactos siguen CONFIDENTIAL. No nuevos
campos persistentes, telemetría de payloads o exportaciones. Tenant proviene
siempre de sesión servidor; aislamiento y permisos del backend no se alteran.
Fallbacks seguros de errores no incluyen datos del cliente ni excepciones
internas. Datos y credenciales de prueba exclusivamente sintéticos y temporales.

## Implementación y verificación

Implementados los defaults de feedback/error staff y las superficies existentes
de Clientes. Helpers locales de interacción/errores, campos accesibles y
sanitización; sin cambios de contratos, backend, esquema o permisos. Preservadas
semánticas de vacíos, enums y datos privados. Layout móvil corregido después de
inspeccionar capturas, no solo por ausencia de scroll horizontal.

Pruebas y checks en [[UX-027-VALIDATION-2026-10-31]]. 159 casos distintos de
simulación/regresión aprobados; recheck de Clientes/feedback 39/39 sin sumar
repeticiones. Lane final real 5/5, 27,8 s, retries=0, PostgreSQL/Redis tmpfs
propios retirados. Builds aislados reference/database, API y web/verificador,
lint/tipos y formato/diff aprobados. Tres capturas finales inspeccionadas en
matriz acotada desktop/claro y 390 px/oscuro. No certificación de otras matrices
o accesibilidad universal. Sin migraciones/endpoints/dependencias, commit/push o
CI remota asumida. UX-027 done dentro de este alcance.

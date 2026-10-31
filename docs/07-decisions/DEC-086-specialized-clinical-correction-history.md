---
id: DEC-086
type: decision
title: Immutable correction history for specialized clinical records
status: accepted
date: 2026-10-30
updated: 2026-10-30
related_epics: [EPIC-06]
related_stories: [UX-023]
prd_change_required: true
---

# DEC-086 — Historial de correcciones de tratamientos, estudios y pesos

## Contexto

Usuario autorizó proponer esta etapa y consultar decisiones de producto antes de
implementar. UX-019–022 resuelven idempotencia y CAS para clientes protegidos,
pero las correcciones sobrescriben contenido actual. La auditoría registra actor
y campos enviados; no conserva sus valores anteriores. TD-066 mantiene ese
historial pendiente. PRD §§12.1/13/27/41 cubre historia clínica, auditoría y
clasificación, sin definir este historial de correcciones especializado.

Esta propuesta hace explícito el nuevo comportamiento. No convierte estos
registros en consultas cerradas ni extiende sus reglas de amendment a ellos.
DEC-085 sigue siendo una propuesta independiente sobre obligatoriedad pública de
claves/versiones; esta decisión no la acepta ni activa su corte.

## Pregunta y opciones

1. Conservar solamente auditoría de campos, como hoy: menor persistencia, sin
   consulta de contenido anterior.
2. Guardar revisiones clínicas específicas e inmutables, con estado anterior y
   posterior, actor e instante. Recomendada.
3. Añadir una plataforma genérica de historial o event sourcing. No necesario
   para este caso y fuera del presupuesto de complejidad; no recomendado.

## Propuesta concreta

- Alcance: correcciones futuras mediante servicios/PUT de tratamientos, estudios
  y pesos. También capturar clientes legados sin expectedVersion sin fingir que
  están protegidos contra sobrescritura. Las escrituras SQL directas fuera de
  esos comandos no tendrán actor clínico garantizado; no inventarlo.
- Guardar antes/después completos de los campos clínicos tipados, versión
  anterior/nueva, actor autenticado y momento de corrección. Identidad estable
  del actor y nombre mostrado al momento, sin email/credenciales; el nombre es
  un snapshot descriptivo, no autoridad para autorizar lecturas.
- Conservar cantidades Decimal exactas, unidad KG/null y todos los instantes con
  precisión existente; fecha clínica y fecha de corrección se muestran como
  conceptos diferentes, en es-PY/Paraguay. Sin inferir o convertir unidades.
- Revisiones específicas de Veterinary, mediante tres tablas tipadas vinculadas
  a su registro/tenant/paciente; sin EAV, motor genérico, evento asíncrono o
  valores clínicos metidos en audit_log. Auditoría operativa existente conserva
  su cometido y se vincula a la revisión dentro de la misma transacción.
- Bloquear el registro scoped antes de leer el estado anterior incluso para el
  PUT legado, comprobar CAS cuando llegó versión, escribir registro/revisión/
  auditoría juntos. Fallo de cualquiera revierte todo.
  Conflicto/denegación/no-op vacío no crea revisión. Una escritura con campos
  presentes e iguales conserva la semántica vigente de versión/auditoría y
  registra la operación sin inventar diferencias de valores.
- Lectura staff paginada del historial, más reciente primero, con comparación
  antes/después y actor/instante. Recomendación de UI: acción Ver historial en
  cada registro y vista de solo lectura; no restaurar, borrar o editar una
  revisión. Una nueva corrección sigue el flujo autorizado y versionado actual.
- Sin backfill de hechos desconocidos: para registros previos, la primera
  corrección bajo este mecanismo conserva su estado previo real como baseline.
  No se reconstruyen modificaciones pasadas desde timestamps, versión, recibos
  de creación o nombres de campos auditados. Informar que la cobertura comienza
  con este mecanismo; un historial vacío no prueba ausencia de cambios previos.
- Creaciones no añaden una segunda auditoría/revisión de corrección; replay de
  creación UX-019 no genera historial ni auditoría nuevos. El alcance no vuelve
  idempotente PUT ni habilita retry automático de una corrección incierta.

## Decisiones de producto aceptadas (1/1/1)

| Tema                  | Recomendación                                                                                                                               | Alternativas                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Motivo                | Obligatorio en el nuevo formulario de corrección; API legado sigue aceptando omisión y se muestra Sin motivo informado                      | Opcional en el formulario; o sin campo de motivo en esta etapa |
| Lectura del historial | Permiso específico vet.clinical.history_read, asignación inicial a OWNER/ADMIN/VETERINARIAN; además de lectura clínica, tenant y veterinary | Compartir el permiso actual de lectura clínica                 |
| Presentación inicial  | Historial por registro desde su detalle                                                                                                     | Vista unificada de los tres tipos en el paciente               |

Motivo obligatorio en UI no implica garantía universal: mientras API legado lo
admita omitido, no se asegura un motivo en cada integración. Validar el campo en
backend cuando exista; no fabricar una explicación ni extraerla del texto
clínico. La obligatoriedad pública requeriría otra transición explícita.

Las preferencias de esta tabla se consultarán al usuario. No están aceptadas por
haber sido recomendadas. La vista unificada cambia el alcance de consulta/ UI y
deberá quedar reflejada en Story si se elige.

## Impacto y clasificación

Producto: nueva consulta de contenido previo y, si se aprueba, entrada de
motivo. Arquitectura: mismo monolito/stack y límites Core/Veterinary; no
infraestructura, dependencias o abstracción consumida por otros dominios. La
autorización se aplica en backend; Portal y otros tipos clínicos quedan fuera.

Datos nuevos: snapshots clínicos, motivos, asociaciones, versiones, actor y
nombre histórico CONFIDENTIAL. Acceso scoped por organización/paciente/tipo;
UUID ajeno responde 404. DTOs allowlisted, no-store, sin contenido en URL/logs o
Storage. Historial inmutable en aplicación y con restricciones DB, sin purga
automática o política destructiva nueva. No exportación de historial en esta
etapa.

API: lecturas nuevas aditivas y motivo opcional en PUT, manteniendo DTOs de
comandos existentes y clientes legados; autorización/granularidad y protecciones
UX-019/020/022 intactas. Sin mecanismo que cambie automáticamente el baseline de
la corrección para evitar un conflicto.

Entrega: tras resolver preferencias y aceptar decisión, actualizar PRD de forma
explícita y acotada, iniciar UX-023, crear migraciones reproducibles y validar
exclusivamente con PostgreSQL desechable. Pruebas de atomicidad, concurrencia,
aislamiento/autorización, cobertura legada, snapshots exactos/inmutabilidad,
replay y regresión UI/proxy/recuperación; lint/tipos/builds aislados. Determinar
con la Story una verificación visual/E2E acotada del nuevo flujo; no atribuir a
UX-021 evidencia de una interfaz que aún no existe.

## Decisión y actualización de PRD

Usuario eligió explícitamente las tres primeras opciones (1/1/1) y autorizó
continuar el 2026-10-30. Se aceptan las recomendaciones de motivo, permiso y
vista por registro. Comportamiento incorporado explícitamente en §§13.2/27 y
referencia desde §12.1 sin modificar cantidades/unidades aprobadas. No se altera
consultas cerradas, vacunas/desparasitación, Portal, finanzas, inventario,
vínculos o recuperación durable de formularios.

Implementación UX-023: captura OLD/NEW mediante triggers específicos de las tres
tablas; contexto transaccional local de actor/motivo/ID desde el comando
servidor. UPDATE ya mantiene el lock de fila antes de capturar OLD/NEW. Una
escritura directa sin contexto queda con actor/motivo no informados, sin
inventarlos; no se promete su auditoría de aplicación. Dentro del servicio,
revisión y auditoría se vinculan por ID y comparten commit/rollback. El comando
confirma la revisión por ID/alcance/versión antes de auditar; captura ausente
revierte la corrección. Capacidad mínima patient-scoped integra el permiso en la
ficha real; toda consulta de revisiones vuelve a autorizarse en backend. Ver
[[UX-023-VALIDATION-2026-10-30]] para pruebas, migración y límites.

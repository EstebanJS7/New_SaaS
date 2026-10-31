---
id: DEC-087
type: decision
title: Durable drafts for specialized clinical forms
status: accepted
date: 2026-10-31
updated: 2026-10-31
related_stories: [UX-018, UX-019, UX-020, UX-022, UX-023, UX-024]
prd_change_required: true
---

# DEC-087 — Borradores recuperables tras recargar

## Contexto y pregunta

UX-018 conserva formularios durante diez minutos en memoria del documento. El
código actual no persiste ni deshidrata esas copias. UX-019 conserva el intento
lógico de creación y UX-020 bloquea correcciones inciertas; UX-023 añade motivo
e historial, sin recuperación durable. Al proponer esta decisión, PRD §13.2
excluía esta capacidad y TD-066 la mantenía pendiente.

¿Extender la recuperación de tratamientos, estudios y pesos para sobrevivir
recarga/cierre sin introducir datos clínicos en almacenamiento del navegador?
DEC-087 estaba disponible al iniciar esta propuesta. Tras aceptación explícita
1/1/1, UX-024 se inició y PRD §13.3 incorporó el alcance autorizado. DEC-085
sigue propuesta independiente: no se retira compatibilidad pública.

## Opciones

1. Mantener recuperación actual por documento: sin nuevos datos persistentes,
   pero recarga/cierre pierde el formulario.
2. Guardar borradores explícitamente en PostgreSQL mediante «Guardar borrador»:
   recuperación autorizada al volver a la ficha. Recomendada como primera etapa;
   no promete conservar cambios posteriores que el usuario no guardó.
3. Autoguardado en servidor: requiere estados de sincronización, gestión de
   escrituras concurrentes y comunicación clara de fallos. Mayor alcance.

## Recomendación para resolver con el usuario

- Guardado explícito; inicialmente borradores privados del autor, con
  tenant/membresía/paciente/veterinary y permisos clínicos actuales revalidados
  en cada operación. Recuperar o descartar siempre explícitos. Compartir con
  equipo sería otra política, no un efecto de tener permiso de historial.
- Sin vencimiento o purga automática nuevos. Descartar o completar retira la
  copia de la lista recuperable mediante estado lógico y conserva el contenido
  en servidor hasta aprobar una política de retención. Esto implica crecimiento
  y persistencia de datos, que deben aceptarse expresamente; no significa que un
  borrador sea un registro clínico confirmado ni que deba conservarse para
  siempre. No prometer borrado físico ni de backups.
- Mantener campos, fechas/unidades exactas, baseline original, motivo y comando
  congelado con su clave de creación. Al recuperar, releer autorización y
  versión; jamás regenerar clave de un intento enviado ni rebasar una
  corrección.

El usuario aceptó explícitamente las tres primeras opciones (1/1/1) el
2026-10-31: guardado manual, solo autor y descarte lógico sin purga automática.
Esta aceptación no activa el corte público de DEC-085.

## Garantías exigidas antes de implementar

- Separar borrador no enviado, intento pendiente/incierto y registro confirmado.
  Guardar borrador no crea ni corrige un registro clínico. Actualizaciones de
  borrador necesitan versión propia para evitar pérdidas entre pestañas.
- Antes de enviar una creación recuperable, persistir de forma confirmada la
  clave y el comando inmutable; si falla esa preparación, no afirmar protección
  durable. Guardar solo los campos y generar otra clave al recuperar duplicaría
  el riesgo que UX-019 resolvió.
- Si la creación pudo confirmar, recuperación usa exclusivamente la misma
  clave/comando con autorización backend e idempotencia; nunca comparar valores
  para deducir éxito. Peso con ID confirmado solo relee proyección staff.
- Corrección pendiente/incierta permanece bloqueada tras recarga; no reenviar ni
  deducir éxito por contenido/versión. Su estado durable debe existir antes del
  envío; una caída no puede convertirla de nuevo en borrador reenviable.
- Validar payloads y transiciones, conflictos entre pestañas, cambio de sesión,
  revocación y aislamiento entre autores/tenants/pacientes/tipos. No almacenar
  cookies, tokens ni autorización en el borrador.

## Impacto y entrega

Producto: incorporar únicamente las opciones aceptadas al PRD §§13/41 y crear
Story con ID verificado e in-progress antes de código. No modificar criterios de
Stories cerradas ni añadir otros formularios, Portal o exportación.

Arquitectura/base/API: Veterinary específico, PostgreSQL/Prisma y BFF
existentes, sin framework genérico, dependencia, servicio o almacén nuevos.
Esquema y rutas aditivas por definir en la Story; contratos clínicos actuales
compatibles. No migrar memoria de documentos existentes ni aplicar migraciones a
base dev.

Datos: contenido, motivo, baseline, IDs, clave/comando y asociación de autor son
CONFIDENTIAL. Solo servidor; no localStorage, sessionStorage, IndexedDB, URL,
logs o telemetría de payloads. Auditoría de acciones con IDs/metadatos mínimos.
La clasificación no sustituye definir permisos o retención/backups.

Verificación: pruebas acotadas API/BFF/componentes y PostgreSQL desechable real
para estados, carreras, rollback y respuesta perdida; lint/tipos/builds
aislados. La futura Story debe definir una comprobación de recarga real en
navegador, porque las pruebas de memoria UX-018 o el historial UX-023 no la
acreditan. Conservar cambios locales acumulados; sin commit/push o datos
operativos.

## Implementación y estado

UX-024 implementada conforme a las opciones aceptadas; migración
20261031000001_clinical_working_draft y rutas aditivas drafts. 675 casos
automatizados y ocho E2E nuevos aprobados en selecciones explícitas, seis
capturas revisadas. La Story quedó review por TD-067; UX-025 resolvió la
recurrencia observada y aprobó dos lanes completas 26/26, incluidos los 25 casos
clínicos y 50 contextos fríos por ronda. UX-024 done, sin borrar fallos previos
o afirmar estabilidad universal. Ver [[UX-024-VALIDATION-2026-10-31]] y
[[UX-025-VALIDATION-2026-10-31]] para semántica transaccional y límites.

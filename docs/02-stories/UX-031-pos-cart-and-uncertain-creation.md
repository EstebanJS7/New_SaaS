---
id: UX-031
type: story
title: Protect local POS cart and uncertain sale creation
epic: EPIC-12
status: done
priority: high
depends_on: [POS-004, UX-030]
prd_sections: ["18", "19", "29", "41"]
branch: main
created: 2026-11-01
updated: 2026-11-01
---

# UX-031 — Carrito local y creación incierta

Continuación autorizada de UX-030 y TD-071. Protección UI compatible con el
contrato vigente, sin idempotencia nueva de creación ni recuperación durable.

## Criterios

- [x] Un intento pendiente impide doble envío síncrono y edición; una creación
      incierta (transporte, 5xx o respuesta sin ID válido) conserva valores y
      bloquea edición/reenvío. No ofrece empezar otra venta en ese estado ni
      infiere éxito por comparar filas. Mensajes sanitizados sin payload privado.
- [x] Rechazo definido permite corregir; autenticación/permisos/entitlement
      denegados bloquean comandos. Creación confirmada conserva su ID y flujo
      de pago existente; finalización incierta sigue requiriendo lectura por ID.
- [x] Enlaces salientes del documento con carrito/cliente local ofrecen diálogo
      explícito, cancelación segura y advertencia beforeunload. Durante comando
      pendiente no se confirma salida por enlaces. Después de resultado incierto
      salir advierte que no cancela ni confirma la operación. Sin router/history
      patch, almacenamiento persistente o recuperación automática tras recarga.
- [x] Mantener cantidades/precios exactos, cliente elegido, revisión explícita,
      permisos backend, asociaciones, pagos/caja/stock y contratos sin cambios.
- [x] Pruebas UI/regresión/proxy pertinentes, lint/tipos y builds aislados con
      binarios instalados. PostgreSQL desechable + navegador: respuesta POST
      confirmada en servidor pero perdida en cliente, un solo borrador/auditoría,
      sin pagos/stock/caja ni reenvío; salida cancelada/confirmada y pendiente.
      Revisión visual escritorio claro/móvil oscuro, foco y Escape.
- [x] Story, Sales, TD-071, continuidad, changelog y QA con límites separados.

## Límites

Datos comerciales CONFIDENTIAL, solo memoria de componente, sin logs/payload
en URL/browser storage. No nuevo protocolo, endpoint, migración, dependencia,
abstracción genérica, retención/purga o alcance PRD nuevo. No cambios clínicos,
Portal, cálculos, impuestos, pagos, inventario o caja. Confirmar salida descarta
solo copia local, nunca cancela venta backend. Back/Forward SPA programático
no se intercepta; beforeunload depende del navegador y no impide cerrar por
fuerza. Tras recarga no existe recibo durable sin ID: revisión manual del listado,
sin identificación automática por valores. No certificar todo POS o UI V1.
TD-072 runtime y TD-069 teardown permanecen independientes. Sin commit/push.


## Implementación y cierre — 2026-11-01

CounterSurface valida el recibo UUID/DRAFT y conserva la copia bloqueada si
crear no tiene resultado confirmado. Rechazo definido permite corregir; acceso
denegado bloquea. Guardia síncrona impide doble envío. useCounterExit es local
al POS, sin abstracción compartida, patch de router/history o persistencia.
Confirma descarte local por enlace; pendiente no permite confirmar salida.
Mensaje incierto aclara que salir no cancela ni confirma el comando. No cambios
en API/BFF/backend financiero, endpoints, permisos, migraciones o dependencias
por esta Story. No PRD nuevo: aplica protecciones UI al contrato aprobado.

184 casos distintos aprobados en15 archivos; selección ampliada181/182 seguida
de corrección del mensaje de permiso existente y recheck21/21 del archivo
final con dos casos nuevos. Lint web completo/final dirigido, tipos web/E2E,
lint E2E/config, formato y diff-check aprobados. Builds referencia/database, API
y Next aislados y verificador aprobados. Navegador/PG real:8 escenarios previos
aprobados con producto final y5 nuevos aprobados en selección acotada, sin
retries; no afirmar una ejecución única13/13. Intentos fallidos/omisión de
selección y corrección de selector conservados en QA. Capturas escritorio claro
y móvil oscuro revisadas, foco/Escape y ausencia de desborde comprobados.

Respuesta POST201 real abortada en transporte cliente conserva una ventaDRAFT,
una auditoría y cantidades/precios/cliente exactos; cero reenvío o nuevos
pagos/stock/caja. Pendiente se simula reteniendo transporte antes de enviar,
luego recibe respuesta real. Permiso403 real sin efectos. Creación/revisión
no prueba cobro completo. TD-071 se mantiene abierta por límites de recarga,
Back/Forward SPA y ausencia de recuperación durable sin ID; controles actuales
están implementados, no protocolo nuevo. TD-069/072 independientes siguen abiertas.
QA [[UX-031-VALIDATION-2026-11-01]]. Sin commit/push, despliegue o CI remota.

---
id: DEC-085
type: decision
title: Required clinical write guards before production
status: accepted
date: 2026-10-30
updated: 2026-10-31
related_stories: [UX-019, UX-020, UX-022, UX-026]
prd_change_required: true
---

# DEC-085 — Contratos clínicos obligatorios antes de producción

## Revisión aceptada antes de producción — 2026-10-31

Usuario aclaró que el producto aún no está en fase productiva y aprobó continuar
con contrato obligatorio para consumidores controlados, después de TD-067. Se
sustituye la transición prolongada propuesta originalmente por un ajuste
preproductivo explícito: POST de tratamientos/estudios/pesos requiere clave; PUT
requiere baseline original y motivo no vacío. Migrar juntos API, BFF,
comandos/consumidores locales, fixtures/scripts y pruebas, sin claves generadas
por servidor/proxy ni lecturas para reemplazar baselines de comandos enviados.

No se afirma desde un censo local que se verificaron integraciones externas; no
hay un despliegue/corte operativo autorizado o ejecutado aquí. El contrato
vigente permanece opcional hasta implementar UX-026. Actualizar PRD de manera
explícita al iniciar esa Story. No añadir dependencias, alterar DTO de respuesta
de peso, reinterpretar unidades desconocidas, purgar recibos/historial o migrar
bases configuradas/dev. Las secciones siguientes conservan el contexto y la
propuesta histórica del 2026-10-30; prevalece esta revisión aceptada.

## Contexto y pregunta

UX-019/020 añadieron idempotencyKey/expectedVersion opcionales para preservar
consumidores anteriores. UX-022 inventarió el código local: los tres formularios
staff ya los envían; ahora sus transportes impiden omitirlos en tipos y antes de
red. No se encontraron otros escritores de aplicación de estos tres tipos en el
repo; fixtures/tests directos no son un censo de integraciones desplegadas.

¿Cuándo y cómo exigir ambos campos en los contratos públicos existentes sin
romper consumidores desconocidos? La propuesta trata solamente tratamientos,
estudios y pesos; no modifica consultas, vacunas, desparasitación o Portal.

## Opciones

1. Exigirlos inmediatamente. Cambia POST/PUT actuales y rompe consumidores que
   omiten campos; no se recomienda ni se implementa.
2. Mantener compatibilidad indefinida. No rompe contratos, pero no ofrece
   garantías globales: un POST sin clave puede duplicar y un PUT sin versión
   puede sobrescribir, aunque el trigger avance la versión.
3. Transición explícita por etapas, con censo de integraciones y aprobación del
   corte. Recomendada; UX-022 ejecuta solo la etapa local compatible.

## Recomendación y condiciones de corte

1. API/esquema UX-019/020 primero, UI protegida después. Una API antigua
   estricta debe rechazar campos nuevos antes de escribir; ningún cliente nuevo
   elimina la protección para reintentar una operación rechazada o incierta.
2. Mantener opcionales los campos en API/BFF actuales durante el inventario de
   integraciones. No generar claves en el proxy ni obtener una versión nueva
   para salvar una corrección cuyo baseline perdió la carrera.
3. Para cada consumidor externo identificado: registrar responsable/versión y
   ruta, migrarlo y comprobar replay después de respuesta perdida, misma clave
   con contenido diferente, CAS con conflicto y unidades legacy/DTO de peso. La
   clave nace una vez por intento lógico en el consumidor y se conserva en sus
   reintentos; expectedVersion procede de su lectura original autorizada.
4. Revisar explícitamente el censo y la evidencia con los responsables antes de
   aprobar el corte. La ausencia de llamadas observadas o de código en este repo
   no prueba que no existan consumidores. No hay fecha de caducidad inventada.
5. La futura Story del corte define contrato/error/versionado y plan de
   despliegue antes de implementar obligatoriedad. Esta propuesta no autoriza a
   activar flags, rechazar cuerpos legados ni retirar rutas ahora. Si aparece
   una garantía de producto nueva o cambio de alcance, deberá aprobarse antes de
   actualizar PRD; no se modifica silenciosamente.
6. Revalidar autorización, aislamiento, filas/auditoría única, carreras y
   rollback en PostgreSQL desechable. Un rollback de UI no justifica quitar
   guardias o reinterpretar datos/recibos ya guardados; no eliminar recibos ni
   reiniciar versiones como mecanismo de reversión.

## Impacto

Producto/arquitectura: la etapa local no añade capacidades, infraestructura ni
PRD. La obligatoriedad global sigue propuesta, no aceptada ni activada. Backend,
BFF y DTOs legados mantienen semántica; tampoco se convierte unidad desconocida
a KG. No se vuelve idempotente PUT ni se habilitan reintentos inciertos de PUT.

Base: no nueva migración, backfill, retención o borrado. Claves, versiones y
recibos siguen CONFIDENTIAL por asociación clínica; el inventario no copia
contenido clínico, credenciales o cookies a documentación/logs/URLs/Storage. No
se añade telemetría de payloads. Evidencias usan exclusivamente fixtures
sintéticas y PostgreSQL temporal. TD-066 conserva este corte como pendiente.

## Estado de la propuesta original (sustituida)

Propuesta para la futura obligatoriedad pública. La etapa local compatible está
autorizada e implementada en UX-022; no equivale a aprobar esta decisión ni a
cerrar la transición de consumidores externos.

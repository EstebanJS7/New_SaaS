---
id: UX-034
type: story
title: Cash unresolved attempt guards and v1 tenant dates
epic: EPIC-13
status: done
priority: high
depends_on: [UX-033]
prd_sections: ["20", "29", "41"]
branch: main
created: 2026-11-02
updated: 2026-11-02
---

# UX-034 — Intentos de Caja y fechas de la zona v1

Continuación autorizada de TD-073 y fechas. La plataforma ya fija la zona v1 en
packages/shared/src/platform.ts (America/Asuncion); no existe selección de zona
por tenant. Reutilizar helper staff existente con esa misma base/DEC-080, sin
nuevas dependencias, settings o endpoints y sin cambiar PRD.

## Criterios

- [x] Fechas/horas de lecturas de Caja en es-PY y zona v1, no zona del navegador
      ni recorte UTC; conservar fallback inválido y timestamp persistido.
- [x] Un comando pendiente o incierto bloquea comandos nuevos, filtro/cambio de
      sesión y ediciones que puedan reemplazar el intento. Guardia síncrona
      evita doble comando incluso entre paneles. No retries automáticos ni falso
      éxito.
- [x] Movimiento incierto conserva body/key en la superficie; reintento
      explícito usa exactamente ambos, solo confirma con respuesta válida y no
      compara importes/listas para deducir resultado. Un fallo al recuperar
      sigue bloqueado.
- [x] Cierre incierto conserva ID; lectura explícita autorizada (GET de sesiones
      existente) verifica ese ID. CLOSED muestra resultado; OPEN permite nueva
      revisión manual. Lectura fallida/ausente no habilita comando, sin POST por
      GET.
- [x] Creación/apertura sin ID confirmado no se reenvía ni resuelve por
      coincidencias. Enlaces salientes/beforeunload advierten; pendiente impide
      confirmar salida, incierto requiere descarte explícito que no cancela ni
      confirma backend.
- [x] Pruebas dirigidas de UI/contratos/recovery y regresión Cash/BFF/helper,
      lint/tipos/formato aprobados. Evidencia separa simulación y gates no
      ejecutadas.
- [x] Story/Cash/TD-073/continuidad/changelog/QA actualizados con límites.

## Límites

Sin nuevos contratos financieros, idempotencia de apertura/cierre, migraciones,
permisos, deps, stock/caja/ledger calculados en UI o contenido en
URL/logs/storage. Solo estado de componente y copia congelada en memoria. No
interceptar history ni restaurar automáticamente tras Back/Forward
SPA/recarga/cierre forzado; eso mantiene TD-073 parcialmente abierta y requiere
contrato propio para durabilidad. Salir no cancela operaciones. No recrear
claves inciertas o purgar recibos. Navegador/PG/build nuevos solo si los checks
dirigidos revelan necesidad concreta. Usar Node instalado con tzdata actual, sin
relajar fechas para Node22/tz2024b (TD-072). No procesos dev, datos operativos,
commit/push o CI remota asumida.

## Cierre — 2026-11-02

Fechas/horas es-PY en la zona fija v1, fallback inválido intacto. Coordinación
de comandos y guardia local de salida; intento de movimiento congelado en padre
con replay explícito de mismo body/key. Cierre incierto consulta GET autorizado
por ID conocido, sin POST automático. Creación/apertura sin ID siguen
bloqueadas. Recibos inválidos no disparan onSuccess. Seleccionar otra sesión sin
intento activo limpia recibos anteriores, no historial backend.

211 casos distintos en13 archivos aprobados: regresión202/202 y9 nuevos; nuevo
archivo inicialmente8/9 detectó desfase del aviso de recarga, corregido con
estado pendiente propio al iniciar comando. Recheck intentos/superficie20/20,
25,70s. Lint dirigido, tipos web, formato y diff-check aprobados. Node24
instalado con tzdata actual, sin cambiar PATH. Simulación de UI/BFF; no nueva
lane PostgreSQL, navegador, revisión visual o build. Sin cambios de backend,
contratos, endpoints, permisos, migraciones, deps, PRD, commit/push o CI remota.

TD-073 sigue abierta para durabilidad y navegación que elude el documento; no se
afirma que la copia sobreviva Back/Forward SPA/recarga/cierre forzado. TD-072 no
se resuelve por usar otro runtime en tests. Módulo, continuidad y changelog
sincronizados. Evidencia [[UX-034-VALIDATION-2026-11-02]].

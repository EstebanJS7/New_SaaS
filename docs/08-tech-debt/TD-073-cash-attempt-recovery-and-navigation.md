---
id: TD-073
type: tech-debt
title: Cash unresolved attempts across navigation and document loss
status: resolved
severity: medium
owner: engineering
related_stories: [CASH-004, UX-033]
created: 2026-11-02
updated: 2026-11-03
---

# TD-073 — Continuidad de intentos inciertos de Caja

Inspección estática en UX-033: la clave del movimiento vive en un ref del panel
por sesión. Cambiar sesión/remontar o perder documento descarta ese ref. Los
formularios de Caja no tienen recuperación durable de un resultado desconocido.
Las revisiones y mensajes nuevos no sustituyen esa garantía. No se reprodujo
respuesta perdida en PostgreSQL/navegador durante UX-033 ni se prueba aquí doble
movimiento; las guardas y transacciones backend conservan su alcance existente.

Etapa propia: definir bloqueo/advertencia de salida y cambio de sesión con un
comando pendiente/incierto, relectura autorizada por IDs confirmados y ciclo de
vida de la clave del movimiento. No reemplazar una clave incierta, inferir éxito
por valores o persistir contenido financiero en browser. Recuperación durable o
idempotencia nueva de apertura/cierre exige acordar contrato, sin deducirla del
protocolo de movimientos. Mantener ledger/auditoría e inmutabilidad.

## Mitigación verificada — UX-034 done, 2026-11-02

En el documento abierto, bloqueo de comandos/selección y guardia de enlaces/
beforeunload implementados. Body/key del movimiento sobreviven la revisión
fallida dentro del padre y replay explícito conserva ambos; no se recrean claves
para evitar un conflicto. Cierre tiene GET autorizado explícito por ID conocido,
sin inferir éxito por valores o reenviar. Registro/apertura sin ID no se
repiten. 211 casos simulados de UI/contratos aprobados, lint/tipos/formato; QA
UX-034. No nueva prueba PostgreSQL/navegador de respuesta perdida o auditoría
única.

Estado open se conserva: Back/Forward SPA, recarga, cierre forzado o cambio de
documento pierden copia y recibos locales. No se introdujo protocolo durable o
idempotencia nueva de apertura/cierre. Salida aceptada descarta copia, sin
cancelar backend; no equivale a resolución autoritativa. Ese límite requiere
contrato/decisión propios antes de ampliar garantía.

## Resuelta — UX-035, 2026-11-03

Contrato acordado en [[DEC-092]]: `Idempotency-Key` en la creación
(`POST /sales`, `POST /cash/sessions`), consulta por clave
(`GET …/attempts/:key`) y memoria de la pestaña con solo clave, tipo y hora. Una
recarga o Atrás/Adelante ya no pierde el intento: la página siguiente ofrece
consultarlo, y el reintento usa la misma clave. Límite restante: cerrar la
pestaña borra esa memoria (el registro sigue visible en los listados). Falta la
reproducción contra PostgreSQL y navegador ([[UX-035]]).

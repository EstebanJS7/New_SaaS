---
id: DEC-088
type: decision
title: Pilot deployment on a single VPS with Docker Compose and pgBackRest
status: proposed
date: 2026-11-02
related_epics: [EPIC-20]
related_stories: []
prd_change_required: false
---

# DEC-088 — Despliegue piloto en un VPS único con Docker Compose y pgBackRest

## Contexto

El repositorio no tenía forma de desplegarse: sin Dockerfiles, sin pipeline y
sin entorno. [[DEC-074]] separa lo que el código puede probar de lo que exige al
hosting (respaldos programados, fuera del servidor, PITR, retención). La primera
salida es un piloto con una clínica veterinaria chica, con presupuesto mínimo.

`AGENTS.md` pide una decisión antes de agregar un servicio desplegable. Esta
propuesta agrega dos: `backup` (respaldos programados) y `caddy` (proxy con
HTTPS). PostgreSQL, Redis y el almacenamiento de objetos ya estaban aprobados
([[DEC-077]]).

## Pregunta

¿Cómo se despliega el piloto y cómo se cumplen los requisitos de
`docs/09-operations/BACKUP-RECOVERY.md` sin una base de datos gestionada?

## Opciones

### Opción A — PaaS y base de datos gestionada

Respaldos y PITR del proveedor. Varias veces más caro (unos USD 50–100/mes o
más) y con más piezas para una sola clínica.

### Opción B — VPS único con Docker Compose y pgBackRest (recomendada)

Un servidor de 4 vCPU y 8 GB (unos USD 15–25/mes en total). Caddy para HTTPS.
PostgreSQL con archivo continuo del WAL y pgBackRest hacia un bucket S3 externo
y cifrado: completo semanal, diferencial diario, 4 completos retenidos.

### Opción C — VPS con `pg_dump` diario

Más simple, pero sin PITR: RPO de 24 h y sin recuperación a un momento dado.

## Recomendación

Opción B. Cumple los cuatro requisitos de BACKUP-RECOVERY.md (respaldos
automáticos, fuera del servidor y cifrados, PITR, RPO ≤ 24 h con
`archive_timeout=300`) a costo mínimo. Pasar a la opción A cuando haya varias
clínicas pagas.

## Impacto

### Producto

Ninguno sobre el alcance.

### Arquitectura

Sin cambios en la aplicación. Se agregan `infra/deploy/` (imágenes, compose,
Caddy, respaldos, scripts) y un workflow de despliegue. El servicio `backup` usa
la misma imagen de PostgreSQL; no es una tecnología de base de datos nueva.

### Base de datos/API

PostgreSQL corre con `archive_mode=on`. Sin cambios de esquema ni de API.

### Entrega

Un solo servidor es un único punto de falla: aceptable para el piloto solo con
la restauración ensayada. `infra/deploy/verify-local.ps1` ensaya respaldo y PITR
en cada corrida; falta medir el RTO con datos reales.

## Decisión

_Pendiente._

## Actualización del PRD

No requiere cambios en el PRD.

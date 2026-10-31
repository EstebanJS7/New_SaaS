---
id: UX-021
type: story
title: Isolated browser validation of specialized clinical records
epic: EPIC-06
status: done
priority: high
depends_on: [UX-015, UX-016, UX-017, UX-018, UX-019, UX-020]
prd_sections: ["9", "12.1", "13", "41"]
branch: main
created: 2026-10-30
updated: 2026-10-30
---

# UX-021 — Validación real de formularios clínicos en navegador

ID disponible comprobado. Continuación de la ronda visual/E2E acordada después
de UX-020; sin ampliar funcionalidades, historial o recuperación durable.
[[TD-066]], [[Clinical]], [[DEC-084-weight-measurement-unit]],
[[ADR-001 Modular Monolith]].

## Criterios

- [x] Lane clínica opt-in reproducible sobre API/web compilados aislados,
      PostgreSQL/Redis temporales propios y datos sintéticos mínimos; rechaza DB
      no desechable, no reutiliza servidores dev, no carga demo financiero, no
      llama proveedores externos ni aplica migraciones operativas.
- [x] Navegador real atraviesa login/cookie/BFF/API/PG para registrar/corregir
      tratamientos, estudios y pesos; precisión, unidades y fechas Paraguay.
- [x] Commit correcto con respuesta perdida y reintento explícito de la misma
      clave/comando, incluso tras Atrás/Adelante; fila y auditoría únicas. Peso
      confirmado con lectura fallida solo reintenta GET.
- [x] Conflicto real entre GET/PUT conserva copia y muestra estado actual sin
      otra escritura; recuperación, descarte y límites de sesión/permisos
      comprobados en navegador. Sin deducir éxito comparando valores.
- [x] Revisión acotada escritorio/móvil y teclado/foco/diálogo, capturas
      inspeccionadas, sin confundirlas con certificación WCAG/lector o todos los
      navegadores. Contenido fuera de URL/Storage/logs; artefactos solo
      sintéticos.
- [x] Corregir defectos encontrados dentro de este alcance, repetir checks
      aplicables de lint/tipos/tests/build y documentar evidencia real, fallos
      de harness y límites por separado. Sin dependencias/PRD/commit/push.
- [x] Actualizar Clinical, TD-066, guía UX/UI, changelog, QA y README de lane.
      TD-066 permanece abierta para historial/durable/consumidores legados.

## Clasificación y límites

Sin campos productivos nuevos. Datos clínicos y capturas por asociación
CONFIDENTIAL aunque sintéticos; salida temporal controlada, sin credenciales
reales o storage state persistido. Sin prueba de Portal, consultas cerradas,
vacunas/desparasitación, finanzas, stock ni vínculos clínicos.

## Implementación y cierre

Lane opt-in con PostgreSQL/Redis propios, fixtures mínimas sintéticas,
migraciones y builds API/web temporales. La matriz de 16 casos cruza
cookie/BFF/API/PG y comprueba filas/auditorías, fechas/Decimal/unidades, pérdida
de respuesta, CAS, recuperación/descarte y sesión/permisos. Se inspeccionaron
seis capturas de escritorio/móvil en la etapa inicial y se revalidó captura
móvil tras el ajuste.

TD-067: diagnóstico local compatible con transición suspendida de App Router
15.5.23; se movió el mismo loading.tsx desde app/(app)/ a app/(app)/app/, bajo
el layout staff asíncrono. Shell, skeleton y memoria del documento se conservan.
Sin cambiar CSP, prefetch, Next/React o contratos clínicos. El helper ahora
recorre login→Inicio→Pacientes→ficha con enlaces reales en escritorio/móvil y
verifica un marcador de documento. Sin bypass returnTo, reload o retry del test.
Instrumentación temporal de React retirada antes del runner final.

Dos ejecuciones consecutivas desde cero con el ajuste: 16/16 en 1,1 min (36szkT)
y 16/16 en 1,0 min (JCBU9a), salida 0 y contenedores retirados. Regresión
clínica: 76 casos; shell: 6 casos después de alinear expectativas antiguas en
inglés con labels españoles existentes, sin cambiar textos UI. Lint/tipos web y
e2e, builds aislados y verificador web aprobados. No se suman rondas como
pruebas distintas ni se reafirman como nuevos los checks backend/PG específicos
de UX-019/020, cuyo código no cambió.

TD-067 resuelta para el bloqueo reproducido en estos recorridos; no es prueba
estadística de ausencia universal ni certificación de todos los módulos,
navegadores, equipo móvil físico o lector de pantalla. TD-066 permanece open
para historial, durable y transición obligatoria de escritores legados. Traces
con cookies sintéticas RESTRICTED y capturas CONFIDENTIAL, solo Temp, sin
storageState persistido ni nueva política destructiva. Sin nueva migración, base
operativa, PRD, dependencia, commit o push en esta continuación. Los fallos
previos y sus límites se conservan en [[UX-021-VALIDATION-2026-10-30]].

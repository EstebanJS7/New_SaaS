---
id: UX-019
type: story
title: Idempotent specialized clinical record creation
epic: EPIC-06
status: done
priority: high
depends_on: [UX-015, UX-016, UX-017, UX-018]
prd_sections: ["9", "12.1", "13", "41"]
branch: main
created: 2026-10-30
updated: 2026-10-30
---

# UX-019 — Creaciones clínicas idempotentes

ID disponible comprobado en docs y Git. Alcance explícitamente autorizado por
producto; PRD intacto. Precedentes revisados: enmiendas Clinical, recibos de
ventas y claves de movimientos de caja. Solución específica Veterinary.

## Criterios

- [x] Campo opcional idempotencyKey en body JSON en los tres POST. Sin clave
      conserva contratos/cuerpos/respuestas legados; PUT fuera de alcance.
- [x] Ámbito organización/paciente/tipo/clave y contenido normalizado devuelve
      DTO original exacto, aun tras corrección posterior, sin nueva auditoría.
      Contenido diferente: 409 CONFLICT. Ámbitos independientes, clave validada,
      autorización actual antes de replay y aislamiento sin acceso por clave.
- [x] Creación, recibo y auditoría atómicos; PG desechable de carreras, commit
      con respuesta perdida, conflictos, aislamiento, autorización y rollback.
- [x] Frontend conserva clave/comando durante intento y recuperación UX-018;
      reintento manual seguro de creación, pendientes y PUT inciertos
      bloqueados. Sin inferencias de éxito por comparación de valores.
- [x] Peso conserva DTO legado y relee unidad staff. Tras creación confirmada,
      fallo de lectura solo reintenta GET, nunca crea otro registro.
- [x] Precisión, unidades, fechas, es-PY y seguridad intactas. Sin contenido en
      URL/logs/Storage; clasificación y semántica documentadas, sin purga nueva.
- [x] Lint, tipos, pruebas API/proxy/frontend/regresión UX-018, builds aislados
      y PostgreSQL real desechable. Evidencia separa simulación/PG de visual/E2E
      no ejecutado por alcance autorizado; no requiere nueva ronda de navegador.
- [x] Actualizar Clinical, TD-066, guía, changelog y QA. Sin commit/push,
      migraciones operativas, dependencias o modificaciones fuera del alcance.

## Clasificación

Claves UUID opacas aleatorias sin contenido, ámbito, digest y snapshot de
respuesta: CONFIDENTIAL por asociación clínica. Solo staff autorizado; sin
Portal, exports nuevos ni logs de recibos. Recibo durable sin expiración/purga
automática. Copia del formulario sigue limitada a diez minutos en memoria del
documento.

## Implementación y verificación

Implementado y verificado. Migración aditiva
20261030000002_clinical_creation_receipt, recibos inmutables con PK por ámbito y
FK tenant/paciente; advisory lock y ReadCommitted explícito. POST existentes con
idempotencyKey UUID opcional en JSON; snapshot original, 409 por contenido
diferente, auditoría única y rollback co-commit. API anterior estricta rechaza
la clave antes de escribir, por lo que no hay fallback de UI nueva a creación
sin garantía. DTOs legados conservados.

Frontend retiene clave/comando por intento lógico y recuperación UX-018;
reintento explícito con datos congelados, sin inferencias de éxito. Peso
confirmado conserva ID y solo reintenta GET unit-aware; respuesta POST perdida
repite el comando idempotente. Pendientes y PUT inciertos siguen bloqueados.

521 pruebas distintas aprobadas: 124 API simuladas, 345 web/proxy, 15 estáticas
de esquema y 37 PostgreSQL real (25 idempotencia + 12 regresión pesos). Lint
API/web completos, tipos API/web/database, Prisma validate/generate y builds
API/database/web aislados con verificador Next aprobados. Ver evidencia QA para
comandos, preparación corregida y límites; no se suman reejecuciones.

Clinical, TD-066, guía UX/UI, changelog y QA actualizados. Sin PRD,
dependencias, base operativa, navegador/E2E, commit o push. TD-066 permanece
abierta para PUT/CAS/historial, recuperación durable y visual/E2E; no son gates
de esta etapa acotada autorizada. Recibos CONFIDENTIAL sin purga, claves sin
contenido, copia solo en memoria del documento por diez minutos. Cambios previos
preservados.

Evidencia: [[UX-019-VALIDATION-2026-10-30]].

---
type: qa
status: passed
story: UX-026
date: 2026-10-31
updated: 2026-10-31
---

# UX-026 — Contratos clínicos obligatorios preproductivos

## Alcance y contexto

Base main/3292ffc, Git limpio al comenzar; sin reset, limpieza, commit o push.
AGENTS, ingeniería/documentación, UX-026, DEC-084/085/086/087, TD-066,
Clinical/guía, PRD §§12.1/13/27/28/41 y QA UX-024/025 revisados. TD-067 resuelta
para su matriz por dos rondas 26/26 anteriores; esa evidencia no se presenta
como ejecutada ahora. DEC-085 aceptada: PRD §§13.2/13.4 actualizado
explícitamente y UX-026 in-progress antes de código. Sin cambio de
arquitectura/ADR-001.

## Contrato e implementación

- POST tratamientos/estudios/pesos exige idempotencyKey UUID. PUT exige
  expectedVersion entero 1..2147483647 de la lectura original y correctionReason
  string no vacío/solo espacios hasta 2000. Objetos strict; errores estables
  VALIDATION_FAILED / HTTP 400 antes de escrituras. No generación de guardias en
  backend/BFF ni lectura para reemplazar baseline.
- Frontera de aplicación también exige clave y guardias en tipos/runtime.
  createOnce ya no admite ejecución sin recibo; correcciones especializadas
  siempre pasan tabla/version a updateRecord, validando motivo antes de abrir
  transacción de efectos. Vacunas/desparasitación no adquieren estas reglas.
- BFF comprueba guardias directas y submit anidado antes de fetch, conserva
  bytes, cookie staff, no-store y política de no abortar comandos inciertos. Los
  tipos de formularios ya eran protegidos; recuperación/markup no requieren
  cambios.
- Fixtures/comandos sintéticos adoptan claves creadas en el consumidor y
  baselines explícitos. Secuencias de corrección declaran 1/2/etc. sin helper
  que relea una versión para salvar el intento. Escritor remoto de carreras E2E
  incorpora motivo. Preparación Prisma/SQL de datos demo/sintéticos sigue
  directa: no se presenta como comando ni se inventa actor/recibo.
- Sin migraciones/endpoints/dependencias nuevas. Sin esquemas/bases dev,
  reinterpretación de unidad/motivos históricos, cambio de DTO de peso, purga,
  retención o borrado de recibos/revisiones.

## PostgreSQL real exclusivamente desechable

Nuevo runner node scripts/verify-clinical-guards.mjs: contenedor propio
postgres:16-alpine con tmpfs y puerto loopback aleatorio; no .env ni servidor
configurado. Ejecuta nueve verifiers existentes, cada uno crea una base con UUID
validado, aplica migraciones existentes, ejecuta su suite y elimina su base.
Finalmente se elimina el contenedor incluso ante fallo.

Artefactos Temp/newsaas-ux026-pg-OxWXNk, salida 0 en las nueve suites:

| Suite                           | Casos |
| ------------------------------- | ----: |
| clinical-creation               |    25 |
| clinical-correction / historial |    53 |
| clinical-drafts                 |    23 |
| treatment-entry                 |     8 |
| study-entry                     |     9 |
| weight-entry                    |    12 |
| treatment-search                |    10 |
| study-search                    |    10 |
| weight-search                   |    10 |
| Total distinto                  |   160 |

Creación sin clave deja de ser compatibilidad positiva: el caso ahora verifica
omisiones y claves inválidas con conteos estables de los tres registros,
auditoría y recibos. Preserva replay de respuesta perdida, DTO original tras
corrección posterior, seis solicitudes concurrentes iguales, contenido distinto,
aislamiento tenant/paciente/tipo, permisos/entitlement vigentes, recibos
inmutables y rollback si falla auditoría/recibo.

Correcciones conservan un ganador/409 con mismo baseline, bloqueo real de fila,
no-op condicionado, auditoría/revisión únicas, captura ausente o fallida y
rollback integral. Nueva matriz por tipo verifica cada guardia omitida/inválida
independientemente, con lectura/versión/historial/auditoría sin cambios.
Historia sintética SQL sin contexto conserva actor/motivo null tras nueva
corrección protegida; no equivale a permitir nuevos comandos públicos
desprotegidos. Pesos mantiene exactitud, KG/null y cantidades sin
conversión/redondeo. Borradores conserva CAS/privacidad/PENDING/retención lógica
y recuperación por recibo, incluido GET-only de peso.

## Simulación y contratos HTTP/frontend

API: 140 casos distintos de seis archivos. Primera selección 137: 133 passed / 4
failed; tres fallos en fake unitario con tenant no UUID y uno en cuerpo válido
de fixture de peso. Se adaptaron UUIDs, acknowledgements SQL simulados y cuerpos
para conservar intención de DTO/auditoría/entitlement. Recheck final de los dos
archivos modificados: 41/41 (28 HTTP + 13 records); otros cuatro ya aprobaron
99/99 (clinical 26, treatment/study 20 cada uno, weight 33). No sumar rondas.
Logs Temp/ux026-api-tests.log y ux026-api-final-tests.log. El fake no demuestra
locks, recibos persistentes o rollback real; PostgreSQL arriba sí.

Web: selección exploratoria amplia 580 casos/27 archivos: 559 passed, 21 failed.
Los 21 son etiquetas/mensajes ingleses o fecha ISO antiguos en
clinical-api.test.ts (dos) y clinical-records.test.tsx (19,
vacunas/desparasitación). Esos tests y sus módulos no cambiaron (git diff
--quiet salida 0), usan fetch simulado y no importan el BFF modificado. Se
registró TD-068, sin modificar producto/tests fuera del alcance ni presentar esa
corrida como verde.

Gate final especializado: 11 archivos de
contratos/formularios/listas/recuperación/ concurrencia/durable/historial y
todos los BFF clínicos, incluido required-guards. Resultado final: 467/467, 23
archivos, salida 0, 183,47 s; Temp/ux026-web-final-tests.log. Nueva matriz BFF
required-guards: 10/10 en selección inicial, salida 0, omisiones/valores
inválidos antes de upstream, límite válido de motivo/version y submit inválido
sin PENDING. Regresión preserva motivos/unidades históricos, valores es-PY,
GET-only y bloqueo de correcciones inciertas tras desmontar/recarga.

## Checks y builds aislados

Lint API/web/e2e y runner aprobado, tipos web/e2e aprobados; API final aprobado
tras anotar Promise<{id:string}> del callback de matriz (unión de tres DTOs).
Compilación inicial con --incremental false era incompatible con composite; se
usa tsBuildInfoFile en Temp sin alterar outputs. Vitest requirió ejecución fuera
del sandbox que bloqueaba esbuild y NODE_OPTIONS=--experimental-strip-types para
configuración compartida TS, sin instalar paquetes o cambiar configuración.

Runner de navegador compila reference/database, API y Next en Temp, sin .env o
outputs dev reemplazados, ejecuta verificador Next. Sin generar otro cliente
Prisma porque no cambia esquema. Builds aprobados; warnings existentes de Next
sobre project references/plugin ESLint, sin errores.

## Navegador y revisión visual

Lane completa node scripts/verify-clinical-browser.mjs en
Temp/newsaas-ux021-browser-buFFPu. PG/Redis tmpfs propios, datos mínimos
sintéticos, Chrome Windows headless, auth/cookie/BFF/API/DB reales y builds
aislados. Matriz 29 casos: los 26 previos (25 flujos y 50 contextos fríos) más
tres casos nuevos, uno por tipo, que rechazan omisiones/valores inválidos vía
API y BFF, con cero efectos verificados contra PG. No retries, refresh,
navegación alternativa o loading.tsx global. Resultado completo: 29/29, salida
0, 4,4 min, retries=0; el caso de 50 contextos nuevos terminó en 2,0 min.
Contenedores propios retirados. No sumar rondas antiguas de UX-025 como casos
nuevos.

Revisión visual acotada: treatment-history-mobile.png,
study-draft-reload-mobile.png y weight-desktop-review.png inspeccionadas en esa
lane. Antes/después, actor/motivo/fecha clínica y de corrección legibles; texto
multilínea y controles/botones caben a 390 px, copia recuperada explícita,
privacidad/retención visibles y 0,125 kg exacto en revisión desktop. Los
controles datetime-local conservan locale nativo Chrome en-US; textos de lectura
y semántica horaria Paraguay es-PY preservados. No certificación visual global.

## Clasificación y límites

Claves, baselines, motivos, snapshots y asociaciones CONFIDENTIAL. Sin contenido
clínico en URLs, logs de payloads o almacenamiento persistente del navegador.
Capturas sintéticas CONFIDENTIAL y traces/cookies RESTRICTED solo en Temp, no
Git. Sin nueva retención/destrucción. Sin datos operativos, migraciones dev,
commit, push, CI remota o despliegue. Chrome/viewport móvil no certifica
Safari/Firefox, hardware móvil, accesibilidad universal o estabilidad general
del framework.

## Cierre

767 casos distintos de gates automatizados especializados aprobados: 140 API
simulados + 467 web/BFF + 160 PG real. Además 29/29 E2E reales en una lane
completa, sin retries y con 50 contextos nuevos, y tres capturas inspeccionadas.
Lint API/web/e2e/runner y tipos API/web/e2e aprobados. Builds aislados de
reference/database, API y web + verificador Next aprobados. No presentar los 21
fallos exploratorios de TD-068 como verdes ni afirmar suite global aprobada.
UX-026 done y TD-066 resolved para este alcance; historial de fallos conservado.

Logs de checks: Temp/ux026-{api,web,e2e}-lint.log, ux026-runner-lint.log,
ux026-api-final-types.log, ux026-web-types.log, ux026-e2e-types.log,
ux026-web-final-tests.log, ux026-api-final-tests.log, ux026-pg-run.log y
ux026-browser.log. Formato y git diff --check aprobados; HEAD sigue 3292ffc sin
commit/push. Contenedores propios ausentes comprobados al cierre;
procesos/outputs dev conservados. Escaneo acotado de cinco marcadores sintéticos
en entradas JSON del log API de navegador: cero coincidencias, sin presentarlo
como auditoría integral de logs/traces.

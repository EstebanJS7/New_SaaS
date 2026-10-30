---
type: qa
status: passed
story: UX-018
date: 2026-10-30
updated: 2026-10-30
---

# UX-018 — Recuperación temporal de formularios clínicos

## Entorno y alcance

Windows/PowerShell, main. Solo frontend Veterinary: tratamientos, estudios y
pesos. Cambios acumulados conservados. Sin backend/contratos nuevos,
dependencias, PRD, migraciones, base operativa, semillas, cobros, commit o push.
La migración KG de UX-017 ya existía al comenzar y no se ejecutó ni modificó en
esta etapa.

Copia de campos y baseline CONFIDENTIAL, por paciente/tipo en QueryClient del
documento hasta diez minutos después de salir. No Storage, URL, history state,
logs ni deshidratación/persistencia de estas claves. Es trabajo temporal, no un
nuevo registro clínico ni autosave. Lógica acotada a Clinical, sin framework
Core compartido entre dominios.

## Pruebas simuladas — 233 casos distintos aprobados

Última ejecución de cada archivo, sin sumar repeticiones:

- clinical-record-recovery.test.tsx: 60 casos. Matriz de los tres tipos: salida
  y recuperación explícita conservando página, sin POST/PUT automático;
  corrección con instante original intacto, baseline remoto distinto, descarte
  confirmado, cancelación de descarte, lectura fresca 401/403/404 sin exponer
  cache anterior, 500 de lista con retry, comprobación de detalle con fallo
  temporal/reintento y 403/404, expiración sin extender plazo por remontar, otro
  paciente/QueryClient, claims de creación revocados, guardado pendiente sin
  reenvío y éxito tardío, respuesta incierta bloqueada, formulario
  limpio/descarte sin copia fantasma. Además: vencimiento por timer sin navegar,
  resultado vacío/multilínea exacto, checkbox KG y baseline desconocido
  preservados, respuestas tardías 200/403/500 que no eliminan un borrador nuevo,
  aislamiento entre tipos, ausencia de escrituras a Storage/history y deshacer
  todos los cambios de una corrección recuperada sin resucitar su copia.
- treatment-form.test.tsx: 15; study-form.test.tsx: 18;
  weight-form.test.tsx: 17. Regresión de validación, revisión/confirmación,
  campos parciales, KG, permiso, descarte/salida, doble envío y respuestas
  inciertas.
- treatment-list.test.tsx: 15; study-list.test.tsx: 16;
  weight-list.test.tsx: 28. Regresión de consulta, paginación/contexto, filtros
  y unidades.
- clinical-workspace.test.tsx: 47. Consulta/autosave/cierre y recuperación
  TD-065 existentes, sin cambiar sus contratos ni mecanismos.
- staff-session-boundary.test.tsx: 7. Interrupción por 401 y regreso seguro.
- patient-detail.test.tsx: 10. Regresión de ficha y responsables.

Vitest con binario instalado desde apps/web y
NODE_OPTIONS=--experimental-strip-types. La ejecución de diez archivos aprobó
232 casos cuando recuperación tenía 59; la última ejecución de ese archivo
aprobó sus 60, incluyendo deshacer todos los cambios. Son 233 distintos, no una
única corrida global. Navegación se simula desmontando/remontando componentes y
QueryClient; fetch, guardados y reloj son sintéticos. No prueban Back/Forward ni
sesión real en navegador o servidor desplegado.

## Lint, tipos y build

- Lint web completo: node node_modules/eslint/bin/eslint.js . desde apps/web.
- Tipos: node apps/web/node_modules/typescript/bin/tsc -p apps/web/tsconfig.json
  --noEmit --tsBuildInfoFile apps/web/.ux018.tsbuildinfo desde raíz.
- Build Next aislado con fuentes copiadas y node_modules enlazado bajo
  C:/Users/esteb/AppData/Local/Temp/newsaas-ux018-build-Zp37uX/web. next build y
  scripts/verify-build-output.mjs aprobados, con 29 páginas estáticas. No se
  tocó .next/dist del checkout ni se reiniciaron procesos dev.
- Persisten avisos informativos previos de Next sobre referencias TypeScript y
  plugin ESLint; no se desactivaron reglas para superar fallos.
- Formato y git diff --check revisados. Sin archivos generados/cache añadidos.

## Hallazgos corregidos antes del cierre

Las primeras pruebas nuevas usaban Ver peso en lugar del nombre accesible
existente Ver registro de peso: se corrigió el selector. Una expectativa de
resultado omitía el sufijo opcional y una prueba de aislamiento servía un DTO de
tratamiento a Estudios: se corrigieron las fixtures sin debilitar contratos. La
suite final no tiene excepciones sin manejar ni pruebas omitidas.

Lint detectó Object.entries con valores any implícitos al consultar copia y
esperas incorrectas de act en pruebas. Se reemplazó por campos etiquetados
explícitos y se sincronizó la resolución real de las promesas. El primer build
quedó bloqueado por esas mismas reglas; corregidas, lint/tipos/build final
aprobaron. Un intento inicial de lint desde raíz no encontraba la configuración;
se ejecutó el comando completo desde apps/web. No se cambiaron configuraciones
ni se ocultaron fallos.

## No ejecutado y límites

PostgreSQL/API real, E2E/Playwright, revisión visual/accesibilidad con
navegador, logout/reingreso real y operaciones clínicas/financieras reales no se
ejecutaron. No son gates de esta Story exclusivamente frontend. Sin migración ni
despliegue.

Recuperar requiere lectura fresca y acción explícita. Para nuevas entradas se
reconsulta lista autorizada; para correcciones, detalle y baseline completos.
Una lectura autoriza consultar, no concede create/update: backend sigue siendo
la autoridad al confirmar y claims conocidos restringen la oferta de recuperar.

Sin CAS/ETag o idempotencia de POST. Copias pendientes/inciertas no se reenvían;
descartar no cancela un comando ya enviado. Éxito tardío limpia solo su token;
tras vencer diez minutos no hay protección durable ni certeza de que no se haya
guardado. Copia no sobrevive recarga, cierre, logout/reingreso o nuevo
documento. TD-066 permanece abierto para esas fronteras y QA visual/E2E.

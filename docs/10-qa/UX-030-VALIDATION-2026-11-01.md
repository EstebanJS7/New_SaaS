# UX-030 — Validación del contexto y retorno de atención

Fecha: 2026-11-01. Story [[UX-030-care-journey-context-and-return]]. Base main,
HEAD 3292ffc; cambios anteriores conservados, sin commit/push.

## Alcance implementado

POS contrasta cita y paciente esperado, valida UUID y recurso devuelto antes de
mostrar identidad o sugerir servicio. Cita/vínculos con error ofrecen GET
explícito, sin reenvío automático. El retorno autorizado conserva la consulta
exacta, con o sin cita, y prefiere el origen persistido. Controles de asociación
y servicio se bloquean durante revalidación; sugerencia exige SERVICE activo del
catálogo actual. Navegar no ejecuta comandos. Sin endpoints, migraciones,
permisos, dependencias o contratos financieros nuevos; PRD existente suficiente.

## Simulación y verificaciones estáticas

Vitest web: **306/306, 18 archivos**, 134,99s. Selección completa de componentes
veterinarios y ventas, workspace, recuperación temporal, borradores de servidor
e historial clínico. Incluye errores, contexto incompatible, UUID con
mayúsculas, revalidación, permisos de lectura y retorno exacto/prioridad del
origen. No se cuentan ejecuciones parciales como casos adicionales.

Primera selección: 80/81; la nueva alerta de vínculos rompía una aserción global
del test de autosave. Se acotó a la ausencia del conflicto y conservación del
diagnóstico. Segunda selección: 304/305; esa aserción detectó que el fixture GET
no reflejaba el diagnóstico guardado por su PUT simulado. Se corrigió el
fixture, sin modificar el editor clínico ni su recuperación. Recheck workspace
47/47; selección final añade el caso UUID y pasa 306/306. Lint inicial pidió
optional chain en la comparación y se corrigió. Un intento de tipos con
incremental=false fue rechazado por composite (TS6379); se usa tsBuildInfoFile
temporal compatible. Esos intentos no se presentan como gates aprobados.

Lint web completo, E2E y runner aprobados; tipos E2E aprobados. Runner construye
referencia/database, API y Next en directorio aislado y verifica la salida web.
Binarios instalados, sin reinstalación ni interferencia con procesos dev. Logs
host Temp: ux030-final-regression.log, ux030-web-verified-lint.log,
ux030-e2e-types.log, ux030-e2e-lint.log, ux030-runner-lint.log,
ux030-web-final-types.log. Resultado final de tipos y formato registrado al
cierre. Una escritura preparatoria de tsconfig E2E falló con Errno22; se
inspeccionó el archivo intacto y se agregó únicamente journey-specs, conservando
sus includes.

## PostgreSQL real, API/BFF y navegador

`node scripts/verify-journey-browser.mjs`: **8/8, 49,0s, salida 0, retries 0**.
PostgreSQL16 y Redis7 propios desechables, tmpfs/puertos loopback aleatorios.
Migraciones solamente en esa base. Fixtures sintéticos directos preparan
paciente/responsable/profesional/servicio/cita y consulta CLOSED; no representan
comandos de alta o cierre clínico probados. Login y lecturas/comandos siguientes
sí atraviesan navegador, BFF y API reales. Sin datos operativos o .env demo.

1. Escritorio claro y móvil oscuro: Agenda (vista Lista normal), ficha, consulta
   cerrada, POS y retorno a la misma consulta/documento. Snapshot sin cambios
   por navegar. Cancelar vínculo no escribe; confirmar vínculo de cita sí.
   Precio del catálogo modificado sintéticamente antes de leer POS aparece al
   agregar explícitamente servicio; agenda no define importe ni cliente.
   Continuar al pago crea DRAFT mediante POST real. Cancelar y confirmar vínculo
   de venta tienen efectos respectivos; replay idéntico no duplica auditoría.
   Pagos/stock/caja no cambian, cita sigue IN_PROGRESS y consulta cerrada queda
   idéntica. No se confirma pago ni se prueba cierre clínico desde UI.
2. Consulta sin cita vuelve exactamente a su consulta, sin escrituras.
3. Cita de otro paciente del mismo tenant oculta identidad/servicio ajenos y no
   solicita su paciente; POS independiente continúa visible, sin efectos.
4. Cita cross-tenant devuelve 404 sin identidad o escrituras.
5. Lector puede leer pero intento explícito de asociación devuelve 403, sin
   efectos. Sesión separada del writer.
6. Primer GET de vínculos interceptado con 503 privado: mensaje sanitizado, sin
   retry automático; botón ejecuta segundo GET real 200, sin POST. El fallo
   inicial es simulación de transporte, no prueba de autorización backend.
7. Ítem que dejó de ser SERVICE no se agrega como servicio de la cita.

Artefactos host:
`C:/Users/esteb/AppData/Local/Temp/newsaas-ux030-browser-kBwJFo`. Log
`Temp/ux030-browser.log`. Cierre automático de servidores y contenedores; docker
ps -a con filtro ux030 vacío. No repetición de lane para ocultar fallos.

## Revisión visual y límites

Inspeccionadas screenshots/journey-pos-desktop-light.png (1440x1000) y
journey-pos-mobile-dark.png (390x844), Chrome Windows. Contexto, nombres largos,
acciones y retorno legibles, disposición móvil sin desborde horizontal. Login
por Enter, foco inicial del modal en Volver y Escape cancelando sin escritura
verificados. No certifica navegación íntegra solo con teclado, lector de
pantalla, contraste universal, calendario gestual, cuatro combinaciones de
tema/tamaño, dispositivo físico ni otros navegadores.

La Story verifica contexto/lecturas/navegación/asociaciones existentes, no todo
Agenda/POS o UI V1. TD-071 registra por inspección estática incertidumbre al
crear venta sin ID y salida con carrito; no se reprodujo ni resolvió aquí.
TD-069 sigue abierta: una lane con cierre automático no prueba reparación
universal del teardown Windows. Guardias UX-026, historial, recuperación y pesos
no fueron modificados. No despliegue ni CI remota asumida.

## Cierre y contraste adicional de Agenda

Tipos web finales con tsBuildInfoFile temporal: salida0. Formato de los once
archivos de código/configuración/verificador cambiados y git diff --check
aprobados. Primer intento de lint del test de calendario desde raíz carecía de
config ESLint; ejecutado desde apps/web, salida0. Prettier aplicado únicamente a
ese test, cuyo diff funcional son tres títulos. No se alteraron sus ocho casos.

Selección adicional de Agenda: 92/100 con Node22.14.0/tz2024b. Tres fallos son
títulos legados CONFIRMED/REQUEST frente a Confirmado/Solicitud; se actualizan
solo esas expectativas manteniendo payload exacto, servicio fuera del evento y
namespace de solicitudes. Cinco fallos restantes son tres horarios y dos
conflictos cuya edición queda inválida con otra interpretación del rango.

Contraste directo de Intl con zona explícita America/Asuncion e instante
2026-09-14T12:00:00Z: Node22.14.0/tz2024b devuelve08:00; Node24.22.1/tz2026e ya
instalado devuelve09:00. Se conservan todos los UTC esperados originales, sin
cambios de producto, TZ del proceso, instalación, actualización o cambio del
PATH. Ejecutado desde apps/web con
`C:/Users/esteb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`
y argumentos `node_modules/vitest/vitest.mjs run --config vitest.config.ts` y
`src/app/(app)/app/agenda`: **100/100,7 archivos,55,21s,salida0**. Logs
Temp/ux030-agenda-regression.log,ux030-agenda-current-runtime.log y
ux030-agenda-test-lint.log. TD-072 abierta registra el riesgo de runtime
habitual y la revisión pendiente de despliegue; no se certifica ese Node22 como
verde.

Total distinto de regresión: **406 casos en25 archivos**, más8 escenarios de
navegador; no se suman rechecks. Story done en su alcance, módulos Clinical,
Scheduling, Sales, continuidad y changelog sincronizados. TD-071/072 y TD-069
siguen abiertas; ninguna deuda se presenta como resuelta por esta lane.

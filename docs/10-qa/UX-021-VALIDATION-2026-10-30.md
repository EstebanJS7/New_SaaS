---
type: qa
status: passed
story: UX-021
date: 2026-10-30
updated: 2026-10-30
---

# UX-021 — Navegador real: evidencia y diagnóstico de navegación

## Resultado de cierre

UX-021 done. Runner final sin instrumentación: 16/16, 1,0 min, salida 0, en
newsaas-ux021-browser-JCBU9a; log Temp/ux021-td067-final-run.log. Segunda
ejecución consecutiva desde cero aprobada tras reubicar el límite de carga
(primera: 36szkT, 16/16, 1,1 min). Ambas crean DB/Redis/builds nuevos, recorren
Inicio→Pacientes→ficha, comprueban mismo documento y limpian contenedores. No se
suman como 32 casos distintos. TD-067 resuelta para el bloqueo verificado;
TD-066 continúa abierta para sus límites pendientes.

76 pruebas clínicas y 6 de shell aprobadas (82 distintas, sin sumar
repeticiones). ESLint completo web/e2e y tipos web/e2e aprobados; API/web
compilados aislados y verificador de salida web aprobados en runner final. node
--check del runner y diff/formato verificados. No se reejecuta el backend sin
cambios. Captura móvil de estudio final inspeccionada: recuperación legible y
sin desbordamiento; las seis capturas iniciales siguen como evidencia visual
acotada.

El cambio de ubicación de loading es una mitigación acotada validada, no prueba
exhaustiva de la causa interna ni certificación de todos los destinos/browser.
Sin cambios de dependencias/CSP/prefetch, PRD, persistencia clínica o base
operativa. Se conservan debajo los fallos que motivaron el diagnóstico.

## Resultado inicial — historial previo al diagnóstico TD-067

La última ejecución del runner desde cero terminó con salida 1: 6 passed, 1
failed y 9 did not run. Un clic de lista→ficha no cambió la URL. UX-021 queda
review; no se declara done ni se cierra TD-066. TD-067 registra navegación
intermitente sin causa confirmada. Una corrida focalizada anterior aprobó 16/16
en 40,2 s; se conserva como evidencia de recorridos, no de estabilidad.

No se oculta el fallo con retries: retries=0, maxFailures=1. No se cambian
criterios para declarar verde la ejecución fallida. Los intentos/repeticiones no
se suman como pruebas distintas.

## Entorno y aislamiento comprobados

Windows, main, Chrome local headless; Playwright instalado 1.64.1. API/web
compilados en carpeta temporal, viewport 1440x1000 y 390x844, timezone navegador
America/Los_Angeles frente a instantes Paraguay. No se manipulan pestañas del
usuario ni su perfil Chrome; contextos de prueba sin storageState guardado.

Runner entregable: node scripts/verify-clinical-browser.mjs desde raíz, o script
e2e:clinical de apps/e2e. Config clinical.playwright.config.ts y clinical-specs/
separadas de specs/ para no modificar la lane general. No carga .env, no
reutiliza servidores dev ni invoca global-setup/demo-seed existentes. Usa
imágenes PostgreSQL 16-alpine y Redis 7-alpine locales, tmpfs, puertos loopback
propios, nombre DB newsaas_clinical_browser_test_<uuid> validado y solo fixtures
sintéticas mínimas: tenant, dos roles/granularidad, credenciales argon2id,
patients y guardianes. Providers fake. Sin worker, proveedor fiscal/email
externo o carga de demo financiero.

Guards de configuración probados: sin variable de DB desechable rechaza antes de
arrancar; CLINICAL_E2E_DATABASE_URL válida pero DATABASE_URL distinta también
rechaza antes de conectar. No se probaron esos rechazos contra base operativa.
No hubo migración/lectura de registros sobre la base configurada/de desarrollo.
Todas las migraciones se aplicaron exclusivamente en contenedores propios.

## Evidencia positiva focalizada — 16 casos reales en una corrida

La corrida browser-run-1793391492415.log bajo
C:/Users/esteb/AppData/Local/Temp/newsaas-ux021-browser-RgsYoW aprobó 16/16.
Reutilizó builds y DB sintética propios del mismo trabajo, con nuevos pacientes
por caso y nuevos procesos HTTP. No reutilizó servicios de desarrollo. El login
usó returnTo existente hacia /app/patients, sin atravesar el dashboard/sidebar.

- Tres casos desktop registrar/corregir: cookie staff real, BFF→API→PG,
  revisión/confirmación, foco inicial y Tab dentro del diálogo, un registro y
  auditoría por operación, versión 2 tras corrección y Decimal exacto. Instante
  escrito 2026-10-20T12:00 de Paraguay llega como 15:00:00.000Z aun con
  navegador en Los Ángeles; peso 0,125 kg llega como string 0.125 y KG.
- Tres casos respuesta perdida: se espera response 201 real vía route.fetch,
  luego se aborta solo la entrega al browser. Tras Atrás/Adelante se recupera
  explícitamente la misma clave y comando, con una fila y una auditoría created.
  No se reemplaza la persistencia por mocks ni se infiere éxito por valores.
- Tres CAS: después de obtener la prelectura original, se ejecuta un segundo PUT
  real con expectedVersion 1; la UI envía su baseline obsoleto y recibe 409.
  Conserva inputs, bloquea reenviar y consulta el registro actual con GET. Solo
  la corrección ganadora audita.
- Tres móviles: salir/volver con history real, recuperación explícita sin
  guardado automático, valores exactos, Escape, confirmación de descarte y
  ausencia de filas; sin overflow horizontal a 390 px. Consultas montadas en la
  ficha se leen, pero no se crean ni cierran.
- Peso confirmado: fallo inyectado de GET de unidad después del POST; retry
  mantiene un único POST y una auditoría, repite únicamente GET.
- Sesión: quitar cookie oculta copia/expone reingreso; nuevo documento no
  restaura el borrador ni crea registro.
- Reader sin create: backend devuelve 403, conserva formulario y no escribe.
- Peso legacy: fixture con unit null; corregir solo fecha mantiene null y
  cantidad 12.345, sin atribuir KG; una auditoría update y versión 2.

En los flujos verificados no aparecen valores clínicos en URL ni en
localStorage/sessionStorage. Escaneo acotado de líneas JSON del servidor de la
última ejecución: cero coincidencias para los marcadores clínicos sintéticos
comprobados. No equivale a auditoría integral de logging/privacidad. Trazas de
prueba sí contienen fixtures y pueden incluir cookies de esta infraestructura.

## Revisión visual acotada

Inspeccionadas seis capturas bajo RgsYoW/screenshots/: treatment/study/weight
con sufijos desktop-review.png y mobile-recovered.png. Confirma legibilidad,
revisión literal multilínea, jerarquía, botones, labels, valor/unidad y espacio
a 1440 y 390 px. Los controles datetime-local nativos siguen el locale en-US de
Chrome y muestran M/D/YYYY/AM-PM; el texto de lectura/revisión y transporte usa
la semántica de Paraguay verificada. No se reinterpreta esa apariencia nativa
como conversión horaria.

No se afirma WCAG, lector de pantalla, móvil físico, Safari o Firefox. Todas las
identidades y textos son sintéticos. Capturas CONFIDENTIAL por asociación
clínica; traces de fallo con cookies sintéticas RESTRICTED, solo en Temp, nunca
agregados a Git ni compartidos como datos operativos.

## Ejecución inicial reproducible desde cero — gate fallido

Carpeta: C:/Users/esteb/AppData/Local/Temp/newsaas-ux021-browser-I3hHv8. Salida
capturada en Temp/ux021-final-run.log. Contenedores/DB/Redis nuevos, fixtures
mínimas nuevas, builds API/web nuevos y puertos nuevos. Migraciones, API build,
web build y verify-build-output.mjs aprobaron antes del browser.

Resultado: 6 passed / 1 failed / 9 sin ejecutar, 31,5 s de lane browser. Falló
study — actual GET→PUT conflict retains copy and reads current state ANTES de
crear/corregir: clic sobre nombre de paciente dejó la URL en /app/patients en
vez de abrir la ficha. No es evidencia de fallo de CAS ni de duplicación. El
runner propagó salida 1 y eliminó automáticamente ambos contenedores. Los
recursos de los intentos iniciales interrumpidos también se retiraron por nombre
exacto. No se tocaron contenedores o procesos del usuario/desarrollo.

Antes hubo clics generales desde Inicio/sidebar que permanecían en /app, con
peticiones RSC 200 en trace. También ocurrió con waits de carga completa. El
experimento de mantener menú abierto hasta pathname nuevo no eliminó el fallo y
se retiró íntegramente, incluidos sus tests; Git no conserva ese parche. No se
atribuye causa a Next.js/CSP sin prueba. TD-067 debe investigarse antes de
cerrar esta parte de navegación o afirmar que la lane es estable.

## Simulación y calidad

76 pruebas simuladas finales aprobadas: clinical-record-recovery.test.tsx (67) y
clinical-correction-concurrency.test.tsx (9). No se suman rondas anteriores o el
experimento de shell retirado. No se reejecutaron los 598 casos de UX-020 ni se
presentan como evidencia nueva de esta etapa.

ESLint completo web y e2e (incluye clinical-specs/), tipos web/e2e y node
--check del runner aprobados. Build API y web aislados/verificador web aprobados
en el runner final. No schema/dependencia/app funcional nuevo; los checks de
esquema/ PostgreSQL unitarios de UX-019/020 se conservan como evidencia
anterior, aquí PG se usa dentro de la lane real. Formato y diff verificados, PRD
intacto.

## Hallazgos del harness y límites

Primer selector usaba textbox en vez de searchbox; se pasó a label Buscar
pacientes y espera de la respuesta de búsqueda antes de seleccionar la fila.
Fixtures y formatos se alinearon al código inspeccionado. Fecha visible de
revisión usa mes abreviado, no dd/mm literal. El menú móvil se selecciona dentro
del diálogo real. No se agregaron pausas fijas o retries del test. Los intentos
de esperar estado de dashboard/load/networkidle no resolvieron la navegación; no
se conservan como supuesto arreglo del producto.

Con la entrada returnTo se obtuvo una corrida clínica completa aprobada, pero la
repetición limpia siguió fallando al seleccionar ficha. Este resultado permanece
visible. No se introducen cambios de PRD, servicios, dependencias, Portal,
consultas cerradas, vacunas/desparasitación, pagos, caja, ventas, stock o
vínculos. No commit/push. UX-021 y QA quedan review; TD-066/TD-067 open.

## Continuación TD-067 — diagnóstico y corrección acotada

Se reabrió UX-021 in-progress antes del cambio. Se inspeccionaron código y
traces existentes: respuesta RSC completa, chunks 200, sin error de consola
registrado. Diagnóstico nuevo sin modificación funcional (GBDc8p): 7 passed, 1
failed y 8 no ejecutados, 37,1 s, salida 1. Falló entrada lista→ficha móvil,
antes de crear/corregir. Snapshot temporal del FiberRoot: pendingLanes=14336,
suspendedLanes=14336, warmLanes=14336, pingedLanes=0. Solo nombres/status de
nodos, sin props, contenido clínico o cookies; la instrumentación se retiró.

Patrón compatible con el
[reporte upstream #98305](https://github.com/vercel/next.js/issues/98305), no
demostración de identidad de causa. Next instalado 15.5.23; su layout-router usa
lazyData y ACTION_SERVER_PATCH en startTransition, seguido de
unresolvedThenable. No se parchea node_modules, actualizan dependencias, relaja
CSP, desactiva prefetch o fuerza recarga. Una recarga perdería la memoria de
recuperación UX-018 y por ello no se usa como reparación.

Cambio: mover el mismo loading.tsx de app/(app)/ a app/(app)/app/, por debajo
del layout staff asíncrono. Conserva skeleton, tokens y shell; no modifica
páginas, permisos, handlers clínicos ni esquemas. El helper de los 16 casos
ahora recorre login→Inicio→Pacientes→ficha con enlaces reales (menú nativo a 390
px), y un marcador en DOM comprueba que no hay nueva navegación de documento.
Sin espera fija, retries o retorno directo que eluda el enlace.

Primera ejecución nueva con este ajuste: 16/16, salida 0, 1,1 min, en
newsaas-ux021-browser-36szkT. Se reutiliza la misma matriz, no se suma como 16
pruebas nuevas respecto de otras rondas. Runner final sin instrumentación
aprobado: JCBU9a, 16/16 en 1,0 min y salida 0.

Regresión: 76 casos clínicos aprobados. Al ampliar a shell se encontraron cuatro
expectativas antiguas de texto inglés frente a UI española ya existente; se
actualizaron únicamente selectores/expectativas, manteniendo comprobaciones de
skip link, menú/Escape/selección y fin del feedback al cambiar ruta. Los seis
casos de shell pasan después del ajuste. Total 82 casos distintos; una primera
invocación sin --experimental-strip-types no cargó la configuración compartida,
y se corrigió la invocación usando binarios instalados. No es una falla clínica.

Control final: sin contenedores newsaas-ux021 restantes. Inspeccionada también
la captura final de confirmación de peso desktop (0,125 kg y fecha Paraguay).
Escaneo acotado del log final para cuatro marcadores clínicos sintéticos: cero
coincidencias; no se interpreta como auditoría integral de privacidad.

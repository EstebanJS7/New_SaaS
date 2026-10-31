---
type: qa
status: passed
story: UX-025
date: 2026-10-31
updated: 2026-10-31
---

# UX-025 — Navegación staff y cierre de UX-024

## Alcance

TD-067 reapareció en UX-024: dos lanes completas fallaron antes de entrar a
clínica. Usuario autorizó investigar/corregir navegación y después adoptar
contratos obligatorios preproductivos (DEC-085 / UX-026, aún planned durante
este diagnóstico). UX-025 libre e in-progress antes de código, Epic-03/PRD
10.1/13.3/29/41, ingeniería/documentación y contexto TD-067/UX-024 revisados. No
cambio de PRD, dependencias, Next/React, servicios, CSP, auth o lógica de otros
dominios para esta corrección. Git main/cambios acumulados preservados.

## Reproducción

Instalados Next 15.5.23 / React 19.2.8, producción Next compilada aislada.
Primer contraste 8rXf55: 50 documentos nuevos reutilizando contexto/sesión, 1/1
en 1,6 min. No reprodujo; se consideró insuficiente porque la lane clínica
arranca contextos distintos por caso.

Segundo contraste A6IiYE, mismo producto sin parche: 50 contextos nuevos con
login real. Falló al décimo: completedEntries=9, URL siguió /app/patients por 10
s tras click del Link a ficha. Adjunto sintético navigation-scheduler:
pendingLanes=suspendedLanes=warmLanes=229376; pingedLanes=0. En trace hay RSC
200 text/x-component, incluidos responses de 2174 bytes para esa ficha. No fallo
de selector, permisos o escritura clínica: el destino no llegó a montarse.
Contextos se cierran y contenedores propios se eliminaron.

## Corrección y límites causales

Se retiró app/(app)/app/loading.tsx, barrera Next global que envolvía todas las
páginas staff. Reubicarla en UX-021 había reducido la reproducción, sin
eliminarla. Las páginas cliente ya tienen carga/error propios y el shell
conserva RouteFeedback. No reload, router.refresh de recuperación, retries,
prefetch alterado, sleeps de estabilización, CSP relajada o parche vendor.
Layout staff/auth/branding y QueryClient/DocumentNonceProvider sin cambios.

Runtime instalado layout-router conserva fetch perezoso y suspensión permanente
con dispatch ACTION_SERVER_PATCH en transición. Patrón observado compatible con
[Next #98305](https://github.com/vercel/next.js/issues/98305), fuente primaria
revisada durante la investigación. La compatibilidad es inferencia, no prueba de
identidad de causa ni promesa para todas las versiones/entornos. La comparación
antes/después acota la mitigación a esta app/lane.

## Pruebas simuladas y checks

Selección web de shell, layouts raíz/staff, nonce/sesión, lista/detalle
pacientes: 73 casos. Primera ronda: 62/73; once fallos por expectativas inglesas
antiguas en nav-sidebar/appearance-toggle/topbar. Se verificó texto actual del
producto y se actualizaron solo expectativas a etiquetas españolas, sin alterar
componentes o gates. Reejecución: 72/73; un mensaje de logout requería su cadena
exacta. Recheck nav-sidebar 10/10, sin sumar repeticiones: 73 casos distintos
verdes. Warnings conocidos del harness JSDOM al renderizar html en div y navegar
anchors, sin presentar estos tests como navegación real o errores de producción.

Logs Temp/ux025-web-{tests,final-tests}, ux025-nav-sidebar-recheck. Lint y tipos
web/e2e y builds aislados se registran junto con resultados finales abajo.
Ningún test de presencia de archivo sustituye el flujo real de navegación.

## Navegador / PostgreSQL real desechable

Runner clínico: PostgreSQL/Redis tmpfs nuevos, API y Next compilados aislados,
fixture mínima/sintética, Chrome local headless, cookies/BFF/guards reales.
Ningún .env o servicio/base dev reutilizado. Cada lane completa ejecuta 25 casos
clínicos y un caso que contiene 50 contextos con login→Inicio→Pacientes→ficha.
La marca DOM exige mismo documento en ambos enlaces; primer contexto retiene la
lectura HTTP del paciente hasta observar Cargando paciente, luego permite la
respuesta real. Esto verifica carga cliente tras retirar fallback global.

Primera ronda corregida rXaXqy: 26/26, 7,0 min, salida 0, retries=0; incluye los
25 casos clínicos y 50 contextos fríos en 3,9 min. Artefactos sintéticos en
Temp/newsaas-ux021-browser-rXaXqy, contenedores retirados.

Segunda ronda independiente PX3EwT: 26/26, 5,9 min, salida 0; los 50 contextos
en 2,0 min, retries=0/maxFailures=1. Contenedores propios retirados. No sumar
ambas rondas como 52 casos distintos: revalidan la misma matriz con 100
contextos de navegación en total. Logs Temp/ux025-full-first.log y
ux025-full-second.log.

## Cierre y límites

Lint/tipos web y e2e aprobados, builds aislados API/database-reference/web y
verificador Next aprobados en las dos lanes; sin outputs de dev reemplazados. 73
casos web distintos aprobados entre la reejecución y recheck del archivo
corregido, sin sumar rondas. Checks Temp/ux025-{web,e2e}-{lint,types}. No nueva
migración o suite PG separada: esta Story cambia navegación, la matriz E2E usa
PostgreSQL real y comprueba filas/auditoría/receipts/versión/aislamiento.

Revisión visual acotada en rXaXqy/screenshots: weight-draft-reload-mobile.png y
study-history-mobile.png inspeccionadas. Copia recuperada/0,125 kg/unidad,
antes/después, motivo, es-PY en texto, wrapping y controles legibles a 390 px.
No cambios CSS/componentes de producto; inputs de fecha conservan locale nativo
del navegador, como se documentó en UX-024. No se presentan como seis capturas
revisadas de nuevo o certificación global de accesibilidad.

Gates aprobados: UX-025 done, UX-024 puede cerrar su pendiente y TD-067 resolved
para la reproducción observada. Conservar todos los fallos previos; no afirmar
estabilidad universal por dos rondas o equivalencia con otros
navegadores/lectores/equipo móvil. No CI remota, despliegue, datos operativos,
migraciones dev, commit/push. Capturas CONFIDENTIAL y traces/credenciales
sintéticas RESTRICTED, solo Temp.

Comprobación final: lint de los tres tests con etiquetas actualizadas y tipos
web finales salida 0, formato/diff --check aprobados, contenedores ux021 propios
ausentes en docker ps -a. Cinco marcadores clínicos sintéticos buscados solo en
entradas JSON API de las dos lanes finales: cero coincidencias; no auditoría
integral de traces/logging. Ningún proceso dev detenido o output dev sustituido.

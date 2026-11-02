---
type: qa
status: passed
story: UX-028
date: 2026-11-01
updated: 2026-11-01
---

# UX-028 — Validación de identidad de Pacientes

## Alcance

Alta/edición, lecturas y acciones de identidad/responsables, mensajes seguros,
protección de salida y bloqueo ante resultado incierto. Sin cambios backend,
BFF, esquema, permisos o contratos. PRD sin cambios en esta etapa; sus cambios
locales UX-026 preexistentes se preservan. Base main 3292ffc con trabajo local
previo UX-026/TD-068/UX-027, sin commit/push.

## Pruebas simuladas y verificaciones

- Primera selección existente: 33/33, cinco archivos; conservada como evidencia
  inicial, no sumada de nuevo a la selección ampliada.
- Nuevos casos/formulario/API cliente/detalle: 39/39 en tres archivos. Incluye
  longitud y foco, responsable obligatorio en alta activa, edición por
  diferencias, null de raza/fecha, reactivación, fecha sin conversión de zona,
  envío simultáneo, resultado incierto bloqueado, catálogo fallido/vacío y
  descarte/beforeunload.
- Regresión ampliada: 217/217 en doce archivos, 143,45 s. Formulario 11, API
  cliente 15, detalle 13, resumen 6, listado 12, proxy 9, selector agenda 4,
  recuperación temporal clínica 67, borradores privados 21, tratamientos 15,
  estudios 16 y pesos 28. Simulación de componentes/HTTP, no PostgreSQL real.
- Lint web completo final aprobado, salida 0. Dos avisos de tipos en tests
  nuevos en primera ronda se corrigieron con discriminación explícita de tipos.
- Tipos web/E2E iniciales aprobados; checks finales y navegador en curso.

Los comandos usan Node y binarios locales instalados con NODE_OPTIONS de
strip-types según los paquetes compartidos. Primera invocación Vitest sin ese
flag falló al cargar configuración, antes de ejecutar tests. Una invocación de
Prettier y otra de tsc apuntaron por error a binarios inexistentes (sin efecto);
se corrigieron las rutas. No reinstalación ni modificación para ocultar fallos.

## Navegador y PostgreSQL real

Runner scripts/verify-patient-browser.mjs y config patient.playwright.config.ts:
PostgreSQL16/Redis7 propios tmpfs, puertos loopback aleatorios y nombre de base
estrictamente newsaas_patient_browser_test_<uuid>. Nunca carga .env ni demo
seed; referencia/sintéticos solamente. Migra solo esa base, compila referencia,
API y Next fuera de outputs dev y verifica el build. Chrome Windows, worker
único, retries=0 y maxFailures=1. SQL/Prisma directo solo prepara fixtures
sintéticos o comprueba efectos; las operaciones bajo prueba pasan por UI/BFF/API
reales.

Docker estaba detenido; inicio hidden de Desktop autorizado. La invocación
IiKXbe falló mientras el motor arrancaba, antes de crear contenedores/base.
Luego status running y motor 28.5.1 verificados. No reparación, reset o limpieza
Docker. Lane 4FDoYN en curso; resultados pendientes.

## Privacidad y límites

Identidad/vínculos CONFIDENTIAL. Sin nuevos campos, texto en URLs/logs ni
persistencia del navegador. Capturas sintéticas CONFIDENTIAL, cookies/traces de
prueba RESTRICTED, solo temporales. No purga/retención nueva ni datos
operativos. Guardia de salida acotada a cancelación, enlaces explícitos y
beforeunload; Back/Forward no interceptado, sin recuperación durable de
identidad. No añade idempotencia/CAS al CRUD de identidad. No resuelve TD-011 ni
certifica todo Patient360, accesibilidad universal, otros navegadores o
dispositivo físico. Clínica UX-018–026 conserva sus contratos; su regresión
simulada se distingue de una nueva lane clínica integral de navegador. Sin CI
remota/despliegue.

## Progreso posterior

Regresión adicional 86/86 en cuatro archivos: detalle 13 repetidos y 73
distintos (ficha clínica 47, historial 19, límite de sesión 7). Nuevo caso de
lectura de clientes denegada eleva detalle a 14/14 (recheck aprobado). Total
acumulado **291 pruebas distintas**, sin sumar rechecks. Ajuste visual de ayuda
de fecha es-PY y lang del formulario: formulario 11/11 recheck aprobado. Lint
web completo final aprobado; tipos web finales y E2E aprobados. Runner lint
aprobado.

4FDoYN: builds referencia/API/Next/verificador aprobados. Primer caso real falla
al buscar en Prisma el nombre sintético con espacio final, después de POST201:
el formulario recorta el nombre según su contrato existente. Fixture corregido
para crear un nombre largo sin espacio al final, manteniendo comprobación del
valor persistido. 1 failed, 4 no ejecutados, sin retries; salida1. Playwright
reportó además un error fuera de test sin detalle adicional; salida preservada.
Contenedores propios retirados. No se atribuye este fallo al backend.

Revisión de patient-form-desktop-light.png de 4FDoYN: etiquetas/ayudas/acciones
caben, pero la fecha nativa muestra el formato inglés del navegador. Se agrega
lectura explícita de fecha seleccionada es-PY debajo del control (sin cambiar el
día o wire), y lang=es-PY al formulario. Los nombres de taxonomía se conservan
como datos de catálogo, sin traducción por inferencia o cambio de seed. Raíz
HTML/shared y localización de catálogos no se declaran completados por UX-028.
Lane kQBrTf comenzó a copiar antes de esta última ayuda; se distingue del
producto final y se mantiene para comprobar el resto de escenarios.

kQBrTf: lane completa 6/6, 33,8 s, salida0, retries=0. Builds referencia/API/web
más verificador aprobados. Prueba escritorio claro y móvil oscuro con login
real, alta activa y principal atómico, fecha exacta, editar/clear null, vínculo
y cambio principal, cancelación de desvincular y luego desvinculación lógica con
auditoría única, contexto de listado y mismo documento. Respuesta201 perdida
luego de commit: formulario bloqueado, un POST/una fila sin inferir éxito en
producto. Lector403, escritor cross-tenant404, anónimo401, alta inválida400 y
reactivación sin principal409 sin efectos comprobados. Reactivación explícita200
con principal. Lector sin customers.read conserva lectura del paciente, búsqueda
no revela responsable y detalle no habilita vincular ni expone nombre del
cliente.

Capturas móviles de kQBrTf inspeccionadas: nombre largo legible, acciones caben,
responsables adaptados; selector fecha nativo con icono oscuro poco visible.
Ajuste final del control con color-scheme dark y checkboxes accent-primary,
además de ayuda es-PY. Último E2E lint detectó any del JSON en la nueva prueba
de lectura limitada; se cambió a unknown con aserción de estructura, manteniendo
la intención. Lane final posterior a cambios visuales en curso.

Última revisión del formulario encontró que un control date nativo puede ser
badInput con value vacío cuando queda incompleto; la validación no debe depender
de un valor truthy y omitirlo silenciosamente. Se corrige el guard y se agrega
caso DOM dirigido (no se afirma reproducción nativa con navegador): formulario
12/12 aprobado. Total 292 casos distintos. La lane tt5nkn ya había copiado la
versión anterior; se conserva separada. Nueva lane del código final en curso.
Lint E2E y runner finales aprobados, sin any del JSON. Colores de calendario y
checkboxes usan color-scheme/token existente, sin literales de marca.

## Cierre del producto final

NJvR8X: seis casos ok, sin retries. Builds referencia/database, API, Next y
verificador aprobados. Playwright quedó en cierre de API/Next propios después
del último caso; servidores identificados por PID/command line y ruta temporal
exacta, detenidos exclusivamente para completar el cierre. Resumen **6/6,
salida0,4,7m totales incluyendo espera**. Finally retiró sus contenedores, y
docker ps -a con filtro ux028 vacío confirmó ausencia de contenedores propios.
Este cierre fue asistido; no se presenta como terminación automática aprobada.
[[TD-069]] conserva el incidente y el trabajo de diagnóstico pendiente. No se
ocultó un fallo ni se reenvió un comando; los seis casos habían terminado ok
antes de intervenir. Una primera consulta CIM con ErrorAction Stop produjo Call
cancelled y no detuvo nada; con aviso no terminante se verificó cada ruta antes
de Stop-Process. Procesos dev anteriores no fueron modificados.

Artefactos C:/Users/esteb/AppData/Local/Temp/newsaas-ux028-browser-NJvR8X; log
Temp/ux028-browser-verified.log. tt5nkn anterior6/6,47,3s,salida0 con cierre
automático; no incluye el último guard de fecha incompleta. kQBrTf6/6,33,8s
anterior a los ajustes visuales. No se suman ejecuciones repetidas como más
cobertura.

Revisadas capturas finales patient-form-mobile-dark.png,
patient-detail-mobile-dark.png y patient-detail-desktop-light.png. Nombre largo
legible, botones/labels/ayudas sin desborde horizontal, responsables adaptados,
fecha seleccionada inequívoca en es-PY y calendario visible en oscuro. Matriz
acotada1440x1000 claro y390x844 oscuro, Chrome Windows; no todas las
combinaciones ni certificación de lector de pantalla/contraste/hardware. Las
lecturas clínicas del usuario de identidad están denegadas por permisos
intencionalmente; estas capturas no acreditan una nueva lane clínica integral.

**292 pruebas distintas en15 archivos**, más rechecks después de cambios. Lint
web completo aprobado y dirigido final tras ajustes de fecha, tipos web finales
aprobados (ux028-verified-types), tipos/lint E2E y lint runner aprobados.
Prettier de archivos cambiados y git diff --check aprobados. Se escanearon514
líneas JSON API de la lane final para seis marcadores de identidad sintética: 0
coincidencias; escaneo acotado, no auditoría de todos los logs/traces.

Story/módulo/continuidad/changelog actualizados. PRD sin cambios nuevos en esta
Story, sin migraciones de desarrollo, instalación, datos operativos,
commit/push, CI remota o despliegue. HEAD3292ffc. UX-028 done; TD-069 abierto y
pendientes transversales de localización no cerrados por inferencia.

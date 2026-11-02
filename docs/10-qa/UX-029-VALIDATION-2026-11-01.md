---
type: qa
status: passed
story: UX-029
date: 2026-11-01
updated: 2026-11-01
---

# UX-029 — Validación de Catálogo staff

## Alcance y base

Formularios alta/edición, detalle, errores seguros y bloqueo del intento de
comando; listado UX-011 conserva búsqueda privada/contexto y confirmación. Base
main3292ffc con cambios locales UX-026/TD-068/UX-027/UX-028/TD-069 preservados.
Sin commit/push ni cambios PRD nuevos. Se leyeron gobierno, PRD
§§1/9/10.1/15/29/41, módulo, UX-011, decisiones010/065/080 y ADR002.

El inventario UX-027 describía normalización existente de precio, pero la
inspección actual encontró el formulario con patrón decimal de punto y
Number(threshold)>0. Esta etapa aplica DEC-080 al precio/umbral mediante los
helpers existentes y pruebas de ida/vuelta; no asume el inventario como código.
Backend/DTO/moneda/precisión/null y tracksStock se conservan. Sin API, esquema,
migración, dependencia, cálculo fiscal, ledger o nueva operación de negocio.

## Pruebas y checks en curso

Primera selección8 archivos125 casos:124 aprobados y1 fallo del matcher de
precio PYG en detalle. DOM contenía el importe correcto con espacio no separable
pero getByText normaliza ese espacio. Se cambia a comparación exacta del
textContent del span, sin cambiar importe o producto. Resto incluye formulario,
cliente, listado/búsqueda, proxies y formatter. Recheck y regresiones en curso.
Lint primera ronda rechazó dos == null: cambiados a comprobaciones estrictas
null/undefined. Tipos web y E2E iniciales aprobados; lint final en curso.

Tests originales conservan escenarios de tasa requerida, orden humano, monedas,
precio/par opcional, cero/escala/umbral positivo, edición parcial y clear con
null. Entradas adaptadas a coma decimal; esperado wire con punto y strings
intactos. Mensajes viejos ingleses adaptados a copia española segura, sin exigir
texto privado de servidor. Nuevos casos cubren máximos12/7 dígitos, escala2/3,
grupos de miles, importe cero y mínimo umbral, sin reescribir valores intactos,
longitud/foco, envío simultáneo, denegación/incertidumbre y descarte.

## Lane real

scripts/verify-catalog-browser.mjs prepara contenedores propios PostgreSQL16 y
Redis7 tmpfs, puertos loopback aleatorios y base estrictamente
newsaas_catalog_browser_test_<uuid>. No .env ni demo seed; solo referencias y
sintéticos. Migra solo esa base. Builds database/referencia/API/Next temporales
con binarios instalados, verificador Next y Chrome Windows, un worker,
retries0/maxFailures1, sin reusar servidores. Docker28.5.1 disponible.
SQL/Prisma directo es preparación/comprobación sintética, no sustituto de
comandos de aplicación bajo prueba. Runner revisado contra permisos catalog.*
singulares antes de ejecutarlo. No entitlement Veterinary para este Core.

Previsto: escritorio1440x1000 claro, móvil390x844 oscuro; crear, retorno actual
a editar, guardar sin cambios con body vacío, precio/umbral máximos exactos,
clear/null, precio cero/umbral mínimo, contexto mismo documento, confirmación
cancelada y desactivación con auditoría única, sin movimientos/balances stock.
Respuesta perdida luego de commit tanto POST como PUT conserva/bloquea sin
reenvío. Lector403, escritor cross-tenant404, inválidos400 y anónimo401 sin
efectos, con API/BFF reales. Resultados y capturas pendientes.

## Límites

Configuración INTERNAL y texto libre de búsqueda conservadoramente CONFIDENTIAL.
Sin contenido en URLs/logs/storage persistente de navegador. Capturas sintéticas
y trazas/cookies solo Temp (autenticación RESTRICTED). No datos operativos,
retención/purga nueva, despliegue o CI remota. Guardia local para enlaces,
cancelación y beforeunload; sin recuperación durable ni interceptar
Back/Forward. No nueva idempotencia/CAS (TD-014 continúa), claims frontend o
edición de tracksStock. No certificación global de accesibilidad o dispositivo
físico. TD-069 mantiene separado el cierre de servidores Windows de los casos
reales.

## Hallazgos intermedios

Recheck ampliado14 archivos161 casos:120 passed/41 failed,249,16s. Detalle
Catálogo9/9 corregido pasó. Fallan seis archivos ventas/agenda por expectativas
legadas de idioma/formato y confirmación anterior; producto/pruebas de esos
dominios tenían diff vacío al iniciar y se contrastaron textos españoles con
HEAD3292ffc. [[TD-070]] registra corrección solo de tests: conservar escenarios,
wire y validaciones, recorrer diálogo de revisión real y no exigir error privado
al consumidor de Catálogo. No se cambia producto financiero o agenda.

3odkMD: build referencia/API/Next/verificador pasó. Primer caso real falla17,1s
al guardar sin cambios: PUT{} válido respondió404 aunque GET del mismo item
respondió200. Prisma updateMany vacío produce count0 sin SQL; repositorio lo
confundía con recurso inexistente. Se conserva el caso y se corrige repositorio
con lectura tenant-safe dentro de la misma transacción para cambios vacíos, sin
reescribir ni tocar updatedAt. Servicio conserva auditoría vacía. Pruebas
unitarias añadidas para transacción real recibida y404 foreign/unknown sin
write; lane real añadirá comprobación de updatedAt y auditoría única de no-op.
No nuevo contrato, endpoint, permiso o migración.

Cierre Windows volvió a quedar pendiente después del fallo, registrado en
TD-069. Se verificaron PID/command line exactos de API/Next en3odkMD y se
cerraron solo esos servidores propios, sin repetir test para ocultar fallo.
Resultado final de esa lane conservado; nueva ronda justificada por fix real.

## Reanudación y corrección de consumidores

API/repo después del fix:37/37 (23 HTTP con dobles y14 repositorio), salida0,
30,35s. Primera invocación en sandbox:14 casos repo pasaron y23 HTTP fallaron
por sockets EACCES; no fallo de dominio. Reejecución con sockets locales
permitidos conservó casos y aprobó37/37. Lint de ambos archivos API aprobado.

Primer ajuste de expectativas consumidoras:52 passed/3 failed y un error de
transformación, salida1. Se corrigió selector Cantidad con asterisco de campo
obligatorio, fixture/cantidad editable y un identificador de helper que una
sustitución de texto había alterado accidentalmente. Ningún caso se retiró.
Reanudación dirigida20/20 (CounterSurface13 y LineEditor7), pero salida1 por
sale-states no transformado; no se declara verde esa invocación. Corregido el
identificador addAndCheckout, selección completa en curso. Las acciones de
completar recorren Revisar venta y el diálogo real Confirmar venta que ya
existía; el payload wire original continúa comprobado. Fixtures locales usan
coma, no convierten dinero ni modifican código financiero. Los negativos de
controles fuera de alcance también cubren sus términos españoles.

89sMYP quedó sin resultado durante buildAPI: no llegó a Next/navegador ni
registró salida final. Al reanudar no existían las sesiones de proceso ni motor
Docker activo. Se inició Desktop hidden; una vez motor28.5.1 disponible, filtro
de contenedores propios vacío. No se asume éxito de esa invocación, no se
reinició dev ni se limpió configuración Docker. Nueva lane final en curso.

## Gates finales automatizados

Web277/277 en21 archivos,110,09s, salida0 (ux029-web-final-tests.log). Incluye
todos los casos de Catálogo/formato/proxies y la regresión ampliada completa
ventas/agenda; sin quitar escenarios. API/repo37/37 en2 archivos, salida0. Total
**314 pruebas distintas** en23 archivos; rondas iniciales/rechecks no se suman.
TD-070 resuelta, sin cambios de producto en ventas/agenda.

Lint web completo final aprobado (ux029-web-final-lint.log), lint API dirigido
aprobado, tipos E2E finales aprobados (ux029-final-e2e-types.log). Lint runner y
E2E previo aprobados; la nueva aserción de no-op se comprobará al cierre.
Build/lane real duNb7k en curso sobre el producto corregido.

## Cierre final — PostgreSQL, navegador y visual

Lane duNb7k del código corregido: **6/6,38,6s,salida0,retries0**, con cierre
automático de servidores y retirada de contenedores propios. Filtro docker ps -a
ux029 vacío comprobado. Builds referencia/database, API y Next y verificador de
salida pasaron. Artefactos:
C:/Users/esteb/AppData/Local/Temp/newsaas-ux029-browser-duNb7k; log
Temp/ux029-browser-resumed-final.log. La primera3odkMD quedó1 failed/5 no
ejecutados y salida1 con cierre asistido;89sMYP quedó interrumpida, sin
resultado. No se contabilizan como verdes ni se ocultan con retries o navegación
alternativa.

Casos reales:

1. Escritorio/claro y móvil/oscuro con login y navegación reales. AltaSERVICE
   conserva tracksStock=false, USD máximo999999999999.99 y umbral9999999.999.
   Edición intacta envía PUT{}:200, mismo updatedAt y una auditoría de update
   con changedFields vacíos. Detalle conserva todos los dígitos en es-PY.
   Limpiar precio/moneda/umbral guarda null; cambiar kind aSUPPLY no altera el
   flag existente. Precio cero0.00 y mínimo umbral0.001 se conservan. Volver al
   listado mantiene búsqueda y documento, sin texto en URL. Descartar/cancelar
   modal no escribe; desactivar después crea una sola auditoría y conserva fila.
   StockMovement/StockBalance del tenant permanecen en cero.
2. POST201 confirmado por backend y respuesta abortada: una fila/unPOST,
   formulario conservado y bloqueado. PUT200 con respuesta abortada: unPUT,
   precio persistido123456.78 y copia local intacta123.456,78, sin reenvío o
   inferir éxito en producto comparando valores.
3. Lector con catalog.read puede leer pero crear/actualizar/desactivar403 sin
   efectos; writer cross-tenant y unknown404 sin exponer identidad ni auditoría.
   Moneda sin par, escala inválida, umbral cero y tasa inexistente400 sin fila o
   auditoría; anónimo401 sin escritura. Guardas/BFF/API reales, sin entitlement
   Veterinary para este Core. Empty-update foreign/unknown y tx correcto tienen
   prueba de repositorio específica; no se presenta esa simulación como PG real.

Revisadas capturas finales catalog-form-mobile-dark.png,
catalog-detail-mobile-dark.png y catalog-detail-desktop-light.png. Labels,
ayudas, botones y nombres largos legibles sin desborde; máximo precio/umbral
completo, acción editar y filas adaptables. Formulario escritorio de3odkMD ya
inspeccionado con el mismo frontend. Matriz1440x1000 claro/390x844 oscuro en
Chrome Windows; no cuatro combinaciones, lector de pantalla, contraste
universal, otros navegadores o dispositivo físico. No se declara UI V1 global
completa.

Tipos finales web/API/E2E, lint web completo/API dirigido/E2E/runner, formato de
archivos cambiados y git diff --check aprobados. Logs
Temp/ux029-web-verified-types,
ux029-api-verified-types,ux029-final-e2e-types,ux029-e2e-verified-lint y
ux029-web-final-lint. Escaneo acotado de460 líneas JSON API para siete
marcadores sintéticos:0 coincidencias. No auditoría integral de todos los
logs/traces.

Story, módulo, continuidad, changelog y TD-070 sincronizados. No endpoints,
migraciones, permisos o dependencias nuevos; no cambios PRD de esta Story, datos
operativos, procesos dev, commit/push, despliegue o CI remota. HEAD3292ffc.
UX-029 done; TD-014/TD-069 y matriz amplia TD-007 permanecen pendientes.

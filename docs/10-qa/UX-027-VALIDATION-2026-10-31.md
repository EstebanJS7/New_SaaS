---
type: qa
status: passed
story: UX-027
date: 2026-10-31
updated: 2026-10-31
---

# UX-027 — Experiencia de Clientes y feedback staff

## Base y alcance

Rama main, HEAD 3292ffc, cambios locales UX-026/TD-068 e inventario preservados.
Story ready pasó a in-progress antes del código. Se revisaron AGENTS, reglas de
ingeniería/documentación, inventario UX-027, UX-010, Customers, DEC-080, ADR-002
y PRD §§9/10.1/11/29/41. No cambio de PRD, backend, esquema, endpoints,
autorización, dependencia o arquitectura. Pacientes/Catálogo no se implementan
en esta etapa; se prueban como consumidores de feedback compartido.

## Implementación

- Clientes: alta/edición/detalle, formularios de dirección/contacto y avisos en
  español. Etiquetas visibles asociadas, required/límites explicados, validación
  de las longitudes actuales con primer campo inválido enfocado, sin truncar.
  Los errores se retiran al editar el campo; el siguiente submit revalida.
- Conserva Persona/Empresa, kind inmutable al editar y cuerpos/semántica
  original de omisión/vacío/null. No regex de correo/teléfono/RUC o
  normalización nueva. La lane comprueba contacto sin formato deliberadamente
  para TD-059.
- CustomerRequestError conserva código/status, errores sanitizados y estado
  incierto. No mensajes de servidor con datos personales/excepciones. Mutaciones
  sin retry, guardia síncrona contra doble submit y confirmación mínima de ID en
  la respuesta antes de descartar. Respuesta perdida/5xx/408 o acuse ilegible
  conserva valores y bloquea reenvío; no se vuelve idempotente Customers.
- Backend sigue siendo autoridad: no hay catálogo de permisos efectivos en estas
  páginas que habilite deducir escritura desde lectura. Denegaciones
  deshabilitan el comando afectado; error de lectura padre oculta
  subformularios. Sesión usa la frontera UX-007 existente mediante status 401.
- Salida: cancelación y enlaces explícitos con copia sucia abren confirmación;
  antes de descargar documento se usa beforeunload. Navegación interna
  confirmada usa router sin recarga para conservar contexto de listado UX-010.
  No parche de historial, Storage o protección prometida para Back/Forward y
  navegación programática externa. Salir no cancela un comando ya enviado.
- Reutiliza Button/Input/Card/ConfirmActionDialog y tokens. Feedback genérico y
  error de ruta staff traducidos, sin loading.tsx global. Cabecera/filas se
  apilan en móvil para no comprimir identidades largas contra los botones.

## Pruebas simuladas

Selección inicial Clientes: 29/29, cuatro archivos, salida 0. No se suma como
cohorte adicional. Ampliación final inicial: 93/93, diez archivos, salida 0 en
50,49 s; incluye 8 escenarios nuevos de detalle, 6 de formulario, 10 transporte,
2 feedback y regresión de listados Clientes/Pacientes/Catálogo/Ventas/historial.

Regresión adicional de treatment-list/study-list/weight-list y frontera de
sesión: 66/66, cuatro archivos, salida 0 en 30,06 s. Total distinto hasta esa
revisión: 159; no representa backend o persistencia real. Logs
Temp/ux027-tests.log y ux027-shared-regression.log. Recheck tras corrección
visual/errores: 39/39 de los seis archivos Clientes/feedback, salida 0 en 56,02
s; Temp/ux027-final-customer-tests.log. No sumar otra vez.

Casos nuevos conservan intención: payload por tipo, omisiones de edición, valor
sobredimensionado sin truncar, foco, copia al cancelar, guardia pending, acuse
perdido o malformado, 401/403/404/400/409/500/408, contacto sin patrón nuevo,
dirección con país exactamente dos caracteres, error de padre sin exponer hijos,
desactivación cancelada e incierta y enlaces de edición con copia sucia.

## Lint, tipos y build

Lint web inicial detectó async sin await en una prueba nueva, corregido sin
alterar producción. Lint web final inicial, tipos web y E2E, lint E2E/runner
aprobados; lint/tipos web posteriores a ajustes visuales aprobados en
Temp/ux027-verified-{lint,types}.log. Tipos E2E final aprobado. Primera
comprobación de tipos detectó unión de tres DTOs en mutationFn de desactivación;
se anotó el mínimo común Promise<{id:string}> sin any ni cambiar DTOs.

Intento de build independiente mientras Docker no estaba disponible:
Temp/newsaas-ux027-build-vSlTbh. La copia ad hoc omitía vitest.setup/config;
compiló fuentes, pero lint tipado de tests ajenos no resolvía los matchers.
Salida 1; no se considera build aprobado ni se relajan tests/configuración del
repo. La lane completa usa copia con ambos archivos, tal como el runner clínico.

## Navegador y base real desechable

Runner propio scripts/verify-customer-browser.mjs y config customer.playwright.
PG16/Redis7 tmpfs, puertos loopback propios, credenciales sintéticas, referencia
mínima; no .env, seed demo, base configurada o servicio dev. Customers se prueba
sin entitlement veterinary porque es Core. Compila referencia/database, API y
Next en Temp y ejecuta verificador Next. No generar cliente Prisma nuevo porque
no cambia esquema. Chrome Windows, un worker, retries=0/maxFailures=1.

Primer arranque YS2HWV no pudo contactar al motor Docker detenido. Al iniciarlo,
Docker Desktop falló en dockerInference; se comunicó y el usuario lo levantó. No
reset a fábrica ni limpieza de datos/configuración de Docker.

Lane 5zIekh: builds/verificador aprobados; desktop claro y móvil oscuro pasan.
Prueba de creación con respuesta perdida falla por selector ambiguo getByRole
alert: coincide con mensaje correcto y anunciador de ruta Next. Resultado: 2
passed, 1 failed, 1 no ejecutado; salida 1, sin retries. Se acota selector al
contenido staff, conservando la respuesta abortada tras commit y el conteo PG.

Revisión de tres capturas de esa lane encontró compresión excesiva del nombre
largo en móvil y error local visible tras corregir un valor. Se corrige layout y
limpieza de error, se añade aserción de ancho del nombre en móvil. La captura
fallida se conserva; ausencia de scroll horizontal no acreditaba legibilidad. La
lane Os8qP9 ya había copiado el producto anterior al ajuste visual. 1 passed, 1
failed, 3 no ejecutados, salida 1: el nuevo control de ancho móvil rechazó 45,97
px (exigía más de 200). Playwright también reportó un error fuera de test sin
diagnóstico adicional en salida; se conserva el log. Contenedores retirados. No
se atribuye esta ronda a la corrección posterior.

Lane gOPrkc del producto final: 5/5, salida 0, 27,8 s, retries=0. Builds
reference/database, API y web/verificador aprobados. Contenedores propios
retirados. Revisión final de capturas abajo. La matriz final incluye
desktop/claro, móvil/oscuro, creación/edición, direcciones/ contactos, descarte,
modal/foco, desactivación con auditoría única, contexto conservado sin cambiar
documento, creación incierta tras commit, lector denegado, aislamiento de
escritor cross-tenant y anónimo 401 con cero efectos.

## Límites y clasificación

Datos personales/contactos CONFIDENTIAL. Sin nuevos campos, payloads en URL/logs
o almacenamiento persistente del navegador. Capturas sintéticas CONFIDENTIAL;
traces/cookies de prueba RESTRICTED solo Temp. Sin retención/purga nueva,
migraciones dev, datos operativos, commit/push o despliegue/CI remota.

No nueva certificación global de accesibilidad, navegadores alternativos o
hardware móvil. Back/Forward no interceptado; no recuperación durable de estos
formularios. SQL/Prisma directo solo prepara fixtures o comprueba evidencia,
nunca reemplaza los comandos de aplicación probados. TD-059 sigue abierto y
TD-007 conserva su parte Branding.

## Cierre final

159 casos distintos aprobados entre las selecciones descritas; recheck final
Clientes/feedback 39/39 aprobado sin sumar rondas. Lint web completo final,
tipos web y E2E, lint E2E/runner aprobados. Logs
Temp/ux027-verified-{lint,types}, ux027-final-e2e-{lint,types},
ux027-runner-lint y ux027-final-customer-tests.log. Navegador real gOPrkc 5/5;
log Temp/ux027-browser-final-product.log. Sin nueva suite API/PG independiente
porque no cambia backend; la lane usa PostgreSQL real para comprobar comandos
existentes, conteos, auditoría y ausencia de efectos.

Se inspeccionaron customer-mobile-dark.png, company-form-mobile-dark.png y
customer-desktop-light.png de gOPrkc/screenshots: identidad larga legible con
botones debajo en móvil, sin la columna comprimida anterior; labels/ayudas y
controles caben, errores corregidos ya no se muestran, y detalle conserva
contactos/direcciones y feedback. Antes de capturar se vuelve al inicio del
scroll para evitar que el header sticky quede fotografiado en mitad de un
fullPage. Matriz acotada escritorio/claro 1440×1000 y móvil/oscuro 390×844; no
se afirma inspección de las cuatro combinaciones ni de alto contraste, lector de
pantalla, Firefox/Safari o dispositivo físico.

El caso de respuesta perdida aborta la respuesta después de POST real 201: app
conserva valor y bloquea, DB contiene una creación; no se deduce éxito en
producto por comparar valores. Casos denegados verifican lector 403, escritor
cross-tenant 404, anónimo 401 y estado/auditoría sin cambios. Contacto sin
patrón nuevo se guarda y desactiva una sola vez con una auditoría. Retorno al
listado mantiene texto aplicado y marca del mismo documento; no navegación
alternativa para hacer pasar la prueba.

Formato, git diff --check y ausencia de contenedores ux027 propios comprobados
al cierre. Escaneo acotado de cinco marcadores sintéticos solo en entradas JSON
API de la lane final: cero coincidencias; no auditoría integral de logs/traces.
HEAD permanece 3292ffc, sin commit/push. UX-027 done; fallos intermedios arriba
conservados. UX-001/002/005, TD-059 y parte Branding de TD-007 no se cierran por
inferencia desde esta entrega.

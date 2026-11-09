# UX-031 — Carrito POS y creación incierta

Fecha: 2026-11-01. Story [[UX-031-pos-cart-and-uncertain-creation]], done. HEAD
main3292ffc. Trabajo local anterior preservado; sin commit/push.

## Cambio acotado

CounterSurface conserva la copia y bloquea creación incierta por transporte, 5xx
o recibo sin UUID/DRAFT. Guardia síncrona contra doble envío; rechazo
400/404/409/422 permite corrección, 401/403 bloquea comandos. No reenvío
automático, búsqueda de coincidencias, clave nueva o recuperación sin ID.
Mensaje de creación seguro sin texto privado del servidor. Copia existente de
permiso preservada. Pago/finalización y contratos financieros no cambian.

Hook específico de POS protege enlaces salientes y beforeunload cuando hay
carrito/cliente sin completar, comando pendiente o resultado incierto. Cancelar
mantiene copia; confirmar descarta solo memoria, nunca cancela una venta. En
pendiente no se habilita confirmar salida por enlace. No patch de
history/router, browser storage, logs de contenido o datos en URLs. Back/Forward
SPA y cierre forzado no se bloquean; sin recuperación tras recarga. No certifica
todo POS.

## Verificación en curso

Tipos web iniciales y E2E aprobados. Primera selección ventas127/136,95,52s,
tuvo errores causados por recodificación accidental de tres archivos al agregar
mocks de router: se restauraron sus textos UTF-8 y se inspeccionó el diff. No se
cambió producto para aceptar texto corrompido. Lint detectó callback vacío de
promesa pendiente en test nuevo; corregido. Regresión ampliada conserva un fallo
de copia de permiso; se restauró el mensaje específico de producto que las
pruebas esperaban. No se presentan esos intentos como verdes ni se eliminan
escenarios.

Mocks useRouter añadidos a counter-surface, sale-states y completion-recovery;
no cambian la intención de sus escenarios previos. Lane UX-030 existente solo
agrega confirmación de salida al retornar desde un borrador ya creado. Archivo
pos-cart.spec.ts amplía el mismo harness aislado, sin runner/dependencia nueva.
Types/lint y browser/build finales pendientes de registro.

Logs host Temp: ux031-sales-tests.log, ux031-regression-final.log,
ux031-types.log, ux031-web-lint.log, ux031-web-final-lint.log,
ux031-e2e-types.log, ux031-e2e-lint.log, ux031-browser.log. Infra del harness
conserva prefijo ux030 para identificar recursos propios.

## Regresión dirigida

Selección ampliada: 181/182 en15 archivos,155,11s; único fallo era la copia de
permiso sustituida, no un cambio de autorización. Se restauró el mensaje
específico previo. Recheck counter-surface final: **21/21,22,32s**, incluyendo
dos casos adicionales de401 y beforeunload limpio/cliente solo. Total distinto
de esta selección: **184 casos en15 archivos** (sustituir19 por21, no sumar
rechecks). Regresiones de completar incierto, pagos exactos, estados, selector,
editor, carrito, API cliente, asociaciones y BFF mantienen sus casos.

Pruebas nuevas: transporte/503/recibo inválido conservan precio123456,78,
cantidad2,125 y cliente, bloquean comandos y no exponen PRIVATE;400 permite
corrección;401 bloquea; pendiente evita doble envío y confirmación de salida;
cancelar salida conserva copia; beforeunload distingue limpio/cliente elegido y
cliente limpiado. Son respuestas simuladas en componentes, no PostgreSQL.

Lint web completo y E2E aprobados. Build aislado compilado; resto de gates de
build, navegador y visual siguen en curso. Logs adicionales:
Temp/ux031-counter-final.log,ux031-web-final-types.log,
ux031-counter-final-lint.log. No se cierra Story por pruebas unitarias solas.

## Primera lane real y corrección de selección

Artefactos Temp/newsaas-ux030-browser-aQpaPL: builds
referencia/database/API/Next y verificador aprobados, tipos/lint finales
aprobados. Lane8/8,1,0m,salida0, cierre automático. Esta ejecución solo cubrió
regresión UX-030: testMatch aún seleccionaba journey.spec.ts y omitía
pos-cart.spec.ts. No prueba los nuevos escenarios de incertidumbre/salida. Se
corrigió exclusivamente testMatch para incluir ambos archivos y se ejecuta lane
completa13 casos,retries0. Repetición justificada por omisión concreta, no para
ocultar un fallo del producto. Log adicional Temp/ux031-browser-full.log.
Capturas nuevas aún pendientes.

Lane completa QPl2wL:8 passed,1 failed,4 no ejecutados,1,9m,salida1; teardown y
retirada automáticos. Nuevo caso falló en preparación antes de POST: selector
getByLabel exacto de Cantidad incluía asterisco en el texto de label, aunque
aria-hidden lo excluye del nombre accesible del textbox. Se verifica markup y se
cambia a getByRole textbox con nombre Cantidad exacto; ninguna lógica de
producto, precisión, timeout, retry o permiso cambia. Se repetirá solo el
archivo nuevo para resolver el fallo concreto;8 escenarios anteriores ya pasaron
con el producto final. No declarar13/13 en una sola ejecución hasta tener
evidencia.

La lane QPl2wL informó además un error fuera de test al detener por maxFailures;
no se contabiliza como verde ni se atribuye a una operación financiera. Log,
trace y captura fallida conservados. Selector corregido comprobado por markup
del campo text con label y asterisco aria-hidden; captura confirma el carrito y
cliente presentes antes de enviar. Lint explícito de config (sin ignore), lint
final del selector y formato aprobados. Primera llamada lint config fue ignorada
por el patrón habitual; no se cuenta como análisis de ese archivo.

## Cierre final — PostgreSQL real, navegador y visual

Selección nueva SputjW: **5/5,1,0m,salida0,retries0**, cierre automático de
servidores y retirada de contenedores propios. Docker ps -a filtro ux030 vacío
comprobado. Builds referencia/database/API/Next y verificador aprobados.
Artefactos `C:/Users/esteb/AppData/Local/Temp/newsaas-ux030-browser-SputjW`, log
Temp/ux031-browser-pos-final.log. Selección mediante --grep de los cinco casos
nuevos, no reejecución de los ocho previos. Son13 escenarios distintos cubiertos
con el producto final en8+5, no una ejecución completa13/13 aprobada.

1. Escritorio/claro y móvil/oscuro: POST /sales real vía BFF/API devuelve201 al
   interceptor de prueba, que observa el ID sin entregárselo a producto y aborta
   la respuesta. UI conserva y bloquea cliente, cantidad2,125/precio123456,78;
   no ofrece pago u otra venta. Un soloPOST, DRAFT con cliente exacto y línea
   quantity2.125/unitPrice123456.78, una auditoría sale.created. Cuentas de
   pagos, stock y caja intactas. Cancelar salida mediante Escape conserva
   bloqueo; confirmar salida llega al historial sin borrar venta o ejecutar otro
   comando. Fallo de transporte inyectado, persistencia y guardas backend
   reales.
2. Comando retenido antes de enviar: no efectos durante pendiente, confirmar
   salida deshabilitado. Al liberar transporte llega201 real, un borrador y una
   auditoría; diálogo pasa a confirmación normal y cancelar conserva la vista.
   No se afirma que el servidor estuviera ejecutando una transacción retenida.
3. Carrito/cliente locales: cancelar salida conserva valores; confirmar salida
   no crea ni cancela filas, pagos, stock, caja o auditorías de creación.
4. Lector autenticado: POST real403, checkout bloqueado, sin efectos.

Inspeccionadas screenshots/pos-uncertain-desktop-light.png y
pos-uncertain-mobile-dark.png: modal y acciones legibles en1440x1000 y390x844,
Chrome Windows; sin desborde horizontal. Foco inicial en Permanecer en POS y
Escape comprobados en navegador. Campos exactos visibles tras pérdida de
respuesta. Beforeunload cubierto por componente (no nueva prueba de diálogo
nativo del navegador). No auditoría universal de contraste/teclado/lector de
pantalla, dispositivo físico, otros navegadores o cuatro combinaciones visuales.

Tipos web/E2E, lint web completo y dirigido final/E2E/config explícita/selector,
formato y diff-check aprobados. Escaneo acotado de194 líneas JSON API para dos
marcadores de nombres sintéticos nuevos:0 coincidencias, sin auditoría integral
de logs/traces. HEAD3292ffc conservado. Story done en su alcance; módulo,
continuidad, changelog y TD-071 sincronizados. TD-071 sigue abierta para
recarga/Back/Forward SPA/recuperación durable sin ID; TD-069/072 no se cierran
por esta evidencia. Sin comandos financieros nuevos, cambios PRD, datos
operativos, migraciones dev, commit/push, despliegue o CI remota.

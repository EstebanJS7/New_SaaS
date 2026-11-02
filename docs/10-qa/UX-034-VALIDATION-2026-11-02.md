# UX-034 — Intentos de Caja y fechas v1

2026-11-02. Story [[UX-034-cash-attempt-guards-and-dates]]. Main3292ffc; trabajo
anterior preservado, sin commit/push. No PRD, endpoints, schema, permisos o deps nuevos.

## Implementación

CashSurface coordina comandos con guardia síncrona y estado pendiente propio.
Pendiente/incierto bloquea edición, comandos, filtros y cambio de sesión. Recibos
con ID/estado inválidos se consideran no confirmados antes de onSuccess. No retry
automático ni comparación de importes para determinar éxito.

Movimiento incierto conserva copia congelada del body y su key en el padre.
Reintentar explícitamente usa ambos intactos; rechazo de recuperación incluso403
mantiene bloqueo/copia. Solo respuesta válida confirma; entonces se limpia el
intento y remonta el panel para retirar copia/key ya resueltas. Nueva selección
sin intento activo limpia recibos/errores anteriores, sin cambiar comandos.

Cierre conserva ID conocido. GET de sesiones autorizado, sin filtro, busca ese
ID: CLOSED muestra resultado y OPEN permite revisión manual conservando conteo.
Fallo, ausencia o recibo inválido mantienen bloqueo. GET no envía POST. Apertura
y creación sin ID no ofrecen replay ni buscan coincidencias por nombre/importe.

Guardia local de enlaces y beforeunload: pendiente impide confirmar salida;
incierto permite descarte explícito con aviso de que salir no cancela ni confirma
backend. Sin patch de history/router, almacenamiento persistente o auto-recuperación.

La zona v1 ya está fijada en packages/shared/src/platform.ts a America/Asuncion.
El helper staff existente usa esa misma base; Caja lo reutiliza, presenta fecha
y hora es-PY e identifica la zona. No se añade setting por tenant o lectura de
Portal/reportes para obtenerla. Timestamp persistido y fallback inválido intactos.

## Evidencia dirigida

**211 casos distintos en13 archivos aprobados**. Regresión Caja/BFF/helper:
202/202 en12 archivos,81,16s. Nuevo cash-attempts:9 escenarios, inicialmente8/9;
el fallo detectó que el aviso beforeunload dependía del estado pendiente diferido
de la librería. Se añadió commandPending al iniciar execute, conservando gate
síncrono. Recheck intentos+superficie:20/20 en2 archivos,25,70s. No se suman
ejecuciones repetidas. Producto corregido verificado en los consumidores afectados.

Escenarios simulados:

- Movimiento: respuesta perdida,403 al replay y éxito posterior. Tres POST
  explícitos con body/header idénticos; no cambio de sesión/edición/comando
  ajeno, cero inferencia por lecturas. Recibo resuelto no se muestra al cambiar
  después a otra sesión.
- Cierre: GET actual devuelve OPEN o CLOSED; un POST inicial, ningún POST por
  consultar estado. Conserva1.000,00 si OPEN; CLOSED muestra resultados leídos.
  GET403 o ID ausente mantiene bloqueo y mensaje seguro.
- Creación/apertura perdida y recibo de creación inválido: un POST y ningún
  reintento/resolución por coincidencia. Respuestas privadas no se exponen.
- Pendiente: un POST, selección bloqueada y beforeunload prevenido. Salida por
  enlace tiene confirmación deshabilitada; cancelar no navega. Tras incertidumbre,
  cancelar conserva intento; aceptar navega sin otro POST o cancelación backend.
- Fecha2026-09-14T02:30Z muestra13 sept.2026,23:30 en la zona v1; no14 sept.
  Timestamp inválido conserva fallback. Los límites monetarios de UX-033 siguen.

Node24.22.1 instalado con tzdata2026e para pruebas, sin cambiar PATH o instalar.
No se relajaron fechas para Node22/tz2024b; TD-072 sigue abierta. Logs host Temp:
ux034-regression.log,ux034-attempts.log,ux034-guards-final.log,
ux034-types-verified.log,ux034-lint-verified.log. Tipos web y lint dirigido
aprobados, formato/diff-check al cierre. Guardas opcionales de panel no cambian
consumidores independientes; el estado autoritativo del intento vive en CashSurface.

## Límites

Simulación UI/contratos, no PostgreSQL/navegador/build o revisión visual nuevos.
No se afirma auditoría única real nueva; se conserva el protocolo existente de
replay probado por el backend y aquí se verifica el mismo body/key. Igualdad de
headers no prueba por sí sola efectos transaccionales. beforeunload aquí es
evento jsdom, no diálogo nativo o garantía contra cierre forzado.

TD-073 permanece abierta por Back/Forward SPA, recarga y durabilidad sin recibo.
Salir elimina la copia del componente; apertura/creación sin ID exige revisión
manual fuera de este intento, sin identificación automática por valores. No
nuevo protocolo de idempotencia o recuperación durable. TD-069/071/072 no se
cierran por esta etapa. Sin datos operativos, migración dev, purga de recibos,
contenido financiero nuevo en logs/URLs/storage, commit/push, despliegue o CI remota.

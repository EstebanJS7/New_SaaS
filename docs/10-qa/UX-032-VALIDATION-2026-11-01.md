# UX-032 — Importes de lectura de Caja

Story [[UX-032-cash-amount-presentation]], 2026-11-01. Main3292ffc, sin commit/push.

Cambio exclusivo de cash-display.ts: reutiliza formatEsPyDecimal, presenta
faltante/sobrante en español, conserva signos/clasificación y fallback inválido.
No Number, cálculos, moneda, inputs, validaciones, comandos o datos nuevos.
El cero fraccionario se omite conforme a DEC-080; escala fraccionaria no nula
intacta. Se elimina el acoplamiento de presentación al cliente de Ventas.

Pruebas existentes adaptadas solo en aserciones de pantalla; fixtures y cuerpos
wire intactos. Conservan cierre rechazado, idempotencia de movimientos, permisos,
signos/cero/valores ausentes y lectura fallida. Aserción del cierre equilibrado
se ajusta a cero con regex exacta; no comparación parcial. Se añaden a casos
existentes importes superiores a Number.MAX_SAFE_INTEGER, fracción mínima y
fallback inválido, sin afirmar que el backend acepte importes fuera de su rango.

Verificación dirigida Caja/BFF y formateador compartido completada. Lint dirigido
y tipos web aprobados, caché temporal aislada. Logs host Temp/ux032-tests.log,
ux032-lint.log,ux032-types.log. No se relajaron timeouts/retries ni se modificó
producto para aceptar resultados financieros distintos.

Advertencias React sobre keys duplicadas en mocks de cash-surface observadas;
sin supresión ni corrección ajena al alcance. No equivalen a prueba de datos
duplicados en PostgreSQL. Pendiente de revisar en la siguiente etapa de Caja.

No nueva ejecución de build, PostgreSQL, Playwright o revisión visual: cambio
acotado de presentación, sin rutas/dependencias nuevas; preferencia explícita
del usuario de verificar según riesgo. Estas gates no se presentan como hechas.
Fechas UTC, entrada editable y localización integral de Caja siguen pendientes;
no se cambia zona por suposición. No certifica módulo entero ni UI V1 global.


## Resultado final

**190 casos distintos en11 archivos aprobados**. Primera selección189/190,
106,03s: único fallo era getByText250.00 de MovementPanel, restante escala cero
de presentación. Se actualiza solo esa aserción; recheck26/26,13,98s,salida0,
sin reejecutar otros archivos verdes. Fixtures y payloads no cambian. Logs
Temp/ux032-movement-final.log y ux032-final-lint.log, ambos salida0. Tipos web
y lint dirigido previos salida0; formato y git diff --check aprobados.
Story done en su alcance. Sin nuevos builds/PG/navegador ni inferencia de CI
remota. Fechas UTC y entrada editable conservadas; próxima etapa es localización
integral de Caja con lectura de zona autorizada, mensajes y formularios. Las
advertencias de keys se conservan para revisar allí; no se relajaron pruebas
o se ocultaron errores. Sin commit/push y con trabajo local previo preservado.

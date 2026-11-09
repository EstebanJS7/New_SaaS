# UX-033 — Formularios y feedback de Caja

Story [[UX-033-cash-forms-and-feedback]], 2026-11-02. Main3292ffc; trabajo local
previo conservado, sin commit/push. Alcance PRD20/29/41 y DEC-080; sin cambio
PRD.

## Implementación

Superficie, estados, ayudas, etiquetas, resultados y errores propios en español.
Mensajes wire de los clasificadores intactos; desconocidos/privados usan copia
segura. Fechas siguen UTC como antes, sin asumir zona del tenant. Datos de
usuario se muestran como texto React, sin traducción de nombres/motivos
persistidos.

normalizeCashAmountInput reutiliza normalizeEsPyDecimalInput y valida la misma
forma wire Decimal(14,2). Solo texto: grupos de miles/punto, decimal/coma,
máximo12 enteros y2 decimales. Cero permitido al abrir/contar y prohibido al
mover; motivos/dirección mantienen reglas. No Number, cálculos o redondeo.
Paneles normalizan al construir payload; API/BFF/backend financiero no cambian.

Abrir, registrar y cerrar requieren revisión con ConfirmActionDialog existente.
Revisión captura el intento normalizado; abrir/cancelar no envía ni genera
clave. Confirmar envía; pendiente bloquea doble confirmación y error conserva
copia/revisión. Clave de movimiento se genera al confirmar y solo rota tras
respuesta confirmada. Sesión cerrada no ofrece nuevos comandos ni se reabre.

Se corrigen keys hermanas iguales de MovementPanel/ClosePanel con prefijos
distintos, conservando remonte por sesión. Las advertencias de UX-032 no eran
prueba de filas duplicadas: la causa localizada era identidad React compartida
entre dos paneles. No cambio de IDs wire ni ocultación de console warnings.

## Verificación dirigida

**201 casos distintos en12 archivos aprobados**: Caja, BFF y helper compartido.
Nueva cash-review.test.tsx:11 casos (8 límites/localización y3 recorridos de
revisión/cancelación/confirmación). Máximo999.999.999.999,99 llega exactamente
como999999999999.99;1.234→1234;1,500, escala3, dot-decimal y exceso de rango se
rechazan. Revisión de cierre envía solo countedAmount; no calcula expected/diff.
Movimiento conserva payload y clave tras rechazo. Pendiente con promesa retenida
solo llama una vez. Respuesta privada en error no aparece ni inventa éxito.

Pruebas previas mantienen payloads/fixtures wire, permisos, conflictos, body
allowlist, motivos/dirección, estados terminales y resultados con signo.
Entradas de borrador se adaptaron a coma, diferenciándolas de cuerpos directos
API. Helpers existentes pulsan la revisión real antes del comando; no omiten
asserts.

Primera selección172/190,68,73s: expectativas antiguas de idioma, formato local
y selectores. Segunda197/201,65,25s: cuatro fallos de expectativa (constante
wire esperada como texto, valor editable con punto, espacio final de opción y
selector del botón cuyo label cambia al estar pendiente). Se conserva constante
wire y se exige texto seguro; valor editable coma; se elimina espacio accidental
en producto; prueba pendiente conserva referencia al botón y comprueba bloqueo.
Recheck solo cuatro archivos: **47/47,31,10s,salida0**, sin sumar casos
repetidos.

Tipos detectaron fixture nuevo sin openedByMembershipId y opción exact de
Playwright usada en Testing Library; corregidos sin alterar producto o
contratos. Tipos web y lint final de Caja salida0; formato/diff-check al cierre.
Logs host Temp/ux033-tests.log,ux033-tests-final.log,ux033-recheck.log,
ux033-types-final.log,ux033-types-verified.log,ux033-lint-verified.log.

Todo lo anterior es simulación de componentes/contratos, no nueva ejecución
PostgreSQL, navegador o verificación visual. Reutiliza modal ya verificado en
etapas previas; foco inicial comprobado aquí en jsdom, no contención nativa
nueva. No build nuevo: sin rutas/deps nuevas, tipos y pruebas de
componentes/transportes son los gates dirigidos de esta Story, según preferencia
de verificación por riesgo. Sin migraciones, datos operativos, nuevos permisos,
endpoints o servicios.

## Límites

No certifica todo Caja/UI V1 o CI remota. Zona horaria, recuperación durable y
continuidad de intentos inciertos fuera del documento siguen pendientes;
[[TD-073-cash-attempt-recovery-and-navigation]] registra la última por
inspección estática, sin alegar reproducción real. TD-069/071/072 independientes
conservadas. Sin logs/URLs/storage nuevos con contenido financiero, purga de
historial, commit/push o despliegue.

---
id: DEC-092
type: decision
title: Recoverable command attempts for sale creation and cash opening
status: accepted
date: 2026-11-03
related_epics: [EPIC-12, EPIC-13]
related_stories: [UX-035, UX-031, UX-034]
prd_change_required: false
---

# DEC-092 — Intentos recuperables al crear una venta y abrir caja

## Contexto

[[TD-071]] y [[TD-073]] quedaron abiertas porque la protección de UX-031 y
UX-034 vive en la página: una recarga, Atrás/Adelante o un cierre forzado
pierden la copia local, y una creación sin ID confirmado no se podía
identificar. Las dos deudas pedían acordar un contrato propio antes de ampliar
la garantía. Esteban Jiménez pidió resolverlas el 2026-11-03.

## Decisiones

1. **`Idempotency-Key` opcional en `POST /sales` y `POST /cash/sessions`**, con
   el mismo patrón que ya usan el cobro y los movimientos:
   - venta: `idempotency_record` con la operación `sale.create` y la huella del
     cliente y las líneas;
   - sesión: el id de la sesión se deriva de `(tenant, clave)`, como el de los
     movimientos.

   La misma clave con el mismo cuerpo repite el resultado (`200`); con otro
   cuerpo, `409`. Sin clave todo sigue como antes.

2. **Consulta por clave, de solo lectura:** `GET /sales/attempts/:key`,
   `GET /cash/sessions/attempts/:key` y `GET /cash/movements/attempts/:key`
   devuelven lo que ese intento registró o `404`. El tenant viene de la sesión;
   la misma clave en otro tenant no encuentra nada.
3. **El navegador guarda solo la clave, el tipo y la hora** de cada intento sin
   respuesta, en `sessionStorage` de la pestaña. Nunca artículos, precios,
   montos, motivos ni datos del cliente (la regla de TD-071). Se borra al
   recibir una respuesta definitiva.
4. **La pantalla nunca reenvía sola.** Con un intento incierto ofrece
   «Consultar»; si no se registró, «Reintentar» envía el mismo cuerpo con la
   misma clave, que no puede duplicar. Tras recargar, un panel ofrece consultar
   los intentos de la página anterior: venta encontrada → enlace al borrador
   para cobrarlo; sesión encontrada → queda seleccionada; movimiento encontrado
   → ya figura en la sesión; nada registrado → se olvida.
5. **El proxy** reenvía la clave en esas dos rutas, igual que en las demás, y
   solo acepta claves con formato UUID en las consultas.

## Límites que quedan

- Cerrar la pestaña borra `sessionStorage`: el intento queda sin consulta
  automática. El borrador sigue visible en el listado de ventas y la sesión en
  la lista de sesiones.
- La creación de una caja no lleva clave: su nombre es único por tenant, y un
  reintento responde «ya existe», que identifica el resultado.
- El cierre de sesión ya se resolvía por su id conocido (UX-034).

## Decisión

Aceptada el 2026-11-03.

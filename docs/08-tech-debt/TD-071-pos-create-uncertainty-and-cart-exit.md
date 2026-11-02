---
id: TD-071
type: tech-debt
title: Uncertain sale creation and unsaved cart exit
status: open
severity: medium
owner: engineering
related_stories: [UX-030, POS-004]
created: 2026-11-01
updated: 2026-11-01
---

# TD-071 — Respuesta incierta al crear venta y salida del carrito

## Evidencia y alcance

Inspección estática del recorrido en UX-030: CounterSurface.handleCheckout llama
a createSale, pero locked solo considera createdSale/completed/isPending. Un
fallo de transporte después de POST /sales puede dejar un borrador persistido
sin ID confirmado en pantalla y permitir otro intento. No hay idempotencia de
creación en ese consumidor. Esto señala riesgo de duplicar borradores; no es
prueba de doble cobro ni de duplicación de movimientos confirmados.

El carrito usa estado local sin advertencia de salida o recuperación propia.
Salir por enlaces puede descartar artículos/precios ingresados. UX-030 agrega
retorno a la consulta, pero no certifica preservación del carrito; su alcance
aprobado es contexto verificable y navegación sin efectos.

No se ha ejecutado una reproducción real de respuesta perdida de POST /sales
en esta Story. Archivo: apps/web/src/app/(app)/app/sales/counter-surface.tsx.
Las protecciones de finalización existente y la recuperación de estado incierto
de una venta con ID no sustituyen protección de creación sin ID confirmado.

## Próxima etapa

Proteger el intento incierto y los cambios locales sin generar claves en proxy,
recrear borradores o inferir éxito comparando valores. Mantener cliente elegido,
cantidades/precios exactos, revisión explícita y autoridad backend. Definir la
interacción de salida cuando un POST está pendiente o su resultado es incierto.
No guardar datos comerciales/clínicos en almacenamiento persistente del browser.

Una idempotencia nueva de creación o recuperación durable exige acordar su
contrato; no deducirlo de la idempotencia de completar. Preferir primero la
protección UI compatible con contratos actuales. Verificar respuesta perdida
con PostgreSQL desechable y navegador, con cero reenvío automático y sin alterar
stock/caja/pagos para obtener verde.


## Implementación compatible en curso — UX-031

Bloqueo de intento incierto con copia local, guardia síncrona y advertencia de
salida por enlaces/beforeunload. Sin contrato nuevo de idempotencia o búsqueda
automática de resultado por valores. La reproducción real tras POST persistido
y respuesta abortada está en verificación. No se marca resuelta antes de gates.
Recarga/Back/Forward SPA y cierre forzado siguen sin recuperación durable;
la protección opera sobre la copia en pantalla conforme al alcance autorizado.


## Mitigación verificada — UX-031 done

Bloqueo del intento incierto y copia local/salida por enlaces implementados.
Reproducción real PostgreSQL/BFF/API:201 confirmado por servidor y abortado al
cliente, un borrador/auditoría, precio/cantidad/cliente exactos y sin nuevoPOST,
pagos/stock/caja. Pendiente, cancelar/confirmar salida y403 real aprobados.
184 pruebas, builds/lint/tipos y navegador8+5 distintos; QA UX-031 conserva los
fallos e iteraciones. No se declara una ejecución única13/13.

TD-071 permanece open por límites explícitos: Back/Forward SPA sin interceptar
y recarga/cierre forzado sin copia/recibo durable. UI actual no resuelve
identificación de una creación sin ID tras perder documento. Extender garantía
requiere definir contrato de idempotencia/recuperación de creación, separado de
CompleteSale, con decisión aprobada y evidencia propia. No buscar coincidencias
por valores, persistir contenido comercial en browser ni purgar borradores.

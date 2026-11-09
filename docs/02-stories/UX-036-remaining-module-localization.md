---
id: UX-036
type: story
title: Localize the remaining staff modules to es-PY
epic: EPIC-UX
status: done
priority: medium
depends_on: [UX-027, UX-032]
prd_sections: []
permissions: []
branch: feat/ux-036-remaining-localization
created: 2026-11-09
updated: 2026-11-09
---

# UX-036 — Localizar los módulos staff restantes (es-PY)

## Objetivo

Que toda la superficie staff hable español (es-PY, voseo) y muestre importes,
cantidades y fechas con el formato local, como ya lo hacen clientes, pacientes,
catálogo, agenda, POS, caja y configuración. El portal sigue en inglés.

## Contexto

Inventario del 2026-11-09: compras, proveedores, facturación, documentos
fiscales, importaciones, notificaciones, reportes y marca todavía muestran texto
en inglés (~570 cadenas) y ninguno usa `apps/web/src/lib/es-py-format.ts`
(fechas «… UTC», decimales crudos, ISO sin formato). Algunos módulos ya
localizados devuelven todavía `error.message` del servidor en su caso por
defecto (agenda, clínica, ventas, sucursales).

## En alcance

- Unidad A: compras y proveedores.
- Unidad B: facturación y documentos fiscales.
- Unidad C: reportes y marca.
- Unidad D: importaciones, notificaciones y los casos por defecto en inglés de
  agenda, clínica, ventas y sucursales.

## Fuera de alcance

- El portal del cliente.
- Cambiar mensajes de la API o comportamiento: solo copia, formato y los tests
  que los afirman.
- Rediseños visuales.

## Criterios de aceptación

- [x] Unidad A: todo texto visible de compras y proveedores (títulos, etiquetas,
      botones, estados de carga/vacío/error/éxito, confirmaciones, encabezados,
      `aria-label`, errores de `userFacing*Error`) en es-PY con voseo; fechas,
      cantidades y costos con los helpers de `es-py-format`.
- [x] Unidad B: ídem para facturación y documentos fiscales; las fechas dejan de
      mostrarse como «… UTC» y los importes usan `formatStaffMoney` /
      `formatPygAmount`.
- [x] Unidad C: ídem para reportes (columnas, catálogo de reportes, estados
      vacíos, celdas con `formatEsPyDecimal` y fechas locales) y marca.
- [x] Unidad D: ídem para importaciones y notificaciones (fechas con
      `formatEsPyInstant`); los `userFacing*Error` de agenda, clínica, ventas y
      sucursales ya no devuelven texto del servidor en inglés en su caso por
      defecto.
- [x] Los errores de conexión usan la frase común «No se pudo conectar con el
      servidor. Revisá tu conexión y volvé a intentar.»
- [x] Ningún comportamiento cambia: mismos comandos, confirmaciones, permisos y
      estados; los tests afirman la copia nueva sin afirmar menos.
- [x] Tests de cada módulo, suite web completa y carril de navegador en verde;
      lint, tipos y formato limpios.

## Decisiones / ADRs

- [[ADR-002]] (tokens), UX-027 (consistencia), UX-032 (formato es-PY).

## Verificación

2026-11-09: unidades A (compras/proveedores, 125 tests), B
(facturación/documentos fiscales, 117), C (reportes/marca, 80; el CSV no cambia)
y D (importaciones, notificaciones y casos por defecto de
agenda/clínica/ventas/sucursales, 782 en sus carpetas). Verificación conjunta:
`pnpm lint`, `format-check` y `typecheck` limpios; suite web 2370/2370; build
web OK; carril de navegador 31/31.

Límites: los mensajes guardados por el servidor (motivos de fila de importación,
`lastErrorMessage` de notificaciones) se muestran tal como se registraron; las
constantes de mensajes de la API que el cliente usa para clasificar errores
siguen en inglés; las entradas de cantidad y costo aceptan punto decimal.

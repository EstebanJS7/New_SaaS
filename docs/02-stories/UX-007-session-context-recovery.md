---
id: UX-007
type: story
title: Staff session expiry and safe context recovery
epic: EPIC-01
related_epics: [EPIC-06, EPIC-12]
status: done
priority: high
depends_on: [UX-006]
prd_sections: ["8", "9", "13.1", "18", "19"]
branch: main
created: 2026-10-28
updated: 2026-10-28
---

# UX-007 — Sesión expirada y retorno seguro

Alcance aprobado por el usuario: aviso de sesión expirada, reingreso y retorno
al paciente/consulta/venta guardados. Sin nueva estrategia de autenticación ni
replay de comandos. La autorización sigue en API. No se conserva contenido
clínico o de pago para atravesar el acceso.

## Criterios

- [x] Un 401 de lectura o mutación staff presenta un aviso común; 403, fallos de
      red y 5xx no se interpretan como sesión expirada. Portal permanece
      separado.
- [x] El login y el acceso directo a una ruta privada conservan un destino local
      validado; rechazan destinos externos, query sensible y rutas de
      Portal/API.
- [x] Se vuelve a la consulta seleccionada o venta guardada y se relee el estado
      autorizado; no se repiten creación, autosave, cierre, cobro ni
      finalización.
- [x] Se explica que cambios no guardados no se restauran tras reingresar y que
      una operación sin respuesta debe revisarse antes de repetirla.
- [x] Pruebas dirigidas, lint, tipos, build y documentación con límites.

## Datos

IDs de recursos/contexto CONFIDENTIAL: solo referencias UUID en rutas staff ya
privadas y destino de retorno, nunca notas, nombres, contraseñas, importes o
pagos. Sin almacenamiento persistente del navegador ni logs nuevos. Navegación
completa tras autenticar elimina caché/borradores en memoria de la identidad
anterior y renueva nonce CSP/marca.

## Implementación

`staff-session-boundary.tsx` observa errores de las cachés Query/Mutation solo
en rutas `/app`. Ante un 401 cancela lecturas, desmonta el contenido privado y
muestra el aviso enfocado. No cambia las cookies, TTL, permisos o contratos de
Portal; no interpreta una respuesta 403/404/5xx como cierre de sesión.

`staff-return-path.ts` valida destinos y descarta parámetros no permitidos.
Middleware sobrescribe el encabezado de retorno desde la URL de la petición y el
layout vuelve a validarlo. `LoginForm` espera la autenticación correcta y
`navigation.ts` realiza una navegación completa. El QueryClient ahora pertenece
a cada montaje del proveedor, sin caché global compartida entre documentos.

La ficha aporta solo IDs de paciente/consulta/cita mediante
`useStaffResumeTarget`. La consulta de retorno se selecciona después de leer la
lista autorizada; si no está, se informa sin abrir un editor ni crear registros.
El POS aporta el ID de la venta cuya creación ya fue confirmada y el retorno
abre su detalle con lectura actual. Cada destino es una referencia, no
autoridad.

## Verificación

- 106 casos distintos del alcance comprobados en ejecuciones dirigidas: 47 de
  clínica, 5 de recuperación POS, 12 de middleware, 13 de destinos seguros, 7 de
  interrupción de sesión, 8 de formulario de acceso, 10 del layout y 4 de
  navegación completa. No es el resultado de una única ejecución global.
- Reejecución final de acceso/layout/navegación: 22/22. Los 2 casos nuevos de
  retorno clínico se reejecutaron tras añadir el aviso de consulta ausente; los
  otros 45 casos de ese archivo se omitieron en esa reejecución, habiendo pasado
  en la ejecución inicial. No se contabilizan dos veces.
- Typecheck web y ESLint del alcance pasaron. Build web final y verificación de
  salida pasaron; se conservan los avisos informativos preexistentes de Next
  sobre referencias TypeScript y plugin ESLint. El artefacto final de login
  también se comprobó para descartar texto con caracteres inválidos.
- Sin migración, endpoint o dependencia nueva. Sin cambios al backend ni prueba
  global de regresión. Evidencia ampliada en [[UX-VALIDATION-2026-10-27]].

## Límites

- No hay temporizador preventivo: el aviso responde al siguiente 401 de una
  lectura o acción. No se renueva ni prolonga la sesión automáticamente.
- No se preservan cambios sin guardar durante el reingreso. La recuperación
  clínica de TD-065 sigue limitada al documento y su plazo; no cruza
  identidades.
- Si una creación quedó sin respuesta y no llegó el ID, se vuelve al contexto o
  listado disponible y se debe revisar antes de recrear. No se promete descubrir
  una operación desconocida ni se reenvía una operación incierta.
- Solo se conservan rutas y parámetros admitidos. No se restauran filtros/texto
  libre ni todos los subrecorridos de edición; un destino no admitido vuelve a
  `/app`.
- Sin nueva ronda de navegador, expiración real de credenciales, pago externo ni
  auditoría de lector de pantalla. Pruebas con respuestas sintéticas y
  navegación simulada; los permisos reales siguen en API. Sin migraciones ni
  endpoints nuevos.
- Sin commit ni push solicitado.

Runtime smoke: API health and web health proxy returned 200; worker connected to
Redis. An unauthenticated HTTP request to a synthetic patient/encounter URL
returned 307 to staff login, preserving UUID context and discarding the extra
notes query key. No browser, credentials or clinical mutation were used.

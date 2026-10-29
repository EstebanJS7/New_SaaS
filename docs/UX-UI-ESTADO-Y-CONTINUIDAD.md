---
type: guide
title: Evolución UX/UI del espacio de trabajo
status: active
created: 2026-10-28
updated: 2026-10-29
related_stories:
  [
    UX-001,
    UX-002,
    UX-003,
    UX-004,
    UX-005,
    UX-006,
    UX-007,
    UX-008,
    UX-009,
    UX-010,
  ]
related_epics: [EPIC-03, EPIC-05, EPIC-06, EPIC-07, EPIC-12]
---

# Evolución UX/UI: estado y continuidad

## 1. Propósito y alcance

Este documento reúne el trabajo de experiencia de usuario e interfaz realizado
entre el 26 y el 28 de octubre de 2026. Sirve como punto de entrada para revisar
los cambios, comprender sus límites y continuar el desarrollo.

El objetivo es facilitar el trabajo del equipo de una clínica: encontrar al
paciente, gestionar su turno, registrar la atención y operar la venta con menos
ambigüedad, mejor feedback y una interfaz coherente.

La referencia visual es el proyecto local `investor/comunia-investor-web`:
navegación agrupada, jerarquía, espaciado, tarjetas de identidad y adaptación
móvil. Se toma como referencia de composición; NewSaaS conserva sus datos,
contratos, identidad configurable y reglas de negocio.

Esta guía consolida el estado documentado y contrastado con los archivos del
proyecto al 2026-10-28. No reemplaza el PRD, las decisiones aceptadas, las
Stories ni las pruebas. Su creación no implica una nueva ejecución de los
chequeos.

## 2. Estado de las etapas

| Etapa  | Trabajo                                         | Estado registrado | Lectura del estado                                                                                                             |
| ------ | ----------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| UX-001 | Base visual, shell, componentes y feedback      | `review`          | Implementada y revisada visualmente; conserva un criterio de verificación global abierto.                                      |
| UX-002 | Español/Paraguay, agenda, clínica, POS y acceso | `review`          | Implementación y validaciones acotadas registradas; no equivale a localización total ni a auditoría integral de accesibilidad. |
| UX-003 | Búsqueda e identidad del paciente en agenda     | `done`            | Búsqueda acotada, permisos, aislamiento y recorrido de selección verificados en su alcance.                                    |
| UX-004 | Resumen del paciente y navegación clínica       | `done`            | Detalle reorganizado con lecturas existentes y revisión de escritorio/móvil.                                                   |

Referencias:

- [[UX-001-staff-experience-polish]]
- [[UX-002-es-py-and-clinical-workflows]]
- [[UX-003-agenda-patient-lookup]]
- [[UX-004-patient-overview]]

Los documentos de QA conservan observaciones de etapas anteriores. Por ejemplo,
las menciones antiguas a acceso en inglés, profesionales identificados solo por
UUID o falta de cierre clínico real quedan superadas por las verificaciones
posteriores, fechadas dentro de esos mismos documentos.

UX-005 agrega el contexto de cita durante ficha y POS; está en `review`. Sus
pruebas, límites y propuesta de integración persistente están en la sección 17.

## 3. Criterios que guían la interfaz

- Priorizar tareas frecuentes y recorridos completos sobre decoración.
- Mostrar nombres y contexto legible; conservar los IDs para los comandos.
- Diferenciar carga, vacío, falta de resultados, permiso denegado y error.
- Mostrar éxito solo después de la respuesta correspondiente del servidor.
- Explicar las consecuencias antes de operaciones relevantes.
- Mantener accesibles el teclado, el foco y las ayudas de formularios.
- Preservar el trabajo pendiente y ofrecer recuperación frente a errores.
- Mantener el español y la presentación de Paraguay en las superficies
  priorizadas.
- Usar datos existentes; no inventar métricas, diagnósticos o calendarios
  médicos.
- Conservar la autorización del backend y el aislamiento entre organizaciones.

## 4. Base visual y navegación — UX-001

### Shell del equipo

Se reorganizó la navegación por tareas: espacio de trabajo, comercio, finanzas,
gestión y configuración. El elemento activo reconoce también las páginas de
detalle. El encabezado muestra contexto y el contenido limita su ancho de
lectura.

En móvil se utiliza un menú modal con foco contenido, cierre con Escape,
restauración del foco, cierre al navegar y bloqueo del desplazamiento del fondo.
Existe un enlace para saltar al contenido principal. Se retiraron controles de
relleno sin acción implementada.

### Componentes y estados compartidos

Se incorporaron o ajustaron `Input`, `Badge`, `Skeleton`, `Spinner`, iconos,
`Button` con estado de carga y `Card` con radio semántico. Continúa la base
Tailwind/shadcn; no se añadió otra biblioteca visual.

La barra de actividad responde a navegación, carga inicial de consultas y
mutaciones. Los refrescos de datos ya visibles no activan esa barra. Las rutas
incluyen estados de carga y error recuperable; listas y búsquedas tienen estados
vacíos y sin resultados.

### Pantallas iniciales

El dashboard y las listas de clientes, pacientes y catálogo recibieron una
jerarquía más clara, acciones y distribución adaptable. El dashboard presenta
las métricas que ya provee el sistema. Las búsquedas locales de esas listas
operan sobre los resultados recibidos; no constituyen paginación de servidor.

El resto de los módulos recibe el shell y los componentes comunes. Eso no
significa que todos sus formularios y recorridos estén rediseñados.

## 5. Marca, temas y seguridad del documento

La resolución de marca se mantiene:

```text
TenantBranding → ProductBrandPreset → CoreDesignDefaults
```

Los componentes reutilizables consumen tokens semánticos como `background`,
`foreground`, `primary`, `secondary`, `border`, `ring` y `radius`. No deben
fijar los colores, fuentes, logos o radios de Investor ni de una veterinaria
particular.

Se corrigió la continuidad del nonce del documento para que los estilos de marca
sigan autorizados al navegar con RSC. El ingreso exitoso abre un documento
autenticado completo. Se conserva CSP y no se habilita CSS arbitrario del
tenant.

La salida del staff utiliza el BFF privado `POST /api/session/logout` hacia el
comando existente de revocación. Una falla recuperable no se presenta como
cierre de sesión confirmado. El proxy público de autenticación conserva sus
límites.

Referencias: [[Branding and Theming]], [[ADR-002-branding-theme-layering]].

## 6. Español y formatos de Paraguay — UX-002

Se adoptó `es-PY` para la presentación del staff en las pantallas priorizadas:
shell, agenda, clínica, POS y acceso. El Portal y las demás superficies
operativas no se consideran completamente traducidos. Los nombres de especies,
razas u otros catálogos siguen siendo los datos existentes.

### Fechas y horas

Los instantes conservan su representación persistida y se muestran en el
contexto horario de la clínica. Las fechas de calendario mantienen su día
escrito. La apariencia del selector nativo de fecha/hora puede seguir el idioma
del navegador.

Se corrigió una diferencia de tres horas en FullCalendar: una cita de 16:00 se
veía a las 19:00 en la grilla. Un adaptador Intl local utiliza los conversores
existentes; grilla y lista se verificaron mostrando 16:00–16:30.

### Importes y cantidades

La presentación y la edición tienen formateadores separados. Se preservan las
cadenas Decimal de la API y no se convierten importes a `Number` para
calcularlos.

| Valor o entrada    | Interpretación                                             |
| ------------------ | ---------------------------------------------------------- |
| API `120000.00`    | En un campo editable: `120000,00`.                         |
| Entrada `120.000`  | Agrupación de miles: `120000`.                             |
| Entrada `1.234,50` | Decimal normalizado: `1234.50`.                            |
| Entrada `1,500`    | Decimal normalizado: `1.500`; no significa mil quinientos. |

Los formatos mal agrupados o ambiguos se rechazan. Se mantiene la moneda de la
API; no se agregan conversiones, redondeos o cálculos fiscales en la interfaz.

Referencia: [[DEC-080-staff-locale-es-py]].

## 7. Acceso y confirmaciones

Ingreso, recuperación y restablecimiento tienen textos en español, estados
pendientes y mensajes uniformes para errores de credenciales o tokens. Los
formularios conservan el envío nativo con Enter; un ingreso fallido limpia la
contraseña. Los errores usan regiones de alerta y descripciones asociadas a los
campos. Los mensajes de recuperación no confirman la existencia de una cuenta.

Las confirmaciones de operaciones relevantes utilizan `ConfirmActionDialog`,
basado en `<dialog>` nativo. Incluyen título, explicación, cancelación, estado
pendiente y error. Se verificaron ciclos de foco, Escape y retorno al invocador
en los casos documentados. La revisión clínica incorpora un resumen desplazable
que puede recibir foco por teclado.

Esto constituye evidencia semántica y de teclado acotada. No certifica anuncios
hablados ni cumplimiento WCAG completo.

## 8. Agenda e identificación de pacientes — UX-002 y UX-003

La agenda permite buscar por paciente o responsable principal y seleccionar un
resultado legible. El selector ofrece interacción de teclado, feedback de carga,
vacío y error. Los nombres se resuelven para calendario, lista y paneles de
turno. Desde un turno se puede abrir la ficha del paciente sin copiar un UUID.

La búsqueda cuenta con una capacidad backend específica y acotada: hasta 20
resultados de búsqueda y hasta 50 IDs para resolución explícita. Conserva
permisos, entitlement veterinario, proyección permitida y contexto de tenant
resuelto por el servidor. Un UUID ajeno o desconocido recibe el mismo `404`. No
se carga desde agenda todo el historial clínico ni se persiste la identidad en
el almacenamiento del navegador.

Los profesionales se presentan por `displayName` en filtros, creación,
aprobación y lista. Los comandos siguen utilizando `membershipId`. El cambio
extiende la proyección de opciones existente; no expone correos o credenciales.
Si no hay nombre disponible, se utiliza un fallback explícito con ID abreviado.

Referencias: [[DEC-081-appointment-patient-identity]],
[[DEC-082-agenda-professional-display-name]].

## 9. Ficha del paciente — UX-004

El detalle presenta identidad, estado activo/inactivo y acciones adaptables.
Incluye tres tarjetas de resumen:

| Tarjeta               | Fuente y comportamiento                                                |
| --------------------- | ---------------------------------------------------------------------- |
| Responsable principal | Vínculo principal activo y nombre del cliente disponible.              |
| Última consulta       | Consulta más reciente por fecha de creación, con estado y motivo.      |
| Próxima vacuna        | Próxima fecha ingresada por el equipo; no se deriva un esquema médico. |

Cada lectura distingue carga, ausencia y error. Una falta de permisos no se
interpreta como ausencia de responsable o de historial. Los avisos se limitan a
paciente inactivo, ausencia de principal activo y fechas de vacunación
registradas anteriores al día actual de la clínica.

Los enlaces Resumen, Ficha clínica, Vacunas y desparasitaciones y Responsables
desplazan a secciones del mismo documento. Mantienen montado el editor clínico.
El resumen y el registro de vacunas comparten la clave y la misma proyección de
caché para no mezclar formas incompatibles de datos.

No se añadieron fotos, pesos, un motor de alertas médicas ni un Patient 360
completo.

## 10. Consulta clínica: formulario, guardado y cierre

### Edición

Los campos conservan espacios mientras se escribe. Cada texto opcional refleja
el límite existente de 10.000 caracteres de la API, con contador y error
asociado. Un exceso de longitud bloquea guardado/cierre sin recortar
silenciosamente el texto. No se introdujeron campos clínicos obligatorios
nuevos.

### Guardado y recuperación

Continúa el autosave con control de versión y se agregó `Guardar borrador` para
guardar o reintentar explícitamente. Un error no dispara reintentos automáticos
continuos del mismo contenido. El estado distingue cambios pendientes, guardado,
error y conflicto.

Se corrigieron dos problemas: el cierre encadenado podía consumir una versión
anterior al guardado, y el ciclo de efectos de React StrictMode podía dejar
deshabilitado el autosave. Las pruebas conservan los casos de respuestas
antiguas, conflictos y ediciones que llegan mientras una escritura está en
curso.

### Protección del trabajo pendiente

- Se bloquea cambiar de consulta o crear otra mientras hay cambios pendientes.
- Los enlaces a otras rutas ofrecen confirmar la salida sin guardar o seguir
  editando.
- El autosave pausa durante esa decisión; una escritura en curso debe finalizar
  antes de aceptar la salida.
- Recargar o cerrar la ventana utiliza la protección nativa `beforeunload`.
- Los enlaces entre secciones de la misma ficha continúan disponibles.

**Recuperación al volver — TD-065:** al salir mediante Atrás/Adelante o una
navegación programática dentro del mismo documento, el borrador se conserva en
memoria durante diez minutos. Al volver, una lectura autorizada actual comprueba
el acceso y se abre la consulta con su texto pendiente. Se requiere revisión y
Guardado borrador explícito; una versión diferente bloquea sobrescrituras. Si la
consulta se cerró mientras tanto, el texto recuperado queda separado y de solo
lectura. No se modifica el historial ni se usan `localStorage` o
`sessionStorage`.

La recuperación no sobrevive una recarga, cierre, fallo del navegador,
expiración o cambio de documento por acceso/salida. Continúa la advertencia
nativa al cerrar o recargar; guardar es la vía durable. Referencia:
[[TD-065-clinical-history-navigation-guard]].

### Revisión y cierre

Antes de cerrar se revisan motivo, antecedentes, diagnóstico, tratamiento,
resumen para el cliente y notas internas, identificadas como exclusivas del
equipo. El comando guarda el borrador pendiente y cierra utilizando la versión
devuelta. Un guardado fallido, conflicto o edición posterior impide un cierre
que perdería datos.

Después del cierre se muestra el contenido persistido como solo lectura y se
mantiene la operación explícita de enmienda. El registro original sigue
inmutable. Las notas internas permanecen en la superficie del staff, separadas
del resumen para el cliente; no se añadió entrega al Portal.

## 11. Venta/POS: trabajo ya realizado

La revisión de venta presenta el total autoritativo y el desglose de pagos,
explica la igualdad exacta requerida y pide confirmación antes del comando de
completar. Se verificaron entrada local de importes, cantidades fraccionarias,
cancelación, pago insuficiente y error de finalización.

Existe evidencia de una venta demo de Gs. 120.000 completada registrando el
método QR. Ese registro local no contacta un procesador de pagos externo ni
acredita una integración real con él. No se añadieron vuelto, crédito, cálculo
fiscal o movimientos de stock/caja duplicados desde la UI.

El último refinamiento clínico no realizó una nueva venta ni un cobro.

### Recuperación cuando no se conoce el resultado del cobro

Una falla de transporte o respuesta desconocida bloquea repetir la confirmación.
El POS ofrece consultar la venta existente; el detalle permite actualizar su
estado con una lectura del servidor. Solo si continúa en borrador se habilita
revisar y reintentar, conservando los pagos ingresados en esa pantalla. Si ya
está completada o cancelada, desaparece la opción de cobrar.

Consultar el estado no crea otra venta ni un pago. Tampoco permite inventar el
historial de pagos: si la lectura no lo incluye, la interfaz indica que ese
detalle no está disponible. Se eliminaron mensajes contradictorios que afirmaban
que la venta seguía abierta después de perder la respuesta.

Verificación de esta mejora: 55 pruebas dirigidas, tipos, lint, build y
verificación de salida correctos. No se volvió a realizar una venta demo ni se
usó un procesador externo.

## 12. Recorrido disponible y límite de integración

El recorrido de navegación comprobado es:

```text
Agenda → Gestionar turno → Abrir ficha del paciente
       → Ficha clínica → Crear/seleccionar consulta
       → Editar y guardar → Revisar cierre → Consulta cerrada de solo lectura
```

El flujo demo independiente de POS fue verificado en la etapa anterior. Con
UX-006 existen asociaciones persistentes explícitas cita → consulta y consulta →
venta, implementadas tras la aprobación de DEC-083 y PRD §13.1. La nueva
integración fue verificada con pruebas de componentes, API y PostgreSQL; no se
repitió el recorrido completo en navegador durante esta etapa.

Cerrar una consulta, completar un turno y completar/cobrar una venta siguen
siendo operaciones separadas. Ver la sección 18 para el uso y los límites.

## 13. Mapa de archivos principales

Las rutas siguientes son relativas a la raíz del repositorio.

| Área                      | Archivos o directorios                                                                |
| ------------------------- | ------------------------------------------------------------------------------------- |
| Componentes compartidos   | `packages/ui/src/components/ui/`                                                      |
| Shell y actividad         | `apps/web/src/components/shell/`                                                      |
| Feedback y confirmaciones | `apps/web/src/components/feedback.tsx`, `confirm-action-dialog.tsx`                   |
| Carga y error de rutas    | `apps/web/src/app/(app)/loading.tsx`, `error.tsx`                                     |
| Acceso                    | `apps/web/src/app/login/`, `forgot-password/`, `reset-password/`                      |
| Formatos locales          | `apps/web/src/lib/es-py-format.ts`                                                    |
| Marca/CSP                 | `apps/web/src/providers/document-nonce.tsx`                                           |
| Salida privada            | `apps/web/src/app/api/session/logout/`                                                |
| Agenda y selector         | `apps/web/src/app/(app)/app/agenda/`                                                  |
| Búsqueda backend          | `apps/api/src/patients/patient-lookup.*`                                              |
| Opciones de profesionales | `apps/api/src/scheduling/appointment.dto.ts`, `appointment.service.ts`                |
| Ficha y resumen           | `apps/web/src/app/(app)/app/patients/[id]/patient-detail.tsx`, `patient-overview.tsx` |
| Clínica y prevención      | Mismo directorio: `clinical-workspace.tsx`, `clinical-records.tsx`, `clinical-api.ts` |
| Venta y cobro             | `apps/web/src/app/(app)/app/sales/`                                                   |

La capa visual no altera los ledgers, la resolución de tenant o las
autorizaciones del backend. Las excepciones de contrato se documentan en
UX-003/DEC-081 (búsqueda) y DEC-082 (nombre de profesional). Las etapas visuales
iniciales no requirieron migraciones. UX-006 incorpora una migración aditiva
para vínculos tipados en Veterinary, sin sustituir el stack ni modificar los
ledgers de Core.

## 14. Evidencia de verificación

Los resultados son ejecuciones documentadas en las etapas indicadas, no un único
total acumulado. Hay solapamiento entre suites; no deben sumarse.

| Etapa                            | Evidencia registrada                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base UX-001                      | 36 pruebas UI y 119 web dirigidas; build, tipos y lint del alcance. La ejecución web global histórica no quedó completamente verde.                                                  |
| Búsqueda UX-003                  | 25 pruebas API y 54 web; aislamiento, permisos, teclado, tipos, lint y build del alcance.                                                                                            |
| Localización y recorridos UX-002 | 131 pruebas web dirigidas; posteriormente 44 de agenda/zona horaria. Revisión demo de turno, cierre clínico y venta local.                                                           |
| Acceso y profesionales           | 64 pruebas web, 45 de servicio y 18 HTTP; builds API/web y revisión visual posterior.                                                                                                |
| Ficha UX-004                     | 47 pruebas dirigidas; escritorio y móvil 390 × 844, sin desborde horizontal de página en la ficha revisada.                                                                          |
| Refinamiento clínico final       | 53 pruebas: 37 clínicas, 10 de detalle y 6 de resumen; tipos, lint dirigido, build y verificador de salida. Caso demo real de creación/autosave/revisión/cancelación/cierre/lectura. |

El entorno de revisión usa PostgreSQL, Redis y MinIO locales con datos demo, API
y web locales. [[TD-064-windows-verification-environment]] registra los
problemas de portabilidad y zona horaria de las ejecuciones históricas en
Windows. Los chequeos acotados recientes no cierran por sí solos esa deuda
global.

Las fuentes detalladas son [[UX-AUDIT-2026-10-26]] y
[[UX-VALIDATION-2026-10-27]], junto a la verificación propia de UX-004.

Las capturas quedaron como artefactos locales de la sesión. Los nombres permiten
localizarlas sin hacer depender esta guía de una ruta personal de Windows:

- `ux002-acceso-espanol.png`
- `ux002-profesionales-validados.png`
- `ux004-patient-overview.png` y `ux004-patient-mobile.png`
- `clinical-close-review.png` y `clinical-closed-record.png`

## 15. Pendientes y continuidad recomendada

Esta tabla propone orden de trabajo; no convierte recomendaciones en alcance
aprobado.

| Prioridad | Pendiente                                                | Condición para considerarlo resuelto                                                                                                  |
| --------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Alta      | TD-065 resuelta: recuperación temporal implementada      | Recuperación de diez minutos en memoria; verificación dirigida y Atrás/Adelante documentadas en TD-065. No es almacenamiento durable. |
| Alta      | Validar la integración UX-006 con personal de clínica    | Las asociaciones ya persisten; queda la revisión de usabilidad del recorrido integrado con casos habituales y fallidos.               |
| Alta      | Revisar con personal de clínica los recorridos completos | Medir comprensión, errores y tiempo de tarea con escenarios habituales y fallidos.                                                    |
| Alta      | Auditoría de accesibilidad y regresión visual            | Lector de pantalla, anuncios, contraste, zoom, textos largos, teclado, claro/oscuro y movimiento reducido.                            |
| Media     | Extender localización a módulos restantes                | Inventariar pantallas y vocabulario; comprobar errores y formatos sin asumir que recibir el shell las traduce.                        |
| Media     | Extender búsqueda y paginación a ventas                  | Pacientes ya implementado en UX-008; definir el contrato de ventas y conservar autorización y estados de cobro.                       |
| Media     | Tratamientos, estudios y pesos — TD-055                  | Implementar la UI solo dentro del alcance aprobado; hoy existen capacidades API sin superficie staff completa.                        |
| Media     | Sesión expirada y recuperación de contexto — UX-007      | Aviso común, retorno a registros guardados y relectura autorizada; cambios sin guardar no atraviesan el reingreso. Ver sección 19.    |
| Posterior | Rendimiento y métricas de uso                            | Medir rutas y consultas antes de introducir nuevas optimizaciones o gráficos.                                                         |

## 16. Cómo continuar el trabajo

1. Elegir una Story y leer sus dependencias, reglas, sección de PRD y módulo.
2. Inspeccionar código y estado de Git; preservar los cambios existentes.
3. Registrar `in-progress` antes de modificar código sin cambiar criterios por
   cuenta propia.
4. Implementar la mejora con tokens semánticos, validaciones y estados
   recuperables.
5. Ejecutar los chequeos aplicables; separar pruebas de componentes, API,
   navegador y sistemas externos.
6. Recorrer datos demo, casos de error y permisos. Conservar evidencia fechada.
7. Actualizar Story, módulo, QA y esta guía cuando cambie el estado consolidado.
8. Registrar límites como deuda o propuesta; no marcar `done` con requisitos
   obligatorios pendientes.

No publicar ni hacer push sin instrucción explícita. La documentación y el
código correspondiente deben viajar juntos cuando se prepare un commit/PR.

### Actualización de verificación — TD-065

60 pruebas relacionadas, TypeScript, lint dirigido, build de producción y
verificador de salida pasaron. Se realizó una única revisión breve de
Atrás/Adelante con datos sintéticos. La recuperación temporal descrita en la
sección 10 reemplaza el pendiente histórico de pérdida inmediata de borrador.

## 17. Contexto de cita durante la atención y el paso al POS — UX-005

Agenda conserva el ID de cita al abrir la ficha. Una tarjeta consulta esa cita
con los permisos existentes y presenta paciente, horario, estado, profesional
asignado y servicio agendado. Si el paciente no coincide, el ID es inválido o la
lectura falla, no muestra una asociación inventada ni impide el uso
independiente.

Una consulta cerrada ofrece **Ir al punto de venta**. Si existe contexto de
cita, el POS vuelve a leerlo y permite retornar a la ficha del mismo paciente.
Los servicios, el cliente y los importes de venta se eligen explícitamente en el
POS. Navegar no crea una venta, cobra, cierra la consulta ni completa el turno.

En UX-005 se implementó únicamente contexto de navegación. Esa descripción es
histórica: DEC-083 fue aceptada y UX-006 añade las asociaciones persistentes y
los contratos descritos a continuación.

Verificación dirigida: 108 casos relacionados (43 agenda, 45 clínica, 10
detalle, 5 contexto y 5 recuperación POS), con reejecución del contexto tras
corregir una aserción sobre opciones GET. TypeScript, lint, build de producción
y verificación de salida pasaron; detalle en
[[UX-005-appointment-care-sale-navigation]]. No se realizó una nueva operación
real ni revisión visual en navegador durante esta etapa; se priorizó el alcance
acotado de pruebas acordado con el usuario.

## 18. Vínculos persistentes de atención — UX-006

DEC-083 aceptada y PRD §13.1 definen una cita con varias consultas y una
consulta con varias ventas. Una consulta puede tener como máximo una cita de
origen; una venta, como máximo una consulta. Las operaciones independientes
siguen disponibles.

1. Abrí la ficha desde la cita. La sección de consultas vinculadas permite
   seleccionar una consulta existente antes de crear otra.
2. Creá o seleccioná la consulta y elegí **Vincular esta consulta a la cita de
   origen**. La confirmación guarda el vínculo y actualiza la lista de
   consultas.
3. Desde la consulta cerrada, abrí el POS. Se conserva paciente/consulta y, si
   está autorizado, la cita persistida. Las ventas vinculadas se pueden reabrir;
   desde la ficha también se puede elegir un borrador existente.
4. Si hay un servicio agendado, **Agregar servicio agendado al carrito** busca
   su ID en el catálogo activo cargado y usa la referencia de precio vigente. Si
   ya no está disponible, se informa el problema; no se inventa un importe.
5. Elegí explícitamente el cliente de facturación y los artículos. Tras crear la
   venta, **Vincular esta venta a la consulta** requiere otra confirmación. Si
   falla ese vínculo, se conserva la venta y se reintenta la asociación.
6. Completá la venta y registrá el pago mediante los comandos habituales.
   Asociar, navegar o cerrar una consulta no ejecuta esos comandos.

Los controles muestran carga, permisos y conflictos. Una cita de contexto que no
coincide con el origen persistido genera una advertencia; no reemplaza el
vínculo. Repetir la misma asociación es idempotente. Los vínculos no pueden
editarse ni eliminarse: una futura corrección exige una operación auditada con
motivo, fuera de esta etapa.

La autorización real se ejecuta en API: pertenencia, permisos clínicos y del
dominio relacionado, entitlements y recursos de la misma organización; cita y
consulta además deben pertenecer al mismo paciente. Los IDs son CONFIDENTIAL,
solo staff. No se copian notas clínicas al POS ni al Portal.

Implementación: `clinical.links.controller.ts` / `clinical.links.service.ts` en
API, `clinical-associations.tsx` y `appointment-journey.tsx` en web, y migración
`20261028000001_clinical_journey_links`. El módulo Core de ventas no conoce
pacientes ni consultas; las tablas de asociación pertenecen a Veterinary.

Evidencia y límites: [[UX-006-persistent-care-links]] y
[[UX-VALIDATION-2026-10-27]]. Se priorizaron pruebas acotadas según lo acordado;
no se realizó una nueva revisión en navegador, un pago externo ni una auditoría
completa de accesibilidad. La prueba con personal de clínica sigue recomendada.

## 19. Sesión expirada y retorno al trabajo — UX-007

Cuando una lectura o acción staff recibe HTTP 401, se oculta el espacio de
trabajo y aparece **Tu sesión terminó**, con el foco en el aviso y un acceso a
**Volver a ingresar**. Un error de permisos, una caída del servidor o una falla
de conexión mantienen su tratamiento habitual; no se presentan como cierre de
sesión.

Al ingresar correctamente se abre un documento nuevo, con marca y nonce CSP
actualizados. Se vuelve al paciente/consulta seleccionada o al detalle de la
venta guardada y se consulta otra vez el estado autorizado. La consulta solo se
abre si está presente en la lista actual del paciente; si no aparece, se informa
el límite. Los permisos y la organización siguen siendo responsabilidad del
backend.

Solo se conserva el destino local y referencias UUID permitidas. No se guardan
notas, nombres, carrito, importes ni pagos en almacenamiento del navegador. Los
borradores clínicos temporales en memoria no atraviesan el reingreso. El aviso
explica que los cambios sin guardar no se restaurarán.

No se reenvían comandos de creación, guardado, cierre o cobro. Si una operación
quedó sin respuesta, hay que consultar el registro antes de repetirla. Si no
llegó el ID de una creación, se debe revisar el listado: no es seguro asumir que
falló ni crear un duplicado. Portal conserva su flujo de acceso independiente.

Los enlaces privados abiertos con la sesión vencida también conservan el destino
validado. Se descartan destinos externos, rutas de API/Portal y parámetros
ajenos al contexto permitido; una ruta no soportada vuelve al escritorio. No
cambia el tiempo de sesión ni se añade un mecanismo de renovación automática.

Detalle técnico, comprobaciones y límites en
[[UX-007-session-context-recovery]].

## 20. Búsqueda y paginación del listado de pacientes — UX-008

El listado ya no descarga todos los pacientes para filtrar en el navegador. La
búsqueda se confirma con **Buscar** o Enter, admite nombre de paciente y, con
permiso de clientes, responsable principal activo. Los filtros incluyen
activos/inactivos/todos y el orden por nombre o creación más reciente.

El servidor devuelve páginas de 20 registros y el conteo del mismo filtro y
organización. La interfaz indica el rango y la página actual, deshabilita los
límites de navegación y distingue carga, falta de resultados y errores con
reintento. No presenta filas de una consulta anterior bajo filtros nuevos.

Abrir una ficha y volver dentro del mismo documento conserva búsqueda, filtros y
página durante diez minutos. Ese contexto permanece solo en memoria: no se
incluyen nombres en URLs ni se escribe almacenamiento del navegador. Una recarga
o un reingreso lo descarta. El selector de agenda mantiene su contrato acotado.

Quien solo tenga permiso de pacientes conserva el listado por nombre del animal;
se informa que no puede buscar ni ver nombres de responsables. La autorización
real y el tenant se resuelven en API. No cambian los comandos de pacientes.

Esta etapa cubre pacientes. Ventas continúa en UX-009 (sección 21); aplicar
búsqueda/paginación a tratamientos, estudios y pesos sigue como trabajo
posterior. Evidencia y límites en [[UX-008-patient-search-pagination]].

## 21. Búsqueda y paginación de ventas — UX-009

El POS conserva `/app/sales`. Su enlace **Listado de ventas** abre
`/app/sales/history`; el detalle incluye **Volver al listado de ventas**. El
listado consulta páginas reales de 20 sin cargar todas las ventas ni resolver
clientes mediante un listado completo. Solo muestra UUID, estado, fecha de
creación y cliente autorizado. El importe y las líneas se consultan en el
detalle.

**Buscar** o Enter aplica UUID completo o nombre del cliente (solo con permiso
de clientes). El filtro ofrece Todos, Borradores, Completadas y Canceladas; el
orden permite creación más reciente o más antigua, con UUID de desempate. No se
inventan números de venta, estado de pago ni situación fiscal. No busca
pacientes, consultas o conceptos clínicos desde Core Sales.

Hay rango/conteo, página, límites Anterior/Siguiente, carga, vacío, error y
reintento. Texto en español, fechas/conteos es-PY y tokens semánticos. Al abrir
una venta y volver en el mismo documento se conserva el contexto aplicado diez
minutos. No se pone el texto en URL ni almacenamiento persistente. Recargar o
reingresar lo descarta; UX-007 admite el destino del listado sin sus filtros.

Backend exige staff, tenant, sales.read y entitlement sales. Sin customers.read
permite listar/buscar UUID y oculta nombres. GET y asociaciones clínicas siguen
con sus contratos previos. Sin efectos sobre caja, pagos, stock, cancelación,
completar ventas ni cálculos. No se usó navegador ni se realizaron cobros.
Evidencia automatizada, PostgreSQL y límites visuales separados en
[[UX-009-sales-search-pagination]] y [[UX-VALIDATION-2026-10-29]].

UX-009: estado final `done`; 121 pruebas distintas, lint y tipos API/web, builds
aislados y verificación de salida aprobados. Sin revisión visual nueva.

## 22. Búsqueda y paginación de clientes — UX-010

Clientes ya consulta páginas reales de 20 desde el servidor. **Buscar** o Enter
aplica nombre visible, razón social, documento o RUC existentes. Los filtros
ofrecen activos/inactivos/todos y personas/empresas/todos los tipos. El orden es
nombre A–Z o creación reciente con UUID de desempate. No se descargan todos los
clientes para filtrar en el navegador ni se agregan nuevos datos personales.

La superficie `/app/customers` conserva las acciones previas y la confirmación
explícita de desactivación. Texto en español, conteos es-PY, controles
etiquetados y estados diferenciados de carga, vacío, error y reintento. El
servidor mantiene conteo/página coherentes en una misma lectura. Las filas no
incluyen documento/RUC completos, contactos ni direcciones.

Abrir cliente y **Volver al listado de clientes** conserva búsqueda, estado,
tipo, orden y página diez minutos dentro del mismo documento. No se incluyen
nombres/documentos en URLs, logs ni almacenamiento persistente. Recargar o
reingresar elimina ese contexto. Los errores no muestran detalles internos.

Staff, membresía y customers.read se exigen en backend con tenant del contexto;
no se introduce entitlement para Customers Core. Se preservan GET, CRUD,
contactos/direcciones y sus consumidores, incluido el POS. No hay cambios en
pagos, caja, stock o clínica. Evidencia automatizada y PostgreSQL real en
[[UX-010-VALIDATION-2026-10-29]]; sin nueva ronda de navegador. La traducción se
limita al listado y su retorno; Catálogo continúa en UX-011 (sección 23) y los
listados clínicos siguen como próxima etapa.

UX-010: estado final `done`; 114 pruebas distintas, lint completo, tipos y
builds aislados API/web con verificación de salida aprobados. Sin revisión
visual nueva.

## 23. Búsqueda y paginación del catálogo — UX-011

Catálogo consulta páginas reales de veinte artículos sin descargar el catálogo
completo para filtrar. Buscar o Enter aplica el nombre existente; los filtros
incluyen activos/inactivos/todos y Producto/Servicio/Medicamento/Insumo/todos.
Orden por nombre o creación reciente con UUID de desempate, conteo y página
coherentes en servidor.

Conserva el impuesto visible y el precio de referencia disponible, presentado en
es-PY sin cálculos ni conversión de valores. No se inventan SKU, códigos de
barras o categorías. Editar sigue siendo una acción separada y desactivar exige
su confirmación existente; navegar o filtrar solo consulta.

El detalle incorpora Volver al catálogo. Dentro del mismo documento se conserva
búsqueda, estado, tipo, orden y página diez minutos desde el último cambio. No
se incluyen búsquedas en URLs, logs ni almacenamiento persistente. Recarga y
reingreso descartan el contexto.

Staff, membresía activa, catalog.read y tenant del contexto se exigen en
backend; no se agrega entitlement a Catalog Core. GET /catalog y sus
consumidores del POS/agenda, tax-rates, precios, impuestos, stock y comandos
permanecen con sus contratos previos. La UI del listado tiene textos españoles,
tokens semánticos, controles etiquetados y estados de
carga/vacío/error/reintento.

Pruebas automatizadas y PostgreSQL real se registran por separado en
[[UX-011-catalog-search-pagination]] y [[UX-011-VALIDATION-2026-10-29]]. Sin
nueva ronda de navegador o mutaciones operativas. La traducción no se extiende
al resto del módulo o al POS. Los listados clínicos quedan como siguiente etapa.

UX-011: estado final `done`; 150 pruebas distintas, lint completo API/web, tipos
y builds aislados con verificación de salida aprobados. Sin nueva revisión
visual o E2E de navegador.

---
id: UX-028
type: story
title: Patient identity UI consistency
epic: EPIC-05
status: done
priority: high
depends_on: [UX-027, UX-008, PAT-003]
prd_sections: ["9", "10", "12", "29", "41"]
branch: main
created: 2026-11-01
updated: 2026-11-01
---

# UX-028 — Completar la experiencia de identidad de Pacientes

Continuación autorizada del roadmap V1 después de Clientes. Alcance mínimo
basado en [[UX-027-BASELINE-2026-10-31]], [[Patients]], [[DEC-080]] y
[[ADR-002]]. No cambia el PRD ni crea nuevas operaciones de negocio.

## Criterios

- [x] Alta/edición en español con etiquetas visibles, ayudas, errores vinculados
      y foco en el primer campo inválido según los contratos actuales.
- [x] Especie/raza y clientes distinguen carga, fallo, vacío y reintento
      explícito; no se infiere permiso de escritura del permiso de lectura.
- [x] Conserva creación activa atómica con responsable principal, creación
      inactiva, edición por diferencias, null de raza/fecha y fecha calendario.
- [x] Evita doble envío; conserva datos y bloquea el comando tras respuesta
      incierta o denegada; no muestra errores privados ni reenvía
      automáticamente.
- [x] Cancelación/enlaces explícitos y beforeunload advierten cambios sin
      guardar, solo en memoria; sin interceptar Back/Forward ni prometer
      recuperación durable.
- [x] Detalle/responsables mantienen estados claros y diseño adaptable,
      confirmación de desactivación y errores seguros; fallo de lectura no
      habilita sus comandos.
- [x] Conserva listado UX-008 y nombres de responsables condicionados a
      customers.read; no modifica contratos clínicos UX-018–026 ni Portal.
- [x] Pruebas dirigidas, regresiones pertinentes, lint, tipos y builds aislados
      aprobados con binarios instalados.
- [x] Navegador con API/BFF y PostgreSQL exclusivamente desechable verifica
      alta/edición/retorno, responsables, permisos, aislamiento y cero efectos
      al rechazar. Revisión visual escritorio claro y móvil oscuro,
      teclado/foco.
- [x] Story, módulo, continuidad, changelog y QA registran resultados y límites.

## Límites

Sin API/migración/dependencias nuevas, nuevos claims de sesión, selector nuevo,
reglas de responsable diferentes ni tratamiento de la carrera TD-011. No
completa Patient 360 completo ni Catálogo. No modifica clínica, agenda,
finanzas, inventario o Portal. Datos de identidad/vínculos CONFIDENTIAL; no URLs
con contenido, logs de payload o almacenamiento persistente. Fallos de
transporte no prueban ausencia de commit; esta Story no agrega idempotencia/CAS
al CRUD de identidad. Sin commit/push ni CI remota asumida.

## Plan y verificación

Aplicar interacción local de Pacientes con componentes existentes, mantener
cuerpos de comandos, probar reglas/errores y luego recorrer stack aislado con
datos sintéticos. Distinguir simulación, PostgreSQL real, navegador y revisión
visual; conservar evidencia de fallos. Done solo después de cumplir los gates.

## Implementación

- PatientForm/new/edit: etiquetas y ayudas españolas, reglas actuales con foco,
  catálogo/clientes con estados/relecturas explícitas, selección de fecha leída
  en es-PY y validez nativa incluso si value queda vacío. Contratos de cuerpos
  preservados: alta activa/principal, inactiva, diff, null y fecha calendario.
- patients-api: status/código seguro, sin texto privado, incertidumbre ante
  transporte/5xx/408/acuse inválido y sin retries; bloqueo de intento para
  401/403/404 e incierto. Acuse mínimo con ID, no validación completa del DTO.
- patient-form-interaction: guardia local de cancelación/enlaces/beforeunload,
  sin framework compartido, persistencia o interceptar historial.
- Detalle/responsables: no montar hijos hasta lectura de identidad exitosa,
  estados de lectura, label visible, formulario retenido/bloqueado al fallar,
  controles de desactivación conservados. Tokens semánticos y calendario oscuro.
- Sin endpoints, migraciones, permisos, dependencias o cambios clínicos nuevos.
  No se resuelve TD-011 ni se reclasifica el módulo completo como producción.

## Verificación

292 casos distintos aprobados entre las selecciones descritas en
[[UX-028-VALIDATION-2026-11-01]], sin sumar rechecks. Lint/tipos, builds
aislados/verificador y lane final NJvR8X 6/6 aprobados, sin retries. Cierre de
servidores final asistido y registrado en [[TD-069]], con salida0 y contenedores
propios retirados. Revisión visual final aprobada. Referencias de taxonomía se
conservan como datos, raíz HTML compartida/localización global siguen separadas
de este alcance.

Cierre: UX-028 done dentro del alcance de identidad. Evidencia y fallos
intermedios preservados en QA, sin CI remota o despliegue. No commit/push;
HEAD3292ffc y cambios locales previos conservados. Catálogo es la siguiente
etapa separada del roadmap.

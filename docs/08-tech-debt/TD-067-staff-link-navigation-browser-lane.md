---
id: TD-067
type: tech-debt
title: Intermittent staff Link navigation in the isolated browser lane
status: resolved
severity: medium
owner: engineering
related_stories: [UX-021, UX-024, UX-025]
created: 2026-10-30
updated: 2026-10-31
---

# TD-067 — Navegación staff intermitente en navegador

## Resolución de la recurrencia — UX-025, 2026-10-31

Contraste con contextos fríos reprodujo el fallo en la décima entrada: nueve
completadas, RSC 200 y root pending/suspended/warm=229376, pinged=0. Reutilizar
un contexto durante 50 documentos había pasado y no se tomó como reproducción
suficiente. Se retiró loading.tsx global bajo app/(app)/app: las páginas cliente
conservan carga/error propios y el shell RouteFeedback. La barrera global
redundante sostenía el camino de suspensión observado; no se parcheó Next/React
ni se relajó auth/CSP, prefetch o recuperación.

Dos lanes independientes desde cero, rXaXqy y PX3EwT: 26/26 cada una, retries=0.
Incluyen los 25 flujos clínicos y 50 contextos nuevos con login/enlaces/mismo
documento por ronda (100 total), más lectura de paciente retenida para comprobar
carga cliente. Se resuelve el bloqueo de UX-024 para esta matriz; no demuestra
ausencia universal en otros destinos, versiones o navegadores. Reabrir si
reaparece. [[UX-025-VALIDATION-2026-10-31]] conserva diagnóstico, contraste,
fuente primaria relacionada, fallos intermedios y límites. Lo que sigue es
histórico y no se borra por la resolución actual.

## Reapertura — 2026-10-31

UX-024, runner nuevo newsaas-ux021-browser-yBnaL9: 12 passed, 1 failed y 12 no
ejecutados. Falló open() antes de clínica en el caso de relectura de peso: clic
en el paciente mantuvo /app/patients durante 10 s. La marca de documento seguía
presente; no se comprobó una causa. Código de navegación sin cambios respecto a
la mitigación UX-021. No se añadieron retries ni se sustituyó el enlace por
navegación directa para ocultar el hallazgo.

Se reabre la investigación de reproducibilidad; una ronda verde posterior no
demostraría por sí sola la resolución definitiva. Los resultados históricos que
siguen describen la mitigación y evidencias anteriores, sin borrarlos.
Trace/captura en Temp son sintéticos (RESTRICTED/CONFIDENTIAL), no Git. La
corrección global del shell queda fuera de UX-024; su QA debe informar el
resultado final de la lane y el límite observado por separado.

UX-021 observó clics reales en el enlace Pacientes que dejaban la URL en /app,
aunque la traza registra peticiones RSC con respuesta 200. Se observó en Chrome
headless Windows, API/web compilados aislados, datos sintéticos y rol clínico
mínimo; escritorio y viewport móvil. Otros intentos sí navegaron correctamente.
No se concluye una causa ni incidencia productiva universal desde esta lane.

Se descartó la hipótesis de cierre prematuro del menú: cerrar solo al cambiar
pathname no eliminó el fallo y el experimento fue retirado íntegramente. Esperar
dashboard terminal/load/red inactiva tampoco lo eliminó; no se añadieron retries
que oculten el resultado. No modificar CSP, autorización o App Router mediante
suposiciones. La causa requiere una investigación separada del shell.

Evidencia sintética local: carpeta newsaas-ux021-browser-RgsYoW en Temp; logs
browser-run-1793390690902, -1793390958046, -1793391219897 y -1793391320758,
traces/screenshot de casos que fallaron antes de entrar a clínica. Los traces
pueden contener cookies sintéticas y son RESTRICTED; no se agregan a Git.

La lane clínica usa el returnTo de login existente hacia /app/patients para
validar clínica sin afirmar que certifica enlaces del dashboard/sidebar. No se
hizo cambio funcional al shell. TD-066 mantiene la frontera de navegación global
pendiente; UX-021 separa su evidencia clínica de este hallazgo.

## Revalidación desde cero

El runner completo nuevo (newsaas-ux021-browser-I3hHv8) terminó con 6 passed, 1
failed y 9 did not run: al seleccionar un paciente, la URL permaneció en
/app/patients en vez de abrir su ficha. También hay RSC 200 en la traza. Esto
amplía el hallazgo: no está limitado al menú ni al dashboard. El returnTo de
login reduce una dependencia de entrada, pero tampoco elimina el defecto.

La corrida focalizada previa sobre recursos sintéticos propios ya creados aprobó
16/16 en 40,2 s; no basta para afirmar reproducibilidad. Se conserva el fallo
como gate de revisión, con retries=0 y maxFailures=1. No se cambiaron Next.js,
CSP, permisos, enlaces ni contratos clínicos. El experimento de cierre de menú
fue retirado y Git no conserva ese parche. Próximo trabajo: diagnóstico
reproducible de Link/App Router sin suponer una causa por las respuestas 200.

## Resolución acotada — 2026-10-30

Diagnóstico GBDc8p reprodujo lista→ficha móvil (7 passed, 1 failed, 8 no
ejecutados). FiberRoot sintético temporal: pending/suspended/warm=14336,
pinged=0. Patrón compatible con
[Next #98305](https://github.com/vercel/next.js/issues/98305), sin atribuir
identidad de causa desde esa coincidencia. Runtime instalado 15.5.23; no se
actualizó ni parcheó. Instrumentación retirada.

Se reubicó el mismo loading.tsx de app/(app)/ a app/(app)/app/, dejando la
barrera de carga por debajo del layout staff asíncrono. Se preservan skeleton,
shell y documento, sin reload, CSP relajada, cambios de prefetch o menú. Los 16
casos entran ahora por login→Inicio→Pacientes→ficha, incluidos menú móvil y
marcador que detecta recarga. Dos runners independientes desde cero aprobaron
16/16 (36szkT y JCBU9a), retries=0/maxFailures=1, con contenedores retirados.
Por ello se resuelve el bloqueo observado para esta lane.

No es demostración estadística de ausencia universal ni certificación de otros
destinos/navegadores. Conservar esta evidencia y reabrir si reaparece; no se
declara necesaria ni se implementa una migración mayor de Next. Ver
[[UX-021-VALIDATION-2026-10-30]]. TD-066 mantiene sus pendientes independientes.

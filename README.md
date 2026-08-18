# Veterinary SaaS — OpenCode + Obsidian starter

Este paquete implementa el baseline **PRD v1.3 (MVP architecture frozen)** y
prepara el repositorio para trabajar con:

- OpenCode como agente de desarrollo.
- Git como fuente de verdad técnica.
- `docs/` como Obsidian Vault.
- Sistema de Branding/Theming reutilizable para cambiar look & feel entre
  productos y tenants sin forkar componentes.
- Markdown + YAML frontmatter para Epics, Stories, ADRs, decisiones, bugs y
  deuda técnica.
- Un PRD técnico versionado junto al código.

## Instalación

Copiar el contenido de este paquete a la raíz del repositorio.

Después:

```bash
cd /ruta/al/repositorio
opencode
```

No es necesario ejecutar `/init`: ya existe un `AGENTS.md` diseñado para el
proyecto. Si se ejecuta `/init` en el futuro, revisar cuidadosamente cualquier
modificación propuesta al archivo.

En Obsidian:

1. Elegir **Open folder as vault**.
2. Seleccionar la carpeta `docs/`.
3. No es necesario instalar plugins comunitarios para comenzar.
4. Los enlaces `[[...]]` funcionan como wiki links normales.

## Fuentes de verdad

Orden de autoridad:

1. Código + migraciones + tests para el comportamiento actualmente implementado.
2. `docs/00-product/PRD.md` para alcance y requisitos aprobados.
3. ADRs aceptados para decisiones arquitectónicas.
4. Stories para el detalle de implementación de cada unidad de trabajo.
5. Código existente cuando documenta comportamiento ya desplegado.

Una Story no puede cambiar el alcance del PRD por sí sola.

## Developer startup

1. Copy the example environment and adjust ports if needed:

   ```bash
   cp .env.example .env
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Start local PostgreSQL and Redis:

   ```bash
   pnpm services:up
   ```

4. Run the preflight check to verify services are reachable:

   ```bash
   pnpm preflight
   ```

5. Start the API, worker, and web apps (each in its own terminal):

   ```bash
   pnpm --filter @newsaas/api dev
   pnpm --filter @newsaas/worker dev
   pnpm --filter @newsaas/web dev
   ```

6. Open the web app at `http://localhost:3000`. The home page health indicator
   calls `/api/health/live`, which proxies to the API liveness endpoint.

7. Stop local services when done:

   ```bash
   pnpm services:down
   ```

## Inicio recomendado

La primera tarea de implementación es:

```text
/story-start EPIC-00
```

Para una story concreta:

```text
/story-start VET-001
```

Al terminar:

```text
/story-finish VET-001
```

Para verificar el repositorio:

```text
/verify
```

## Estructura

```text
AGENTS.md
opencode.json
.opencode/
  agents/
  commands/
docs/
  00-product/
  01-roadmap/
  02-stories/
  03-architecture/
    BRANDING-THEMING.md
  04-adrs/
  05-modules/
  06-fiscal/
  07-decisions/
  08-tech-debt/
  09-releases/
  10-qa/
  99-governance/
  _templates/
```

## Architecture freeze v1.3

The MVP architecture is considered ready to implement.

The repository now also defines:

- typed tenant settings;
- minimal internal post-commit events;
- reversal/correction semantics;
- data classification/retention baseline;
- deterministic demo tenant/seed;
- Complexity Budget requiring ADRs for major structural additions.

Start building instead of extending speculative architecture.

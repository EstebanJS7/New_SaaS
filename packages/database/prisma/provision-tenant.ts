import { parseArgs } from "node:util";
import { staffActivationUrl } from "@newsaas/shared";
import { PrismaClient } from "../src/generated/index.js";
import {
  DEFAULT_BRANCH_NAME,
  ProvisioningError,
  normalizeProvisionInput,
  provisionTenant,
  type ProvisionTenantInput,
  type ProvisioningClient,
} from "../src/tenant-provisioning.js";

/**
 * Operator command: creates a real clinic ([[ONB-001]]). See src/tenant-provisioning.ts.
 *
 * En el VPS:
 *   docker compose -f docker-compose.prod.yml --env-file env.production run --rm migrate \
 *     pnpm exec tsx prisma/provision-tenant.ts \
 *       --slug san-roque --name "Veterinaria San Roque" \
 *       --owner-email dueno@sanroque.com.py --owner-name "María Pérez"
 */

const USAGE = `Uso:
  provision-tenant --slug <slug> --name <nombre> --owner-email <email> --owner-name <nombre>
                   [--branch <nombre sucursal>] [--features a,b,c] [--web-url <https://app...>]

  --branch     Primera sucursal (por defecto "${DEFAULT_BRANCH_NAME}").
  --features   Funciones a habilitar, separadas por coma (por defecto, todas).
  --web-url    Origen de la aplicación para armar el enlace (por defecto WEB_APP_BASE_URL).`;

async function main(): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      options: {
        slug: { type: "string" },
        name: { type: "string" },
        "owner-email": { type: "string" },
        "owner-name": { type: "string" },
        branch: { type: "string" },
        features: { type: "string" },
        "web-url": { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 2;
  }

  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const required = ["slug", "name", "owner-email", "owner-name"] as const;
  const missing = required.filter((key) => typeof values[key] !== "string");
  if (missing.length > 0) {
    console.error(`Faltan: ${missing.map((key) => `--${key}`).join(", ")}`);
    console.error(USAGE);
    return 2;
  }

  const webUrl = (values["web-url"] as string | undefined) ?? process.env.WEB_APP_BASE_URL;
  const features =
    typeof values.features === "string"
      ? values.features
          .split(",")
          .map((code) => code.trim())
          .filter((code) => code.length > 0)
      : undefined;

  const input: ProvisionTenantInput = {
    slug: values.slug as string,
    name: values.name as string,
    ownerEmail: values["owner-email"] as string,
    ownerName: values["owner-name"] as string,
    branchName: values.branch as string | undefined,
    features,
  };
  // Operator mistakes are reported before any connection is opened.
  try {
    normalizeProvisionInput(input);
  } catch (error) {
    if (error instanceof ProvisioningError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  const db = new PrismaClient();
  try {
    const result = await provisionTenant(db as unknown as ProvisioningClient, input);

    console.log("Clínica creada.");
    console.log(`  tenant:      ${result.tenantId}`);
    console.log(`  sucursal:    ${result.branchId}`);
    console.log(`  funciones:   ${result.grantedFeatures.join(", ")}`);
    console.log(`  propietario: ${result.ownerProfileId} (membresía ${result.ownerMembershipId})`);
    if (result.activationToken === null) {
      console.log("El email del propietario ya tenía cuenta: puede ingresar con su contraseña.");
    } else {
      const link = webUrl
        ? staffActivationUrl(webUrl, result.activationToken)
        : `<WEB_APP_BASE_URL>/reset-password?token=${encodeURIComponent(result.activationToken)}&activate=1`;
      console.log("");
      console.log("Enlace de activación del propietario (un solo uso, vence el");
      console.log(`${result.activationExpiresAt?.toISOString()}). Enviáselo por un canal privado:`);
      console.log(`  ${link}`);
      console.log("");
      console.log(
        "Si vence, el propietario puede pedir uno nuevo desde «¿Olvidaste tu contraseña?»."
      );
    }
    return 0;
  } catch (error) {
    if (error instanceof ProvisioningError) {
      console.error(error.message);
      return 1;
    }
    // Name only: a driver error message can carry the connection string.
    console.error("No se pudo crear la clínica:", error instanceof Error ? error.name : error);
    return 1;
  } finally {
    await db.$disconnect().catch(() => undefined);
  }
}

// Only execute when invoked directly, like prisma/seed.ts.
const invokedDirectly = (process.argv[1] ?? "")
  .replaceAll("\\", "/")
  .endsWith("/prisma/provision-tenant.ts");
if (invokedDirectly) {
  process.exitCode = await main();
}

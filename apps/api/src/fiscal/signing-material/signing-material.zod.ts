import { z } from "zod";

export const signingMaterialEnvironmentSchema = z.enum(["TEST", "PRODUCTION"]);
export const retireSigningMaterialBodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export const signingMaterialIdParamSchema = z.object({ id: z.string().uuid() });

/** Fiscal policy cap, not a storage concern: PKCS#12 signing containers are limited to 64 KiB. */
export const SIGNING_MATERIAL_MAX_CONTAINER_BYTES = 65_536;

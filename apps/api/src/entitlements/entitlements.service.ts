import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
// Value import (not `import type`): the DI token must exist at runtime.
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";

/**
 * Feature-code shape mirrors the seeded catalog convention (PRD §10,
 * reference-seed FEATURE_CODE_PATTERN): single lowercase tokens with
 * underscores. Kept local so this boundary does not reach into the database
 * package's seed internals.
 */
const FEATURE_CODE_PATTERN = /^[a-z][a-z_]*$/;

const hasArgsSchema = z.tuple([z.string().uuid(), z.string().regex(FEATURE_CODE_PATTERN)]);

/** Structural delegate contract (generated client and test fakes alike). */
export interface TenantEntitlementDelegate {
  findFirst: (args: {
    where: {
      tenantId: string;
      featureCode: { code: string };
    };
  }) => Promise<{ id: string } | null>;
}

/**
 * Minimal entitlements boundary (design D8, spec: rbac-entitlements-seed /
 * Minimal entitlements boundary).
 *
 * `has(tenantId, featureCode)` is a DIRECT grant query: only explicit
 * `tenant_entitlement` rows grant access — plan/plan_capability mappings
 * never do (the starter plan maps all codes and grants nothing; override
 * precedence is therefore "explicit grant decides"). Unknown-but-well-formed
 * codes answer false WITHOUT throwing; malformed arguments are programmer
 * errors and fail loud as VALIDATION_FAILED.
 *
 * Deliberately NOT shipped here: no HTTP surface, no UI, no caching — future
 * gating callers (e.g. branding Phase B) consult this service instead of
 * comparing plans.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    // Explicit @Inject token keeps DI resolution token-based while the PARAM
    // TYPE stays the narrow read-only lookup contract the service needs.
    @Inject(PrismaService) private readonly prisma: { tenantEntitlement: TenantEntitlementDelegate }
  ) {}

  async has(tenantId: string, featureCode: string): Promise<boolean> {
    const parsed = hasArgsSchema.safeParse([tenantId, featureCode]);
    if (!parsed.success) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Entitlement check requires a tenant UUID and a valid feature code."
      );
    }

    const [scopedTenantId, code] = parsed.data;
    const grant = await this.prisma.tenantEntitlement.findFirst({
      where: { tenantId: scopedTenantId, featureCode: { code } },
    });
    return grant !== null;
  }
}

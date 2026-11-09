import { Body, Controller, Get, Inject, Injectable, Param, Put } from "@nestjs/common";
import { PrismaService, type Prisma } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { z } from "zod";
import { AuditWriter, type AuditAppendTx } from "../../audit/audit-writer.service.js";
import { RequestContextService } from "../../context/request-context.service.js";
import { EntitlementsService } from "../../entitlements/entitlements.service.js";
import { PermissionResolver } from "../../rbac/permission-resolver.service.js";
import { RequirePermissions } from "../../rbac/require-permissions.decorator.js";
import { FISCAL_PERMISSIONS } from "../fiscal.permissions.js";
import { FISCAL_FEATURE_NOT_ENTITLED_MESSAGE } from "../fiscal.service.js";

export const classificationBodySchema = z
  .object({
    affectation: z.enum(["GRAVADO_IVA", "EXONERADO", "EXENTO", "GRAVADO_PARCIAL"]),
    proportionality: z
      .string()
      .regex(/^(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,2})?$/)
      .refine((value) => Number(value) <= 100)
      .nullable(),
  })
  .strict()
  .refine(
    (input) => (input.affectation === "GRAVADO_PARCIAL") === (input.proportionality !== null)
  );
const rateParam = z.object({ rateCode: z.string().regex(/^[A-Z0-9_]{1,50}$/) }).strict();
type ClassificationInput = z.infer<typeof classificationBodySchema>;
export interface ClassificationResponse {
  rateCode: string;
  affectation: ClassificationInput["affectation"];
  proportionality: string | null;
}
export interface ClassificationList {
  items: ClassificationResponse[];
  rates: { code: string; rate: string }[];
}
type TaxTx = Pick<Prisma.TransactionClient, "tenantTaxClassification" | "taxRate"> & AuditAppendTx;
interface TaxClient {
  tenantTaxClassification: TaxTx["tenantTaxClassification"];
  taxRate: TaxTx["taxRate"];
  $transaction<T>(work: (tx: TaxTx) => Promise<T>): Promise<T>;
}
function project(row: {
  rateCode: string;
  affectation: ClassificationInput["affectation"];
  proportionality: { toFixed(n: number): string } | null;
}): ClassificationResponse {
  return {
    rateCode: row.rateCode,
    affectation: row.affectation,
    proportionality: row.proportionality?.toFixed(2) ?? null,
  };
}

@Injectable()
export class TaxClassificationService {
  constructor(
    @Inject(PrismaService) private readonly db: TaxClient,
    private readonly context: RequestContextService,
    private readonly audit: AuditWriter,
    private readonly entitlements: EntitlementsService,
    private readonly permissions: PermissionResolver
  ) {}

  async list(): Promise<ClassificationList> {
    await this.authorize();
    const [rows, rates] = await Promise.all([
      this.db.tenantTaxClassification.findMany({
        where: { tenantId: this.context.requireTenantId() },
        orderBy: { rateCode: "asc" },
      }),
      this.db.taxRate.findMany({ orderBy: { code: "asc" } }),
    ]);
    return {
      items: rows.map(project),
      rates: rates.map((rate) => ({ code: rate.code, rate: rate.rate.toString() })),
    };
  }

  async save(rateCode: string, input: ClassificationInput): Promise<ClassificationResponse> {
    await this.authorize();
    const tenantId = this.context.requireTenantId();
    const actorUserProfileId = this.context.requireUserProfileId();
    return this.db.$transaction(async (tx) => {
      const rate = await tx.taxRate.findUnique({ where: { code: rateCode } });
      if (!rate) throw new DomainError("NOT_FOUND", "Tax rate was not found.");
      const percentage = Number(rate.rate.toString());
      const taxed = input.affectation === "GRAVADO_IVA" || input.affectation === "GRAVADO_PARCIAL";
      if (taxed ? percentage !== 5 && percentage !== 10 : percentage !== 0) {
        throw new DomainError("VALIDATION_FAILED", "Tax treatment does not match the tax rate.");
      }
      const row = await tx.tenantTaxClassification.upsert({
        where: { tenantId_rateCode: { tenantId, rateCode } },
        create: { tenantId, rateCode, ...input },
        update: input,
      });
      const result = project(row);
      await this.audit.append(
        {
          tenantId,
          actorUserProfileId,
          action: "fiscal.tax_classification.saved",
          targetType: "tenant_tax_classification",
          targetId: row.id,
          metadata: { ...result },
        },
        tx
      );
      return result;
    });
  }

  private async authorize(): Promise<void> {
    if (!(await this.entitlements.has(this.context.requireTenantId(), "fiscal"))) {
      throw new DomainError("FEATURE_NOT_ENTITLED", FISCAL_FEATURE_NOT_ENTITLED_MESSAGE);
    }
    if (!(await this.permissions.resolveForActiveRequest()).has(FISCAL_PERMISSIONS.profileManage)) {
      throw new DomainError("FORBIDDEN", "The required fiscal permission is missing.");
    }
  }
}

@Controller("fiscal/tax-classifications")
export class TaxClassificationController {
  constructor(private readonly service: TaxClassificationService) {}
  @Get()
  @RequirePermissions(FISCAL_PERMISSIONS.profileManage)
  list(): Promise<ClassificationList> {
    return this.service.list();
  }
  @Put(":rateCode")
  @RequirePermissions(FISCAL_PERMISSIONS.profileManage)
  save(@Param() params: unknown, @Body() body: unknown): Promise<ClassificationResponse> {
    const parsedParam = rateParam.safeParse(params);
    const parsedBody = classificationBodySchema.safeParse(body);
    if (!parsedParam.success || !parsedBody.success)
      throw new DomainError("VALIDATION_FAILED", "Invalid tax classification request.");
    return this.service.save(parsedParam.data.rateCode, parsedBody.data);
  }
}

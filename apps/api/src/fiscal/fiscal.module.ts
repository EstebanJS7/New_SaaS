import { Module, type Provider } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { FISCAL_CREDENTIAL_PORT, FiscalProviderModule } from "@newsaas/fiscal";
import { createFiscalCredentialReader } from "@newsaas/fiscal-persistence";
import { SECRET_STORE, type SecretStore } from "@newsaas/secret-store";
import { FiscalController } from "./fiscal.controller.js";
import { FiscalAllocationService } from "./fiscal-allocation.service.js";
import { FiscalRepository } from "./fiscal.repository.js";
import { FiscalService } from "./fiscal.service.js";
import { FiscalSigningMaterialRepository } from "./signing-material/signing-material.repository.js";
import { SigningMaterialController } from "./signing-material/signing-material.controller.js";
import { SigningMaterialPipe } from "./signing-material/signing-material.pipe.js";
import { FiscalSigningMaterialService } from "./signing-material/signing-material.service.js";
import { FiscalProfileController } from "./timbrado/timbrado.controller.js";
import { FiscalProfileRepository } from "./timbrado/timbrado.repository.js";
import { FiscalProfileService } from "./timbrado/timbrado.service.js";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { EntitlementsModule } from "../entitlements/entitlements.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import {
  createBullMqFiscalSubmissionProducer,
  FISCAL_SUBMISSION_PRODUCER,
} from "./fiscal-submission.producer.js";

/**
 * FISC-015 WU-B — Billing reaches the allocation THROUGH THIS MODULE FILE, and
 * that is a decision rather than an accident.
 *
 * `fiscal-boundary.test.ts` pins the Billing↔Fiscal boundary to exactly two
 * specifiers (`fiscal.service.js` and `fiscal.module.js`) and it is right to:
 * a second import surface would turn a rule into a convention. So the module
 * that already owns the Fiscal providers re-exports the allocation's service and
 * its transaction-handle type, and Billing names them without reaching past the
 * boundary (DEC-056, and the same one-way direction DEC-051's cancellation
 * hand-off uses).
 */
export { FiscalAllocationService } from "./fiscal-allocation.service.js";
export type { FiscalAllocationTx } from "./fiscal-allocation.service.js";

/**
 * The API's real `FISCAL_CREDENTIAL_PORT`: the shared Prisma + SecretStore
 * reader over the API's own client, the same implementation the worker wires.
 *
 * ADR-008 §2 makes the credential a per-call read on a process-singleton
 * provider, so this factory constructs a reader and reads nothing itself: every
 * facade call reads the tenant's ACTIVE material and the result is **never
 * cached** across calls, tenants or rotations. The API owns the tenant's signing
 * material (the signing-material surface lives here) and is the provider
 * consumer on the DEC-051 `cancel` hand-off, so it needs the real port as soon
 * as `FISCAL_PROVIDER=sifen-direct` becomes selectable.
 */
const credentialPort: Provider = {
  provide: FISCAL_CREDENTIAL_PORT,
  useFactory: (prisma: PrismaService, secretStore: SecretStore) =>
    createFiscalCredentialReader({ client: prisma, secretStore }),
  inject: [PrismaService, SECRET_STORE],
};

/**
 * The concrete implementation is created only in the shared Fiscal provider
 * module; this remains the API-side composition root for API-owned providers
 * and the fiscal submission producer. FISC-012 WU-E2 wires the real credential
 * port, so `FISCAL_PROVIDER=sifen-direct` resolves here too and not only in the
 * worker. Billing consumes this application service as its one-way read seam
 * for the DEC-051 cancellation hand-off.
 *
 * FISC-015 WU-B exports {@link FiscalAllocationService} for the same one-way
 * reason: Billing's confirmation transaction allocates its fiscal number
 * through this boundary (DEC-056) and never imports a fiscal table or client.
 */
@Module({
  imports: [
    FiscalProviderModule.forRoot({ credentialPort }),
    ContextModule,
    RbacModule,
    AuditModule,
    EntitlementsModule,
  ],
  controllers: [FiscalController, SigningMaterialController, FiscalProfileController],
  exports: [
    FiscalService,
    FiscalSigningMaterialService,
    FiscalProfileService,
    FiscalAllocationService,
  ],
  providers: [
    FiscalRepository,
    FiscalService,
    FiscalAllocationService,
    FiscalSigningMaterialRepository,
    FiscalSigningMaterialService,
    SigningMaterialPipe,
    FiscalProfileRepository,
    FiscalProfileService,
    {
      provide: FISCAL_SUBMISSION_PRODUCER,
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
          throw new Error("REDIS_URL is required to enqueue fiscal submissions.");
        }
        return createBullMqFiscalSubmissionProducer(redisUrl);
      },
    },
  ],
})
export class FiscalModule {}

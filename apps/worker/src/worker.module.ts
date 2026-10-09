import { Module, type Provider } from "@nestjs/common";
import { PrismaModule, PrismaService } from "@newsaas/database";
import { FISCAL_CREDENTIAL_PORT, FiscalProviderModule } from "@newsaas/fiscal";
import { createFiscalCredentialReader } from "@newsaas/fiscal-persistence";
import { SECRET_STORE, type SecretStore } from "@newsaas/secret-store";
import { StorageModule } from "@newsaas/storage";
import { BrandingResetCleanupConsumer } from "./branding-reset-cleanup/cleanup.consumer.js";
import { BrandingResetCleanupHandler } from "./branding-reset-cleanup/cleanup.handler.js";
import { BrandingResetCleanupReconciliationService } from "./branding-reset-cleanup/reconciliation.service.js";
import { RedisHealthService } from "./redis/redis-health.service.js";
import { FiscalSubmissionConsumer } from "./fiscal-submission/fiscal-submission.consumer.js";
import { FiscalSubmissionHandler } from "./fiscal-submission/fiscal-submission.handler.js";
import { FiscalSubmissionRecoveryService } from "./fiscal-submission/fiscal-recovery.service.js";
import { SecretsModule } from "./secret-store/secrets.js";

/**
 * The worker's real `FISCAL_CREDENTIAL_PORT`: WU-B's Prisma + SecretStore reader
 * over the application's own Prisma client.
 *
 * ADR-008 §2 makes the credential a per-call read on a process-singleton
 * provider, so the composition root supplies the port — never a cached
 * certificate. With this provider wired, the fail-closed null port
 * `FiscalProviderModule.forRoot()` declares by default is no longer what runs.
 */
const credentialPort: Provider = {
  provide: FISCAL_CREDENTIAL_PORT,
  useFactory: (prisma: PrismaService, secretStore: SecretStore) =>
    createFiscalCredentialReader({ client: prisma, secretStore }),
  inject: [PrismaService, SECRET_STORE],
};

/**
 * Worker deployable module.
 *
 * Composes the durable branding-reset cleanup pipeline (consumer + interval
 * reconciliation) on top of the shared Prisma and object-storage boundaries.
 * PrismaModule is `@Global`; StorageModule.forRoot() exports the abstract
 * StoragePort the handler deletes through.
 *
 * FISC-012 WU-D1 wires the fiscal credential. `SecretsModule.forRoot()` is the
 * worker's own composition root because `packages/secret-store` deliberately
 * ships no Nest module (ADR-005/D1, DEC-053/D7) — the record client is the
 * application's own Prisma client. `FiscalProviderModule.forRoot` receives the
 * reader, so the fail-closed null port is no longer what runs.
 */
@Module({
  imports: [
    PrismaModule,
    SecretsModule.forRoot(),
    StorageModule.forRoot(),
    FiscalProviderModule.forRoot({ credentialPort }),
  ],
  providers: [
    RedisHealthService,
    BrandingResetCleanupHandler,
    BrandingResetCleanupConsumer,
    BrandingResetCleanupReconciliationService,
    FiscalSubmissionHandler,
    FiscalSubmissionConsumer,
    FiscalSubmissionRecoveryService,
  ],
})
export class WorkerModule {}

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
import {
  createUnavailableFiscalDocumentBuilder,
  FISCAL_DOCUMENT_BUILDER,
} from "./fiscal-submission/fiscal-document-builder.js";
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
 * The stage's document seam (DEC-056).
 *
 * The default is the fail-closed builder: it answers `UNAVAILABLE` with a named
 * reason, so a deployment without the assembly refuses the document instead of
 * submitting something invented. FISC-015 replaces this provider with the real
 * assembly; the stage does not change. A value rather than a factory because the
 * default is stateless.
 */
const documentBuilderProvider: Provider = {
  provide: FISCAL_DOCUMENT_BUILDER,
  useValue: createUnavailableFiscalDocumentBuilder(),
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
 * reader, so the fail-closed null port is no longer what runs. WU-D2 adds the
 * stage's document seam, whose default also fails closed until FISC-015.
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
    documentBuilderProvider,
    FiscalSubmissionHandler,
    FiscalSubmissionConsumer,
    FiscalSubmissionRecoveryService,
  ],
})
export class WorkerModule {}

import { Module, type Provider } from "@nestjs/common";
import { PrismaModule, PrismaService } from "@newsaas/database";
import {
  FISCAL_CREDENTIAL_PORT,
  FiscalProviderModule,
  type FiscalCredentialPort,
  type FiscalSigningEnvironment,
} from "@newsaas/fiscal";
import {
  createFiscalCredentialReader,
  createFiscalCscReader,
  type FiscalCscPort,
} from "@newsaas/fiscal-persistence";
import { SECRET_STORE, type SecretStore } from "@newsaas/secret-store";
import { StorageModule } from "@newsaas/storage";
import { BrandingResetCleanupConsumer } from "./branding-reset-cleanup/cleanup.consumer.js";
import { BrandingResetCleanupHandler } from "./branding-reset-cleanup/cleanup.handler.js";
import { BrandingResetCleanupReconciliationService } from "./branding-reset-cleanup/reconciliation.service.js";
import { RedisHealthService } from "./redis/redis-health.service.js";
import {
  createFiscalDocumentAssembly,
  FISCAL_CSC_PORT,
} from "./fiscal-submission/fiscal-document-assembly.js";
import { FISCAL_DOCUMENT_BUILDER } from "./fiscal-submission/fiscal-document-builder.js";
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
 * The CSC read the assembly hashes into the QR (FISC-015 WU-C).
 *
 * It is the credential port's shape one capability over: the tenant's ACTIVE
 * code for this environment, with the value sealed in the secret store and only
 * `IdCSC` printable. The token is declared beside its only consumer, because
 * `packages/fiscal` owns no CSC boundary.
 */
const cscPortProvider: Provider = {
  provide: FISCAL_CSC_PORT,
  useFactory: (prisma: PrismaService, secretStore: SecretStore) =>
    createFiscalCscReader({ client: prisma, secretStore }),
  inject: [PrismaService, SECRET_STORE],
};

/**
 * The DNIT environment this deployment talks to, as the assembly's own argument.
 *
 * `FiscalProviderModule` resolves `SIFEN_ENVIRONMENT` internally with the
 * package's `resolveSifenEnvironment`, which is not part of its public barrel,
 * so this is the deployment's own reading of the same input. The closed set is
 * the worker's env schema (`worker-env.schema.ts`), which validates at boot in
 * `main.ts` — including the production rule that an absent value is refused, so
 * a booted production worker cannot reach the `TEST` default below.
 */
function resolveWorkerSifenEnvironment(): FiscalSigningEnvironment {
  const raw = process.env.SIFEN_ENVIRONMENT;
  if (raw === undefined) return "TEST";
  if (raw === "TEST" || raw === "PRODUCTION") return raw;
  throw new Error("SIFEN_ENVIRONMENT must be one of: TEST, PRODUCTION.");
}

/**
 * The stage's document seam (DEC-056), now the real assembly (FISC-015 WU-D2).
 *
 * `fiscal-document-builder.ts` still declares the fail-closed default, and it is
 * still what a deployment that wires nothing would get; this worker wires the
 * assembly, which reads the tenant's own rows through the Prisma client and the
 * credential and CSC ports above. The stage does not change: it receives a
 * `BUILT` document or an `UNAVAILABLE` reason with a stable code.
 */
const documentBuilderProvider: Provider = {
  provide: FISCAL_DOCUMENT_BUILDER,
  useFactory: (
    prisma: PrismaService,
    credentialPort: FiscalCredentialPort,
    cscPort: FiscalCscPort
  ) =>
    createFiscalDocumentAssembly({
      client: prisma,
      credentialPort,
      cscPort,
      environment: resolveWorkerSifenEnvironment(),
    }),
  inject: [PrismaService, FISCAL_CREDENTIAL_PORT, FISCAL_CSC_PORT],
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
 * reader, so the fail-closed null port is no longer what runs. FISC-012 WU-D2
 * added the stage's document seam, which failed closed until FISC-015 WU-D2
 * wired the real assembly here, over the same client, the credential port and
 * the CSC port.
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
    cscPortProvider,
    documentBuilderProvider,
    FiscalSubmissionHandler,
    FiscalSubmissionConsumer,
    FiscalSubmissionRecoveryService,
  ],
})
export class WorkerModule {}

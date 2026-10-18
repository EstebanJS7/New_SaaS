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
import {
  createBullMqNotificationDeliveryProducer,
  NOTIFICATION_DELIVERY_PRODUCER,
  NotificationChannelsModule,
  NOTIFICATION_ENTITLEMENT,
  NOTIFICATION_RECIPIENT,
  type NotificationEntitlementPort,
  type NotificationRecipientPort,
} from "@newsaas/notifications";
import { SECRET_STORE, type SecretStore } from "@newsaas/secret-store";
import { StorageModule } from "@newsaas/storage";
import { BrandingResetCleanupConsumer } from "./branding-reset-cleanup/cleanup.consumer.js";
import { BrandingResetCleanupHandler } from "./branding-reset-cleanup/cleanup.handler.js";
import { BrandingResetCleanupReconciliationService } from "./branding-reset-cleanup/reconciliation.service.js";
import { NOTIFICATION_CONTENT_BUILDER } from "./notification-delivery/notification-content.js";
import { createNotificationContentBuilder } from "./notification-delivery/notification-content.builder.js";
import { DEFAULT_STAFF_APP_BASE_URL } from "./config/worker-env.schema.js";
import { NotificationDeliveryConsumer } from "./notification-delivery/notification-delivery.consumer.js";
import { NotificationDeliveryHandler } from "./notification-delivery/notification-delivery.handler.js";
import { NotificationFiscalNoticeScheduler } from "./notification-delivery/notification-fiscal-notice.scheduler.js";
import {
  FISCAL_APPROVAL_EMITTER,
  FiscalApprovalEmitter,
} from "./fiscal-submission/fiscal-approval.emitter.js";
import { createNotificationEntitlementReader } from "./notification-delivery/notification-entitlement.read.js";
import { createNotificationRecipientReader } from "./notification-delivery/notification-recipient.read.js";
import { ApplicationEventsModule } from "./events/application-events.module.js";
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
/**
 * The recipient reader (NOTIF-002): the delivery's stored reference resolved to
 * a RESTRICTED contact datum at send time.
 *
 * The value never reaches a log, a job payload or the delivery record; this
 * reader's only consumer is the handler's single call frame.
 */
const recipientReaderProvider: Provider = {
  provide: NOTIFICATION_RECIPIENT,
  useFactory: (prisma: PrismaService): NotificationRecipientPort =>
    createNotificationRecipientReader({ client: prisma }),
  inject: [PrismaService],
};

/**
 * The entitlement reader (NOTIF-002): [[DEC-058]]'s per-channel gate.
 *
 * The API's `EntitlementsService` cannot serve the worker, and wiring none keeps
 * the fail-closed deny-all default rather than opening the gate.
 */
const entitlementReaderProvider: Provider = {
  provide: NOTIFICATION_ENTITLEMENT,
  useFactory: (prisma: PrismaService): NotificationEntitlementPort =>
    createNotificationEntitlementReader({ client: prisma }),
  inject: [PrismaService],
};

/**
 * The queue producer, and the WORKER needs one now: it enqueues the fiscal notice
 * whose event it publishes. The transport comes from `@newsaas/notifications`
 * because there is ONE queue produced by two deployables, so one implementation of
 * its transport is the honest shape (the fiscal precedent differs: there the API
 * produces and the worker consumes).
 */
const notificationProducerProvider: Provider = {
  provide: NOTIFICATION_DELIVERY_PRODUCER,
  useFactory: () => {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL is not set");
    return createBullMqNotificationDeliveryProducer(redisUrl);
  },
};

/**
 * The shared approval emitter (DEC-059). ONE provider both APPROVED paths inject,
 * so the submission handler and the reconciliation sweep cannot drift on whether
 * they publish.
 */
const fiscalApprovalEmitterProvider: Provider = {
  provide: FISCAL_APPROVAL_EMITTER,
  useClass: FiscalApprovalEmitter,
};

/**
 * The REAL content builder (NOTIF-003 WU-D3): it reads the delivery's source and
 * renders the message at send time, and its read is also the SEND-TIME GATE —
 * a cancelled appointment or a non-approved document produces no message, whether
 * or not the event that scheduled it ever arrived (DEC-060).
 *
 * The seam it replaces failed closed, and it stays importable: it is what a
 * deployment that wires nothing, or a test that wants a refusal, still gets.
 */
const contentBuilderProvider: Provider = {
  provide: NOTIFICATION_CONTENT_BUILDER,
  useFactory: (prisma: PrismaService) =>
    createNotificationContentBuilder({
      client: prisma,
      // A deployment input (DAT-007): the link a recovery message carries must point at
      // THIS deployment's app, or a live token is handed to whoever owns the host it
      // does point at. The schema REFUSES to boot in production without it, so this
      // fallback exists for development and tests only.
      staffAppBaseUrl: process.env.STAFF_APP_BASE_URL ?? DEFAULT_STAFF_APP_BASE_URL,
    }),
  inject: [PrismaService],
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
 *
 * NOTIF-002 wires the notification delivery path: the channel selection, the
 * recipient and entitlement readers over the same Prisma client, the content
 * seam (still failing closed until NOTIF-003), the handler and its consumer.
 */
@Module({
  imports: [
    PrismaModule,
    ApplicationEventsModule,
    SecretsModule.forRoot(),
    StorageModule.forRoot(),
    FiscalProviderModule.forRoot({ credentialPort }),
    NotificationChannelsModule.forRoot(),
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
    recipientReaderProvider,
    entitlementReaderProvider,
    contentBuilderProvider,
    notificationProducerProvider,
    fiscalApprovalEmitterProvider,
    NotificationDeliveryHandler,
    NotificationDeliveryConsumer,
    NotificationFiscalNoticeScheduler,
  ],
})
export class WorkerModule {}

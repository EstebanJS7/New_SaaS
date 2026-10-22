import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { DestinationStream } from "pino";
import type { Type } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { AUTH_CONFIG, readAuthConfig, type AuthConfig } from "../../src/auth/auth.config.js";
import { createApiLogger } from "../../src/common/http/api-logger.factory.js";
import { createFastifyAdapter } from "../../src/common/http/fastify-adapter.factory.js";
import { STORAGE_PORT } from "@newsaas/storage";
import {
  BRANDING_RESET_CLEANUP_PRODUCER,
  type CleanupProducer,
} from "../../src/branding/branding-reset-cleanup.producer.js";
import {
  FISCAL_SUBMISSION_PRODUCER,
  type FiscalSubmissionProducer,
} from "../../src/fiscal/fiscal-submission.producer.js";
// PRODUCTION composition: booting AppModule (not a hand-picked module subset)
// means the isolation suites exercise the exact guard chain that ships —
// AuthGuard and TenantActiveGuard in their real registration order.
import { AppModule } from "../../src/app.module.js";
import {
  createFakeFiscalProvider,
  FISCAL_PROVIDER,
  type FiscalCancelOutcome,
  type FiscalCancelRequest,
  type FiscalIssueOutcome,
  type FiscalIssueRequest,
  type FiscalProviderPort,
  type FiscalRangeVoidRequest,
} from "@newsaas/fiscal";
import type { FiscalSubmissionJob } from "@newsaas/fiscal";
// The port and its transport live in the PACKAGE: ONE queue, produced by two
// deployables, so one implementation of its transport is the honest shape (the
// fiscal precedent differs because there the API produces and the worker consumes,
// while here the worker produces the fiscal notice into the same queue).
import {
  NOTIFICATION_DELIVERY_PRODUCER,
  type NotificationDeliveryJob,
  type NotificationDeliveryProducer,
} from "@newsaas/notifications";
import { IMPORT_PREVIEW_PRODUCER, type ImportPreviewProducer } from "@newsaas/imports";
import { createIsolationDatabase, type IsolationDatabase } from "./in-memory-database.js";

/** Test double that records enqueued intent ids instead of touching Redis. */
export interface RecordingCleanupProducer extends CleanupProducer {
  readonly enqueued: string[];
}

/**
 * Test double that records fiscal submission jobs instead of touching Redis.
 *
 * `FiscalModule`'s producer factory requires `REDIS_URL`, so without this
 * override every suite that boots `AppModule` would fail to compile — the same
 * reason the branding producer above is overridden.
 */
export interface RecordingFiscalSubmissionProducer extends FiscalSubmissionProducer {
  readonly enqueued: FiscalSubmissionJob[];
}

/**
 * The notification delivery producer this harness substitutes (EPIC-17).
 *
 * Overridden for the same reason as the fiscal producer above: the real one
 * reads `REDIS_URL` at construction, and a suite that asserts HTTP behaviour must
 * not require a queue. It records both operations so a test can assert that a
 * cancellation REMOVED the pending job and not merely that a row changed.
 */
export interface RecordingNotificationDeliveryProducer extends NotificationDeliveryProducer {
  readonly enqueued: { job: NotificationDeliveryJob; scheduledAt: Date }[];
  readonly cancelled: string[];
}

/**
 * The import preview producer this harness substitutes (EPIC-19 IMP-002).
 *
 * Overridden for the same reason as the three above: the real one reads
 * `REDIS_URL` at construction and throws without it, so a suite that asserts HTTP
 * behaviour must not require a queue. Recording the enqueued import ids is what
 * lets a test prove the trigger queued the work and — just as important — that a
 * refusal queued nothing.
 */
export interface RecordingImportPreviewProducer extends ImportPreviewProducer {
  readonly enqueued: string[];
  /** The commit jobs the harness recorded ([[IMP-003]]), by import id. */
  readonly enqueuedCommits: string[];
}

export interface ScriptableFiscalProvider extends FiscalProviderPort {
  /** Replaces the ordered cancel script; the last element repeats for later calls. */
  scriptCancel(outcomes: readonly FiscalCancelOutcome[]): void;
  /** Replaces the ordered issue script; the last element repeats for later calls. */
  scriptIssue(outcomes: readonly FiscalIssueOutcome[]): void;
  readonly cancelRequests: FiscalCancelRequest[];
  readonly issueRequests: FiscalIssueRequest[];
  /**
   * The range voids this double was asked for (FISC-016 WU-D).
   *
   * No `scriptVoidRange` hook accompanies it for the reason the query hook is
   * absent too: no API-level test drives the void here — its refusals are the
   * service's and its record is the live-PostgreSQL suite's — so a script
   * nothing drives would be a surface to re-review the day its first caller
   * lands. The forwarder exists because the port declares the capability.
   */
  readonly voidRangeRequests: FiscalRangeVoidRequest[];
}

export interface BootedTestApp {
  app: NestFastifyApplication;
  db: IsolationDatabase;
  /** Records reset-cleanup enqueues so tests can assert `jobId=intentId`. */
  cleanupProducer: RecordingCleanupProducer;
  /** Records fiscal submission jobs so tests can assert one enqueue per issue. */
  fiscalSubmissionProducer: RecordingFiscalSubmissionProducer;
  /** Records notification enqueues and removals (EPIC-17 NOTIF-003). */
  notificationDeliveryProducer: RecordingNotificationDeliveryProducer;
  /** Records import preview enqueues (EPIC-19 IMP-002). */
  importPreviewProducer: RecordingImportPreviewProducer;
  fiscalProvider: ScriptableFiscalProvider;
  /** Serialized pino lines captured during the test (leak scans, debugging). */
  logLines: () => string[];
  close: () => Promise<void>;
}

export interface BootTestAppOptions {
  /** Fresh in-memory boundary by default; pass one to share state across boots. */
  db?: IsolationDatabase;
  /**
   * Plain-HTTP opt-out for supertest (default false). Secure-by-default posture
   * itself is proven in auth.config.test.ts / auth.integration.test.ts.
   */
  cookieSecure?: boolean;
  /**
   * Extra controllers composed INTO AppModule (EPIC-02 route-contract probe):
   * lets a suite register a synthetic undeclared route against the REAL guard
   * chain without a second module graph.
   */
  extraControllers?: Type<unknown>[];
}

/**
 * Boots the REAL application module over the REAL Fastify adapter factory
 * against an isolated database boundary — the reusable entrypoint for
 * API-level isolation tests (design D5). Every suite gets its own app + data
 * store; `close()` releases the HTTP server and DI container.
 */
export async function bootTestApp(options: BootTestAppOptions = {}): Promise<BootedTestApp> {
  const db = options.db ?? createIsolationDatabase();

  const cleanupProducer: RecordingCleanupProducer = {
    enqueued: [],
    enqueue: (intentId: string) => {
      cleanupProducer.enqueued.push(intentId);
      return Promise.resolve();
    },
  };

  const fiscalSubmissionProducer: RecordingFiscalSubmissionProducer = {
    enqueued: [],
    enqueue: (document) => {
      fiscalSubmissionProducer.enqueued.push(document);
      return Promise.resolve();
    },
  };

  const importPreviewProducer: RecordingImportPreviewProducer = {
    enqueued: [],
    enqueuedCommits: [],
    // Explicit parameter type for the same reason the double above needs one: the
    // initializer references itself and would otherwise lose the contextual type.
    enqueue: (job: { readonly importJobId: string }) => {
      importPreviewProducer.enqueued.push(job.importJobId);
      return Promise.resolve();
    },
    // ONE producer, ONE queue, two job names: the commit is enqueued through the
    // same port the preview uses.
    enqueueCommit: (job: { readonly importJobId: string }) => {
      importPreviewProducer.enqueuedCommits.push(job.importJobId);
      return Promise.resolve();
    },
  };

  const notificationDeliveryProducer: RecordingNotificationDeliveryProducer = {
    enqueued: [],
    cancelled: [],
    // The parameters are typed explicitly because the object references ITSELF
    // below, and a self-referencing initializer drops the contextual type.
    enqueue: (job: NotificationDeliveryJob, scheduledAt: Date) => {
      notificationDeliveryProducer.enqueued.push({ job, scheduledAt });
      return Promise.resolve();
    },
    cancel: (notificationDeliveryId: string) => {
      notificationDeliveryProducer.cancelled.push(notificationDeliveryId);
      return Promise.resolve();
    },
  };

  const cancelRequests: FiscalCancelRequest[] = [];
  const issueRequests: FiscalIssueRequest[] = [];
  const voidRangeRequests: FiscalRangeVoidRequest[] = [];
  let fakeProvider = createFakeFiscalProvider();
  const fiscalProvider: ScriptableFiscalProvider = {
    provider: "FAKE",
    requiresSignedDocument: false,
    cancelRequests,
    issueRequests,
    voidRangeRequests,
    scriptCancel: (outcomes) => {
      fakeProvider = createFakeFiscalProvider({ cancelOutcomes: outcomes });
    },
    scriptIssue: (outcomes) => {
      fakeProvider = createFakeFiscalProvider({ outcomes });
    },
    cancel: (request) => {
      cancelRequests.push(request);
      return fakeProvider.cancel(request);
    },
    issue: (request) => {
      issueRequests.push(request);
      return fakeProvider.issue(request);
    },
    // FISC-010 WU-D: the port gained a third capability, so this double must
    // forward it. No API test exercises a query yet — the reconciliation path
    // that consumes it is the worker's (FISC-012) — and it is deliberately not
    // given a `scriptQuery` hook here: a script nothing drives is a surface that
    // would only have to be re-reviewed when its first caller lands.
    query: (request) => fakeProvider.query(request),
    // FISC-016 WU-D: the port gained the void capability, so this double
    // forwards it exactly as it forwards the query above.
    voidRange: (request) => {
      voidRangeRequests.push(request);
      return fakeProvider.voidRange(request);
    },
  };

  const captured: string[] = [];
  const stream: DestinationStream = {
    write(message: string): void {
      captured.push(message);
    },
  };
  const logger = createApiLogger({ stream, level: "info" });

  const authConfig: AuthConfig = {
    ...readAuthConfig(process.env),
    cookieSecure: options.cookieSecure ?? false,
  };

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.extraControllers ?? [],
  })
    .overrideProvider(PrismaService)
    .useValue(db.prisma as unknown as PrismaService)
    .overrideProvider(AUTH_CONFIG)
    .useValue(authConfig)
    .overrideProvider(STORAGE_PORT)
    .useValue(db.storage)
    .overrideProvider(BRANDING_RESET_CLEANUP_PRODUCER)
    .useValue(cleanupProducer)
    .overrideProvider(FISCAL_SUBMISSION_PRODUCER)
    .useValue(fiscalSubmissionProducer)
    .overrideProvider(NOTIFICATION_DELIVERY_PRODUCER)
    .useValue(notificationDeliveryProducer)
    .overrideProvider(IMPORT_PREVIEW_PRODUCER)
    .useValue(importPreviewProducer)
    .overrideProvider(FISCAL_PROVIDER)
    .useValue(fiscalProvider)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter({ loggerInstance: logger })
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    db,
    cleanupProducer,
    fiscalSubmissionProducer,
    importPreviewProducer,
    notificationDeliveryProducer,
    fiscalProvider,
    logLines: (): string[] => captured,
    close: (): Promise<void> => app.close(),
  };
}

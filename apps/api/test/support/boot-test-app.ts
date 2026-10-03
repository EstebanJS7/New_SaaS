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
} from "@newsaas/fiscal";
import type { FiscalSubmissionJob } from "@newsaas/fiscal";
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

export interface ScriptableFiscalProvider extends FiscalProviderPort {
  /** Replaces the ordered cancel script; the last element repeats for later calls. */
  scriptCancel(outcomes: readonly FiscalCancelOutcome[]): void;
  /** Replaces the ordered issue script; the last element repeats for later calls. */
  scriptIssue(outcomes: readonly FiscalIssueOutcome[]): void;
  readonly cancelRequests: FiscalCancelRequest[];
  readonly issueRequests: FiscalIssueRequest[];
}

export interface BootedTestApp {
  app: NestFastifyApplication;
  db: IsolationDatabase;
  /** Records reset-cleanup enqueues so tests can assert `jobId=intentId`. */
  cleanupProducer: RecordingCleanupProducer;
  /** Records fiscal submission jobs so tests can assert one enqueue per issue. */
  fiscalSubmissionProducer: RecordingFiscalSubmissionProducer;
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

  const cancelRequests: FiscalCancelRequest[] = [];
  const issueRequests: FiscalIssueRequest[] = [];
  let fakeProvider = createFakeFiscalProvider();
  const fiscalProvider: ScriptableFiscalProvider = {
    provider: "FAKE",
    cancelRequests,
    issueRequests,
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
    fiscalProvider,
    logLines: (): string[] => captured,
    close: (): Promise<void> => app.close(),
  };
}

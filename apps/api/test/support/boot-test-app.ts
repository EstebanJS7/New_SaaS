import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { DestinationStream } from "pino";
import type { Type } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { AUTH_CONFIG, readAuthConfig, type AuthConfig } from "../../src/auth/auth.config.js";
import { createApiLogger } from "../../src/common/http/api-logger.factory.js";
import { createFastifyAdapter } from "../../src/common/http/fastify-adapter.factory.js";
// PRODUCTION composition: booting AppModule (not a hand-picked module subset)
// means the isolation suites exercise the exact guard chain that ships —
// AuthGuard and TenantActiveGuard in their real registration order.
import { AppModule } from "../../src/app.module.js";
import { createIsolationDatabase, type IsolationDatabase } from "./in-memory-database.js";

export interface BootedTestApp {
  app: NestFastifyApplication;
  db: IsolationDatabase;
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
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter({ loggerInstance: logger })
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    db,
    logLines: (): string[] => captured,
    close: (): Promise<void> => app.close(),
  };
}

import { NestFactory } from "@nestjs/core";
import { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { createApiLogger, type ApiLogger } from "./common/http/api-logger.factory.js";
import { createFastifyAdapter } from "./common/http/fastify-adapter.factory.js";
import { toLoggableError } from "./common/errors/loggable-error.js";
import { apiEnv } from "./config/api-env.js";
async function bootstrap(logger: ApiLogger): Promise<void> {
  const envResult = apiEnv(process.env);
  if (!envResult.success) {
    // The parser's failure payload is a formatted string naming every
    // offending variable — surfaced verbatim on stderr for operators.
    logger.fatal({ missing: [...envResult.missing] }, envResult.error);
    process.exit(1);
  }

  // Single adapter construction point: request-id generation/echo, CORS
  // allowlist and security-header baseline.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter({
      loggerInstance: logger,
      corsAllowedOrigins: envResult.env.API_CORS_ALLOWED_ORIGINS,
      // HSTS only when the transport is HTTPS-grade (same posture that makes
      // session cookies Secure outside development).
      hstsEnabled: envResult.env.NODE_ENV !== "development",
    }),
    // Nest's console-based default logger is replaced by pino entirely.
    { logger: false }
  );

  // Without this, NestJS never fires onApplicationShutdown — PrismaService
  // would keep its pool open on SIGTERM/SIGINT (spec: graceful disconnect).
  app.enableShutdownHooks();

  const host = envResult.env.API_HOST;
  const port = envResult.env.API_PORT;

  await app.listen(port, host);
  logger.info({ host, port }, "API listening");
}

const rootLogger = createApiLogger();

bootstrap(rootLogger).catch((error: unknown) => {
  rootLogger.fatal({ err: toLoggableError(error) }, "Failed to start API");
  process.exit(1);
});

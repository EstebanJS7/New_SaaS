import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { apiEnv } from "./config/api-env.js";

async function bootstrap(): Promise<void> {
  const envResult = apiEnv(process.env);
  if (!envResult.success) {
    console.error(envResult.error);
    process.exit(1);
  }

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  // Without this, NestJS never fires onApplicationShutdown — PrismaService
  // would keep its pool open on SIGTERM/SIGINT (spec: graceful disconnect).
  app.enableShutdownHooks();

  const host = envResult.env.API_HOST;
  const port = envResult.env.API_PORT;

  await app.listen(port, host);
  console.info(`API listening on http://${host}:${port}`);
}

bootstrap().catch((error: unknown) => {
  console.error("Failed to start API", error);
  process.exit(1);
});

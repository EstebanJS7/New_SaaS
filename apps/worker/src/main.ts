import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./worker.module.js";
import { workerEnv } from "./config/worker-env.js";
import { RedisHealthService } from "./redis/redis-health.service.js";

async function bootstrap(): Promise<void> {
  const envResult = workerEnv(process.env);
  if (!envResult.success) {
    console.error(envResult.error);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();

  const redisHealth = app.get(RedisHealthService);

  await redisHealth.ping();
  console.info("Worker connected to Redis");

  // Keep the worker alive after the probe. The open Redis connection is the
  // primary lifecycle handle; this promise keeps the process running until a
  // shutdown signal is received, at which point NestJS closes gracefully.
  await new Promise<void>((resolve) => {
    let closing = false;

    const shutdown = (): void => {
      if (closing) return;
      closing = true;
      process.off("SIGTERM", shutdown);
      process.off("SIGINT", shutdown);
      void app.close().then(() => resolve());
    };

    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  });
}

bootstrap().catch((error: unknown) => {
  console.error("Failed to start worker", error);
  process.exit(1);
});

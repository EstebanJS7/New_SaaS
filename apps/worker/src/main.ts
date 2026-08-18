import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import { pathToFileURL } from "url";
import { WorkerModule } from "./worker.module.js";
import { workerEnv } from "./config/worker-env.js";
import { RedisHealthService } from "./redis/redis-health.service.js";

export interface WorkerHealthProbe {
  ping(): Promise<void>;
}

export interface WorkerHandle {
  shutdown(): Promise<void>;
}

export interface BootstrapOptions {
  redisHealth?: WorkerHealthProbe;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<WorkerHandle> {
  const envResult = workerEnv(process.env);
  if (!envResult.success) {
    throw new Error(envResult.error);
  }

  let app: INestApplicationContext | null = null;
  let redisHealth: WorkerHealthProbe;

  if (options.redisHealth) {
    redisHealth = options.redisHealth;
  } else {
    app = await NestFactory.createApplicationContext(WorkerModule);
    app.enableShutdownHooks();
    redisHealth = app.get(RedisHealthService);
  }

  await redisHealth.ping();
  console.info("Worker connected to Redis");

  return {
    shutdown: async (): Promise<void> => {
      if (app) {
        await app.close();
      }
    },
  };
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  bootstrap()
    .then((handle) => {
      const shutdown = (): void => {
        process.off("SIGTERM", shutdown);
        process.off("SIGINT", shutdown);
        void handle.shutdown().then(() => process.exit(0));
      };

      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    })
    .catch((error: unknown) => {
      console.error("Failed to start worker", error);
      process.exit(1);
    });
}

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

/**
 * Registers SIGTERM/SIGINT handlers that run the worker shutdown sequence.
 *
 * The sequence runs at most once: both listeners are removed before shutting
 * down, so repeated signals are inert. A clean shutdown exits with status 0;
 * a rejected shutdown is logged and exits with a non-zero status (1).
 */
export function installSignalShutdown(
  handle: WorkerHandle,
  proc: Pick<NodeJS.Process, "once" | "off" | "exit"> = process
): void {
  const shutdown = (): void => {
    proc.off("SIGTERM", shutdown);
    proc.off("SIGINT", shutdown);

    handle
      .shutdown()
      .then(() => {
        proc.exit(0);
      })
      .catch((error: unknown) => {
        console.error("Worker shutdown failed", error);
        proc.exit(1);
      });
  };

  proc.once("SIGTERM", shutdown);
  proc.once("SIGINT", shutdown);
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
      installSignalShutdown(handle);
    })
    .catch((error: unknown) => {
      console.error("Failed to start worker", error);
      process.exit(1);
    });
}

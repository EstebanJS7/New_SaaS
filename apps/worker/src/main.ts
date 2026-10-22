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
 * ## The guard is a flag, not listener removal ([[TD-003]] / [[HARD-005]])
 *
 * The previous implementation removed BOTH listeners at the top of the first
 * handler. That is correct only while the shutdown is instantaneous: removing a
 * listener restores the operating system's DEFAULT disposition, so a second
 * SIGTERM arriving while the shutdown promise is still pending hard-killed the
 * process with a non-zero exit — aborting an in-flight teardown instead of
 * letting it finish. The unit test could not see this, because an EventEmitter
 * has no OS default disposition to fall back to.
 *
 * The listeners now stay installed for the life of the process and a state flag
 * makes them inert once shutdown has begun. A repeated signal is absorbed rather
 * than translated into a kill, which is what makes "exit status remains 0"
 * true at runtime and not only in a stub.
 *
 * A clean shutdown exits with status 0; a rejected shutdown is logged and exits
 * with a non-zero status (1). Draining work after a failed teardown would keep a
 * broken consumer alive, so the non-zero exit is deliberate.
 *
 * ## The escape hatch that is NOT removed
 *
 * An operator whose shutdown is genuinely hung still needs a way out, and this
 * guard does not take it away: `SIGKILL` cannot be caught by any process, so it
 * remains available and behaves exactly as before. What changed is that a
 * *graceful* signal is no longer the same thing as a hard kill by accident.
 */
export function installSignalShutdown(
  handle: WorkerHandle,
  // `on`, not `once`: a one-shot listener is REMOVED the moment it fires, which
  // reintroduces exactly the window this guard closes.
  proc: Pick<NodeJS.Process, "on" | "off" | "exit"> = process
): void {
  let shuttingDown = false;

  const shutdown = (): void => {
    if (shuttingDown) {
      // Absorbed on purpose: the in-flight teardown decides the exit status.
      return;
    }
    shuttingDown = true;

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

  // PERSISTENT listeners. `once` would be consumed by the first signal and leave
  // no handler for the second, restoring the OS default disposition — the defect
  // TD-003 recorded. The flag, not the registration mode, is what makes repeats
  // inert. `off` stays in the process contract because an operator or a future
  // caller may legitimately unregister.
  proc.on("SIGTERM", shutdown);
  proc.on("SIGINT", shutdown);
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

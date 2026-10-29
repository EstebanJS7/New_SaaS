import { describe, it, expect, vi, afterEach, beforeAll, afterAll, type Mock } from "vitest";
import { EventEmitter } from "node:events";
import { NestFactory } from "@nestjs/core";
import { bootstrap, installSignalShutdown } from "./main.js";
import type { WorkerHandle } from "./main.js";

type SignalProcess = Pick<NodeJS.Process, "on" | "once" | "off" | "exit">;

interface ShutdownHarness {
  proc: SignalProcess;
  emitSignal(signal: string): boolean;
  exit: Mock<(code?: number) => void>;
  listenerCount(signal: string): number;
}

/**
 * Builds an injectable process double backed by an EventEmitter so signal
 * delivery is simulated in-process (no child processes, no real signals).
 */
function createShutdownHarness(): ShutdownHarness {
  const emitter = new EventEmitter();
  const exit: Mock<(code?: number) => void> = vi.fn<(code?: number) => void>();

  // Adapter cast: EventEmitter covers on/once/off; exit is spied instead of
  // terminating the test runner.
  const proc = {
    on: (event: string | symbol, listener: (...args: unknown[]) => void) => {
      emitter.on(event, listener);
      return proc;
    },
    once: (event: string | symbol, listener: (...args: unknown[]) => void) => {
      emitter.once(event, listener);
      return proc;
    },
    off: (event: string | symbol, listener: (...args: unknown[]) => void) => {
      emitter.off(event, listener);
      return proc;
    },
    exit,
  } as unknown as SignalProcess;

  return {
    proc,
    emitSignal: (signal) => emitter.emit(signal),
    exit,
    listenerCount: (signal) => emitter.listenerCount(signal),
  };
}

const flushAsyncTasks = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

describe("installSignalShutdown", () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  afterEach(() => {
    errorSpy.mockClear();
  });

  it("runs the shutdown sequence once and exits 0 on SIGTERM", async () => {
    const shutdown = vi.fn(() => Promise.resolve());
    const handle: WorkerHandle = { shutdown };
    const harness = createShutdownHarness();

    installSignalShutdown(handle, harness.proc);
    harness.emitSignal("SIGTERM");
    await flushAsyncTasks();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(0);
    // The listeners STAY INSTALLED ([[TD-003]]): removing them restores the OS
    // default disposition, so a second signal during an in-flight teardown would
    // hard-kill the process. The guard is a state flag, not a missing listener.
    expect(harness.listenerCount("SIGTERM")).toBe(1);
  });

  it("runs the shutdown sequence once and exits 0 on SIGINT", async () => {
    const shutdown = vi.fn(() => Promise.resolve());
    const handle: WorkerHandle = { shutdown };
    const harness = createShutdownHarness();

    installSignalShutdown(handle, harness.proc);
    harness.emitSignal("SIGINT");
    await flushAsyncTasks();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(0);
    expect(harness.listenerCount("SIGINT")).toBe(1);
  });

  it("is inert after the first signal: shutdown never re-runs and exit stays 0", async () => {
    const shutdown = vi.fn(() => Promise.resolve());
    const handle: WorkerHandle = { shutdown };
    const harness = createShutdownHarness();

    installSignalShutdown(handle, harness.proc);
    harness.emitSignal("SIGTERM");
    await flushAsyncTasks();

    harness.emitSignal("SIGINT");
    await flushAsyncTasks();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(0);
  });

  /**
   * TD-003's evidence gate, verbatim: "a second signal delivered WHILE the shutdown
   * promise is still pending, asserting final exit status 0, without spawning child
   * processes".
   *
   * This is the case the old implementation could not survive. It removed both
   * listeners before awaiting the teardown, so on a real process the second SIGTERM
   * found no handler and the OS default disposition killed the worker mid-teardown.
   * A pending promise is what makes that window observable in a test at all — the
   * previous suite only ever signalled after the shutdown had already settled.
   */
  it("absorbs a second signal while the shutdown is still pending and still exits 0", async () => {
    let resolveShutdown: (() => void) | undefined;
    const shutdown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveShutdown = resolve;
        })
    );
    const handle: WorkerHandle = { shutdown };
    const harness = createShutdownHarness();

    installSignalShutdown(handle, harness.proc);
    harness.emitSignal("SIGTERM");
    await flushAsyncTasks();

    // Mid-flight: the shutdown started and has NOT settled.
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(harness.exit).not.toHaveBeenCalled();

    // The impatient operator, or the orchestrator's second attempt.
    harness.emitSignal("SIGTERM");
    harness.emitSignal("SIGINT");
    await flushAsyncTasks();

    // Absorbed: no second teardown, and above all no hard kill.
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(harness.exit).not.toHaveBeenCalled();

    resolveShutdown?.();
    await flushAsyncTasks();

    expect(harness.exit).toHaveBeenCalledTimes(1);
    expect(harness.exit).toHaveBeenCalledWith(0);
  });

  it("logs a rejected shutdown and exits non-zero", async () => {
    const shutdown = vi.fn(() => Promise.reject(new Error("close failed")));
    const handle: WorkerHandle = { shutdown };
    const harness = createShutdownHarness();

    installSignalShutdown(handle, harness.proc);
    harness.emitSignal("SIGTERM");
    await flushAsyncTasks();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("shutdown"), expect.any(Error));

    const [exitCode] = harness.exit.mock.calls[0] ?? [];
    expect(typeof exitCode).toBe("number");
    expect(exitCode).not.toBe(0);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});

describe("Worker bootstrap", () => {
  // The worker now requires DATABASE_URL (cleanup intents + audit rows). The
  // bootstrap tests inject a fake Redis probe but still parse env, so pin a
  // test-only value and restore the caller's environment afterwards.
  const originalDatabaseUrl = process.env.DATABASE_URL;
  beforeAll(() => {
    process.env.DATABASE_URL ??= "postgresql://worker:worker@localhost:5432/newsaas_test";
  });
  afterAll(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("throws when a required environment variable is missing", async () => {
    const originalRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;

    const redisHealth = { ping: vi.fn().mockResolvedValue(undefined) };
    await expect(bootstrap({ redisHealth })).rejects.toThrow("REDIS_URL");

    process.env.REDIS_URL = originalRedisUrl;
  });

  it("starts successfully when Redis ping succeeds", async () => {
    process.env.REDIS_URL ??= "redis://localhost:6379";
    const redisHealth = { ping: vi.fn().mockResolvedValue(undefined) };

    const handle = await bootstrap({ redisHealth });

    expect(redisHealth.ping).toHaveBeenCalledTimes(1);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it("fails fast when Redis ping fails", async () => {
    process.env.REDIS_URL ??= "redis://localhost:6379";
    const redisHealth = { ping: vi.fn().mockRejectedValue(new Error("Redis unreachable")) };

    await expect(bootstrap({ redisHealth })).rejects.toThrow("Redis unreachable");
    expect(redisHealth.ping).toHaveBeenCalledTimes(1);
  });

  it("closes the real-context path once through the explicit signal owner", async () => {
    process.env.REDIS_URL ??= "redis://localhost:6379";
    const context = {
      get: vi.fn(() => ({ ping: vi.fn().mockResolvedValue(undefined) })),
      close: vi.fn().mockResolvedValue(undefined),
      enableShutdownHooks: vi.fn(),
    };
    const factory = vi
      .spyOn(NestFactory, "createApplicationContext")
      .mockResolvedValue(
        context as unknown as Awaited<ReturnType<typeof NestFactory.createApplicationContext>>
      );
    try {
      const handle = await bootstrap();
      const harness = createShutdownHarness();
      installSignalShutdown(handle, harness.proc);
      harness.emitSignal("SIGINT");
      harness.emitSignal("SIGTERM");
      await flushAsyncTasks();
      expect(context.enableShutdownHooks).not.toHaveBeenCalled();
      expect(context.close).toHaveBeenCalledTimes(1);
      expect(harness.exit).toHaveBeenCalledWith(0);
    } finally {
      factory.mockRestore();
    }
  });
});

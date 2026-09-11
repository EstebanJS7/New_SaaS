import { describe, it, expect, vi, afterEach, beforeAll, afterAll, type Mock } from "vitest";
import { EventEmitter } from "node:events";
import { bootstrap, installSignalShutdown } from "./main.js";
import type { WorkerHandle } from "./main.js";

type SignalProcess = Pick<NodeJS.Process, "once" | "off" | "exit">;

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

  // Adapter cast: EventEmitter covers once/off; exit is spied instead of
  // terminating the test runner.
  const proc = {
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
    expect(harness.listenerCount("SIGTERM")).toBe(0);
    expect(harness.listenerCount("SIGINT")).toBe(0);
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
    expect(harness.listenerCount("SIGTERM")).toBe(0);
    expect(harness.listenerCount("SIGINT")).toBe(0);
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
});

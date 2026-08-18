import { describe, it, expect, beforeAll } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(__dirname, "..");

function parseRedisUrl(url: string): { host: string; port: number } {
  const match = /^redis:\/\/([^:]+):(\d+)$/.exec(url);
  if (!match) {
    throw new Error(`Unsupported REDIS_URL format: ${url}`);
  }
  return { host: match[1], port: Number(match[2]) };
}

async function redisReachable(): Promise<boolean> {
  const url = process.env.REDIS_URL;
  if (!url) return false;
  const { host, port } = parseRedisUrl(url);
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket
      .once("connect", () => {
        socket.destroy();
        resolve(true);
      })
      .once("error", () => {
        resolve(false);
      })
      .connect(port, host);
  });
}

describe("Worker bootstrap", () => {
  beforeAll(async () => {
    if (!(await redisReachable())) {
      // eslint-disable-next-line no-console
      console.log("Redis is not reachable; skipping worker bootstrap integration test");
    }
  });

  it("stays alive after a successful Redis probe", async () => {
    const reachable = await redisReachable();
    if (!reachable) {
      return;
    }

      const worker = spawn(
        "node",
        ["--import", "./register-loader.js", "src/main.ts"],
        {
          cwd: workerDir,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

    let output = "";
    worker.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    worker.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    const connected = await new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => resolve(false), 30_000);
      worker.stdout.on("data", () => {
        if (output.includes("Worker connected to Redis")) {
          clearTimeout(timer);
          resolve(true);
        }
      });
      worker.on("error", reject);
      worker.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Worker exited early with code ${code}. Output:\n${output}`));
      });
    });

    if (!connected) {
      worker.kill("SIGTERM");
      throw new Error(`Worker did not connect within timeout. Output:\n${output}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(worker.killed).toBe(false);
    expect(worker.exitCode).toBeNull();

    worker.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      worker.on("exit", () => resolve());
    });
  }, 60_000);
});

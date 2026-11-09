import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * The built worker as a fiscal pipeline: the fake SIFEN provider in the TEST environment.
 *
 * It inherits the lane's environment, so it reads the SAME `SECRET_STORE_MASTER_KEYS` the API was
 * started with (`playwright.config.ts` generates them once per run). That is the point: the API
 * encrypts the certificate's private key and the CSC, and the worker decrypts them to sign the DE.
 *
 * `node` directly, as `mail-worker.ts` explains: killing a `pnpm` wrapper would leave the consumer
 * alive. Start it in `beforeAll` and stop it in `afterAll` of ONE file.
 */
export interface FiscalWorker {
  /** Everything the worker printed so far — the diagnostic a failed wait attaches. */
  output(): string;
  stop(): Promise<void>;
}

export function startFiscalWorker(): FiscalWorker {
  let output = "";
  const worker: ChildProcess = spawn(
    process.execPath,
    [join(REPO_ROOT, "apps/worker/dist/main.js")],
    {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        FISCAL_PROVIDER: "fake",
        SIFEN_ENVIRONMENT: "TEST",
        // FISC-019: the fake asks for a signed DE, so the worker builds, signs
        // and XSD-gates it with the certificate and CSC loaded on the screen.
        // DTE_XSD_DIR (the official schemas) comes from the lane's environment.
        FISCAL_FAKE_REQUIRES_SIGNED_DOCUMENT: "true",
      },
    }
  );
  for (const stream of [worker.stdout, worker.stderr]) {
    stream?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
  }
  const exited = new Promise<void>((resolve) => worker.once("exit", () => resolve()));

  return {
    output: () => output || "(nothing)",
    async stop() {
      if (worker.exitCode !== null || worker.signalCode !== null) return;
      worker.kill("SIGTERM");
      // Waited for, so the next file's worker never shares the fiscal queue with this one.
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    },
  };
}

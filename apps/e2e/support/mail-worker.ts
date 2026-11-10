import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SMTP_SINK_PORT, startSmtpSink, type SmtpSink } from "./smtp-sink.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * The built worker, pointed at the lane's SMTP sink, for a spec whose flow leaves by mail.
 *
 * The same arrangement `recovery.spec.ts` documents: `node` directly (killing a `pnpm` wrapper would
 * leave the consumer alive), the REAL nodemailer adapter with the complete variable set the channel
 * module requires, and one origin for the link and the browser. Start it in `beforeAll` and stop it
 * in `afterAll` of ONE file, so two consumers never fight over the same queue.
 */
export interface MailWorker {
  /**
   * The next message addressed to `recipient`. Messages for anyone else — a delivery an earlier,
   * interrupted run left queued — are skipped, so a stale message cannot stand in for this flow's.
   */
  nextMessageTo(recipient: string, timeoutMs?: number): Promise<string>;
  /** Everything the worker printed so far — the diagnostic a failed wait attaches. */
  output(): string;
  stop(): Promise<void>;
}

/**
 * `extraEnv` adds variables on top of the mail ones — `FISCAL_WORKER_ENV`, for a spec whose mail is
 * the fiscal approval notice and therefore needs the fiscal pipeline in the same process.
 */
export async function startMailWorker(
  extraEnv: Readonly<Record<string, string>> = {}
): Promise<MailWorker> {
  const sink: SmtpSink = await startSmtpSink(SMTP_SINK_PORT);
  let output = "";
  const worker: ChildProcess = spawn(
    process.execPath,
    [join(REPO_ROOT, "apps/worker/dist/main.js")],
    {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(SMTP_SINK_PORT),
        SMTP_SECURE: "false",
        SMTP_USER: "e2e",
        SMTP_PASSWORD: "e2e",
        NOTIFICATION_EMAIL_FROM: "no-reply@demo.newsaas.test",
        WEB_APP_BASE_URL: "http://127.0.0.1:3000",
        ...extraEnv,
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
    async nextMessageTo(recipient, timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const remaining = deadline - Date.now();
        try {
          if (remaining <= 0) throw new Error(`No message to ${recipient} arrived in time.`);
          const message = await sink.nextMessage(remaining);
          // `RCPT TO` arrives as written on the wire, angle brackets included.
          if (message.recipients.some((to) => to.toLowerCase().includes(recipient.toLowerCase()))) {
            return message.body;
          }
        } catch (error) {
          throw new Error(
            `${(error as Error).message}\n\nWorker output:\n${output || "(nothing)"}`
          );
        }
      }
    },
    async stop() {
      if (worker.exitCode === null && worker.signalCode === null) {
        worker.kill("SIGTERM");
        // Waited for, so the next file's worker never shares a queue with this one.
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      }
      await sink.close();
    },
  };
}

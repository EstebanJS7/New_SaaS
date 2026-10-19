import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { resetLinkIn, SMTP_SINK_PORT, startSmtpSink, type SmtpSink } from "../support/smtp-sink.js";
import { DEMO, PORTAL_HOLDER_EMAIL, RECOVERABLE_EMAIL } from "./fixtures.js";

/**
 * Password recovery, end to end, for BOTH identities — in one file on purpose.
 *
 * These are the only flows that prove the link that LEAVES BY MAIL works: the API mints nothing, the
 * worker mints the token at send time, and a plaintext token is stored nowhere. So the lane has to be
 * the mail server, which is why the sink exists. It also exercises the real `nodemailer` adapter.
 *
 * Both flows live here rather than in two files because they share one queue consumer and one sink.
 * Split across files, Playwright gives each file its own worker PROCESS, so each started its own
 * consumer of the same queue and the flows fought over the messages. One file, one worker, one sink.
 */
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

test.describe("password recovery", () => {
  let sink: SmtpSink;
  let workerOutput = "";
  let worker: ReturnType<typeof spawn> | undefined;

  test.beforeAll(async () => {
    sink = await startSmtpSink(SMTP_SINK_PORT);

    // `node`, directly — not `pnpm start`. The wrapper is not the process that consumes: killing it
    // leaves the worker alive, and a worker that outlives its spec takes the next flow's message and
    // sends it to a sink that has already closed.
    worker = spawn(process.execPath, [join(REPO_ROOT, "apps/worker/dist/main.js")], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // The REAL email adapter, pointed at this process: the channel fake retains attempts in memory
        // and deliberately never logs a recipient, and the plaintext token exists nowhere else.
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(SMTP_SINK_PORT),
        SMTP_SECURE: "false",
        SMTP_USER: "e2e",
        SMTP_PASSWORD: "e2e",
        NOTIFICATION_EMAIL_FROM: "no-reply@demo.newsaas.test",
        // One origin for the link and the browser, so a cookie jar is never split across hostnames.
        WEB_APP_BASE_URL: "http://127.0.0.1:3000",
      },
    });
    for (const stream of [worker.stdout, worker.stderr]) {
      stream?.on("data", (chunk: Buffer) => {
        workerOutput += chunk.toString();
      });
    }
  });

  test.afterAll(async () => {
    worker?.kill("SIGTERM");
    await sink?.close();
  });

  /** The next message, with the worker's own output attached to a failure. */
  async function nextMessage(): Promise<string> {
    try {
      const message = await sink.nextMessage(30_000);
      return message.body;
    } catch (error) {
      throw new Error(
        `${(error as Error).message}\n\nWorker output:\n${workerOutput || "(nothing)"}`
      );
    }
  }

  test("the staff link that leaves by mail resets the password, once", async ({
    page,
    browser,
  }) => {
    await page.goto("/forgot-password");
    await page.fill("#forgot-email", RECOVERABLE_EMAIL);
    await page.getByRole("button", { name: "Send the link" }).click();
    await expect(page.getByTestId("forgot-sent")).toBeVisible();

    const body = await nextMessage();
    expect(body).toContain(RECOVERABLE_EMAIL);
    const link = resetLinkIn(body, "/reset-password");

    await page.goto(link);
    await page.fill("#reset-password", DEMO.recoveredPassword);
    await page.fill("#reset-confirmation", DEMO.recoveredPassword);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByTestId("reset-done")).toBeVisible();

    // The new password signs in — the assertion that the reset changed something.
    await page.goto("/login");
    await page.fill("#login-email", RECOVERABLE_EMAIL);
    await page.fill("#login-password", DEMO.recoveredPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    // And the OLD one does not, in a fresh context so the session above is out of the way.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto("/login");
    await otherPage.fill("#login-email", RECOVERABLE_EMAIL);
    await otherPage.fill("#login-password", DEMO.recoverablePassword);
    await otherPage.getByRole("button", { name: "Sign in" }).click();
    await expect(otherPage.getByTestId("login-problem")).toBeVisible();

    // Single use, and refused as invalid rather than as "already used".
    await otherPage.goto(link);
    await otherPage.fill("#reset-password", "another-password-entirely");
    await otherPage.fill("#reset-confirmation", "another-password-entirely");
    await otherPage.getByRole("button", { name: "Change password" }).click();
    await expect(otherPage.getByTestId("reset-problem")).toBeVisible();

    await other.close();
  });

  test("asks for a staff link with the Enter key", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.fill("#forgot-email", RECOVERABLE_EMAIL);

    await page.locator("#forgot-email").press("Enter");

    await expect(page.getByTestId("forgot-sent")).toBeVisible();
  });

  test("the portal link that leaves by mail resets the holder's password, once", async ({
    page,
    browser,
  }) => {
    const base = `/${DEMO.tenantSlug}`;

    await page.goto(`${base}/forgot-password`);
    await page.fill("#portal-forgot-email", PORTAL_HOLDER_EMAIL);
    await page.getByRole("button", { name: "Send the link" }).click();
    await expect(page.getByTestId("portal-forgot-sent")).toBeVisible();

    const body = await nextMessage();
    expect(body).toContain(PORTAL_HOLDER_EMAIL);
    // The slug is in the PATH, because the portal surface is `/[slug]/…`.
    const link = resetLinkIn(body, `${base}/reset-password`);

    await page.goto(link);
    await page.fill("#portal-reset-password", DEMO.portalRecoveredPassword);
    await page.fill("#portal-reset-confirmation", DEMO.portalRecoveredPassword);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByTestId("portal-reset-done")).toBeVisible();

    // The new password signs in as a PORTAL holder — the cookie is the portal's, not the staff's.
    await page.goto(`${base}/login`);
    await page.fill("#portal-login-email", PORTAL_HOLDER_EMAIL);
    await page.fill("#portal-login-password", DEMO.portalRecoveredPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(new RegExp(`${base}$`));

    // And the seeded one does not, in a fresh context.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto(`${base}/login`);
    await otherPage.fill("#portal-login-email", PORTAL_HOLDER_EMAIL);
    await otherPage.fill("#portal-login-password", DEMO.portalPassword);
    await otherPage.getByRole("button", { name: "Sign in" }).click();
    await expect(otherPage.getByTestId("portal-login-problem")).toBeVisible();

    // Single use.
    await otherPage.goto(link);
    await otherPage.fill("#portal-reset-password", "another-password-entirely");
    await otherPage.fill("#portal-reset-confirmation", "another-password-entirely");
    await otherPage.getByRole("button", { name: "Change password" }).click();
    await expect(otherPage.getByTestId("portal-reset-problem")).toBeVisible();

    await other.close();
  });

  test("asks for a portal link with the Enter key", async ({ page }) => {
    await page.goto(`/${DEMO.tenantSlug}/forgot-password`);
    await page.fill("#portal-forgot-email", PORTAL_HOLDER_EMAIL);

    await page.locator("#portal-forgot-email").press("Enter");

    await expect(page.getByTestId("portal-forgot-sent")).toBeVisible();
  });
});

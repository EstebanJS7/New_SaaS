import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { resetLinkIn, startSmtpSink, type SmtpSink } from "../support/smtp-sink.js";
import { DEMO, RECOVERABLE_EMAIL } from "./fixtures.js";

/**
 * Password recovery, end to end — the flow the session ran by hand and the one worth automating most.
 *
 * It is the only flow that proves the link that LEAVES BY MAIL works: the API mints nothing, the worker
 * mints the token at send time, and the token exists in plaintext only inside the message. So the lane
 * has to be the mail server, which is why the sink exists.
 */
const SMTP_PORT = 2526;
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test.describe("staff password recovery", () => {
  let sink: SmtpSink;
  let worker: ChildProcess;
  /** The worker's output, kept so a failure can show WHY it never sent anything. */
  let workerOutput = "";

  test.beforeAll(async () => {
    sink = await startSmtpSink(SMTP_PORT);

    // The worker is started HERE and not in the global setup: it is only this flow that needs a
    // consumer, and a lane that always ran one would pay for it in every other spec.
    worker = spawn("pnpm", ["--filter", "@newsaas/worker", "start"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // The REAL email adapter, pointed at this process: the fake retains attempts in memory and
        // deliberately never logs a recipient, so it cannot be read — and the plaintext token is
        // nowhere else by design.
        EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: String(SMTP_PORT),
        SMTP_SECURE: "false",
        // The channel module REFUSES a half-configured SMTP ("SMTP_USER is required when the smtp
        // provider is selected"), which is the right rule and which made the worker exit on startup.
        // The sink advertises no AUTH, so these are never used to authenticate against it.
        SMTP_USER: "e2e",
        SMTP_PASSWORD: "e2e",
        // The sender. The complete list a real adapter needs is `NOTIFICATION_EMAIL_ENV_VARS`, and the
        // module refuses a boot when any of them is absent — which is why this one was discovered the
        // same way the other two were: by the worker exiting with a message naming it.
        NOTIFICATION_EMAIL_FROM: "no-reply@demo.newsaas.test",
        // One origin for the link and the browser, so the cookie jar is not split across hostnames.
        WEB_APP_BASE_URL: "http://127.0.0.1:3000",
      },
    });
    worker.stdout?.on("data", (chunk: Buffer) => {
      workerOutput += chunk.toString();
    });
    worker.stderr?.on("data", (chunk: Buffer) => {
      workerOutput += chunk.toString();
    });
  });

  test.afterAll(async () => {
    worker?.kill("SIGTERM");
    await sink?.close();
  });

  test("the link that leaves by mail resets the password, once", async ({ page, browser }) => {
    await page.goto("/forgot-password");
    await page.fill("#forgot-email", RECOVERABLE_EMAIL);
    await page.getByRole("button", { name: "Send the link" }).click();
    await expect(page.getByTestId("forgot-sent")).toBeVisible();

    // BE the mail server. Nothing else holds the token: it is minted when the message is built, and a
    // plaintext token is never stored, logged or returned by any API.
    const message = await sink.nextMessage(30_000).catch((error: Error) => {
      // The worker's own output is the answer nine times out of ten, and a lane that swallows it makes
      // the reader re-run the spec to find out why nothing was sent.
      throw new Error(`${error.message}\n\nWorker output:\n${workerOutput}`);
    });
    expect(message.recipients.join(" ")).toContain(RECOVERABLE_EMAIL);
    const link = resetLinkIn(message.body, "/reset-password");

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

    // And the OLD one does not, in a fresh context so the session above is not in the way.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto("/login");
    await otherPage.fill("#login-email", RECOVERABLE_EMAIL);
    await otherPage.fill("#login-password", DEMO.recoverablePassword);
    await otherPage.getByRole("button", { name: "Sign in" }).click();
    await expect(otherPage.getByTestId("login-problem")).toBeVisible();

    // The link is SINGLE USE: following it again is refused, and refused as invalid rather than as
    // "already used", which is the same uniformity every other failure gets.
    await otherPage.goto(link);
    await otherPage.fill("#reset-password", "another-password-entirely");
    await otherPage.fill("#reset-confirmation", "another-password-entirely");
    await otherPage.getByRole("button", { name: "Change password" }).click();
    await expect(otherPage.getByTestId("reset-problem")).toBeVisible();

    await other.close();
  });

  test("asks for a link with the Enter key", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.fill("#forgot-email", RECOVERABLE_EMAIL);

    await page.locator("#forgot-email").press("Enter");

    await expect(page.getByTestId("forgot-sent")).toBeVisible();
  });
});

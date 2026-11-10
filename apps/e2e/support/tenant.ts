import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type Browser } from "@playwright/test";

/**
 * A second clinic, created the way an operator creates a real one ([[ONB-001]]): the repository's
 * own provisioning command (`pnpm --filter @newsaas/database db:provision-tenant`) against the lane's
 * `DATABASE_URL`, then the owner sets a password on the real activation page with the one-time link
 * the command prints for the operator to hand over.
 *
 * Slug and owner email must be new on every run: provisioning refuses an existing slug, and the
 * lane's database persists between runs.
 */
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

export interface ProvisionedOwner {
  readonly slug: string;
  readonly email: string;
  readonly password: string;
  readonly features: readonly string[];
}

export async function provisionClinic(
  browser: Browser,
  input: {
    readonly slug: string;
    readonly name: string;
    readonly ownerEmail: string;
    readonly ownerName: string;
    readonly features: readonly string[];
    readonly webUrl: string;
    readonly password: string;
  }
): Promise<ProvisionedOwner> {
  if (process.env.DATABASE_URL === undefined) {
    throw new Error("DATABASE_URL is not set: the provisioning command needs the lane's database.");
  }
  let output: string;
  try {
    output = execFileSync(
      "pnpm",
      [
        "--silent",
        "--filter",
        "@newsaas/database",
        "db:provision-tenant",
        "--slug",
        input.slug,
        "--name",
        input.name,
        "--owner-email",
        input.ownerEmail,
        "--owner-name",
        input.ownerName,
        "--features",
        input.features.join(","),
        "--web-url",
        input.webUrl,
      ],
      { cwd: REPO_ROOT, stdio: "pipe", env: process.env, encoding: "utf8" }
    );
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(
      `db:provision-tenant failed:\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`.trim()
    );
  }
  expect(output).toContain("Clínica creada.");
  const link = /(https?:\/\/\S+activate=1\S*)/.exec(output)?.[1];
  if (link === undefined) {
    throw new Error(`db:provision-tenant printed no activation link:\n${output}`);
  }

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Activá tu cuenta" })).toBeVisible();
    await page.fill("#reset-password", input.password);
    await page.fill("#reset-confirmation", input.password);
    await page.getByRole("button", { name: "Activar cuenta" }).click();
    await expect(page.getByTestId("reset-done")).toContainText(
      "Ya podés ingresar con tu email y la contraseña que elegiste."
    );
  } finally {
    await context.close();
  }
  return {
    slug: input.slug,
    email: input.ownerEmail,
    password: input.password,
    features: input.features,
  };
}

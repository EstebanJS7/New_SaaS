import { spawn } from "node:child_process";
import { resolve } from "node:path";

// Invoking db:demo is the explicit opt-in. Refuse before building or opening a database.
if (!["development", "test"].includes(process.env.NODE_ENV)) {
  throw new Error("db:demo requires NODE_ENV=development or test.");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
for (const key of ["FISCAL_PROVIDER", "EMAIL_PROVIDER", "WHATSAPP_PROVIDER"]) {
  if (process.env[key] && process.env[key] !== "fake")
    throw new Error(`db:demo requires ${key}=fake or unset.`);
}
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Run this command with pnpm db:demo.");
const root = process.cwd();
const env = { ...process.env, ENABLE_DEMO_SEED: "true" };
async function run(args, cwd = root) {
  const code = await new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (status) => done(status ?? 1));
  });
  if (code !== 0) throw new Error(`Demo step failed (${code}); fix the error above and rerun.`);
}
await run([pnpm, "build", "--filter=@newsaas/api"]);
for (const seed of ["seed", "demo-seed"]) {
  await run(["--import", "tsx", `prisma/${seed}.ts`], resolve(root, "packages/database"));
}
await run(["dist/src/dev/demo-commercial-seed.js"], resolve(root, "apps/api"));

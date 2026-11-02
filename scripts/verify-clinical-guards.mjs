import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "../packages/database/src/generated/index.js";

// Only a new owned container: no .env, configured database or operational data.
const root = fileURLToPath(new URL("../", import.meta.url));
const name = "newsaas-ux026-pg-" + randomUUID().replaceAll("-", "");
const temp = mkdtempSync(join(tmpdir(), "newsaas-ux026-pg-"));
console.info("Disposable clinical guards artifacts: " + temp);
function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw Error("Disposable PG setup failed: " + result.stderr);
  return result.stdout.trim();
}
let started = false;
try {
  docker(["image", "inspect", "postgres:16-alpine"]);
  docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "--tmpfs",
    "/var/lib/postgresql/data",
    "-e",
    "POSTGRES_USER=ux026",
    "-e",
    "POSTGRES_PASSWORD=ux026-test-only",
    "-e",
    "POSTGRES_DB=ux026",
    "-p",
    "127.0.0.1::5432",
    "postgres:16-alpine",
  ]);
  started = true;
  const port = docker(["port", name, "5432/tcp"]).split(":").at(-1);
  const url = "postgresql://ux026:ux026-test-only@127.0.0.1:" + port + "/ux026";
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await db.$queryRaw`SELECT 1`;
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!ready) throw Error("Disposable PG did not start.");
  } finally {
    await db.$disconnect();
  }
  for (const suite of [
    "clinical-creation",
    "clinical-correction",
    "clinical-drafts",
    "treatment-entry",
    "study-entry",
    "weight-entry",
    "treatment-search",
    "study-search",
    "weight-search",
  ]) {
    const fd = openSync(join(temp, suite + ".log"), "w");
    try {
      const result = spawnSync(process.execPath, [join(root, "scripts/verify-" + suite + ".mjs")], {
        cwd: root,
        env: { ...process.env, NODE_OPTIONS: "--experimental-strip-types", DATABASE_URL: url },
        stdio: ["ignore", fd, fd],
        windowsHide: true,
      });
      console.info(suite + ": exit " + result.status);
      if (result.status !== 0)
        throw Error("Clinical PostgreSQL suite failed: " + suite + "; inspect " + temp);
    } finally {
      closeSync(fd);
    }
  }
} finally {
  if (started) docker(["rm", "-f", name]);
}

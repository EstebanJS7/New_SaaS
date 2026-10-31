import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  symlinkSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaClient } from "../packages/database/src/generated/index.js";

// Own test infrastructure only. Never load .env, reuse a DB/server or invoke the broad demo seed.
const root = fileURLToPath(new URL("../", import.meta.url));
const apiRequire = createRequire(new URL("../apps/api/package.json", import.meta.url));
const dbRequire = createRequire(new URL("../packages/database/package.json", import.meta.url));
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const e2eRequire = createRequire(new URL("../apps/e2e/package.json", import.meta.url));
const suffix = randomUUID().replaceAll("-", "");
const dbName = "newsaas_clinical_browser_test_" + suffix;
const pgName = "newsaas-ux021-pg-" + suffix.slice(0, 12),
  redisName = "newsaas-ux021-redis-" + suffix.slice(0, 12);
const temp = mkdtempSync(join(tmpdir(), "newsaas-ux021-browser-"));
writeFileSync(join(tmpdir(), "ux021-browser-root.txt"), temp);
console.info("Isolated clinical browser artifacts: " + temp);
let pgStarted = false,
  redisStarted = false;
function docker(args) {
  const r = spawnSync("docker", args, { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw Error("Docker test setup failed: " + r.stderr);
  return r.stdout.trim();
}
function run(bin, args, cwd, env, label) {
  console.info(label);
  const log = join(temp, label.replaceAll(/[^a-z0-9]+/gi, "-") + ".log"),
    fd = openSync(log, "w");
  try {
    const r = spawnSync(bin, args, { cwd, env, stdio: ["ignore", fd, fd], windowsHide: true });
    if (r.status !== 0) throw Error(label + " failed; inspect " + log);
  } finally {
    closeSync(fd);
  }
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No test port");
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}
async function ready(db) {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    try {
      await db.$queryRaw`SELECT 1`;
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw Error("Disposable PG did not start");
}
let result = 1;
try {
  docker(["image", "inspect", "postgres:16-alpine"]);
  docker(["image", "inspect", "redis:7-alpine"]);
  docker([
    "run",
    "--rm",
    "-d",
    "--name",
    pgName,
    "--tmpfs",
    "/var/lib/postgresql/data",
    "-e",
    "POSTGRES_USER=ux021",
    "-e",
    "POSTGRES_PASSWORD=ux021-test-only",
    "-e",
    "POSTGRES_DB=" + dbName,
    "-p",
    "127.0.0.1::5432",
    "postgres:16-alpine",
  ]);
  pgStarted = true;
  docker([
    "run",
    "--rm",
    "-d",
    "--name",
    redisName,
    "--tmpfs",
    "/data",
    "-p",
    "127.0.0.1::6379",
    "redis:7-alpine",
    "redis-server",
    "--save",
    "",
    "--appendonly",
    "no",
  ]);
  redisStarted = true;
  const pgPort = docker(["port", pgName, "5432/tcp"]).split(":").at(-1),
    redisPort = docker(["port", redisName, "6379/tcp"]).split(":").at(-1);
  const databaseUrl = "postgresql://ux021:ux021-test-only@127.0.0.1:" + pgPort + "/" + dbName;
  if (!/^\/newsaas_clinical_browser_test_[a-f0-9]{32}$/.test(new URL(databaseUrl).pathname))
    throw Error("Invalid disposable target");
  const apiPort = await freePort(),
    webPort = await freePort(),
    apiUrl = "http://127.0.0.1:" + apiPort,
    webUrl = "http://127.0.0.1:" + webPort;
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    REDIS_URL: "redis://127.0.0.1:" + redisPort,
    NODE_ENV: "development",
    NODE_OPTIONS: "--experimental-strip-types",
    API_HOST: "127.0.0.1",
    API_PORT: String(apiPort),
    NEXT_PUBLIC_API_URL: apiUrl,
    FISCAL_PROVIDER: "fake",
    EMAIL_PROVIDER: "fake",
    WHATSAPP_PROVIDER: "fake",
    BRANDING_ASSETS_ENABLED: "false",
    API_CORS_ALLOWED_ORIGINS: webUrl,
    CLINICAL_E2E_DATABASE_URL: databaseUrl,
    CLINICAL_E2E_BASE_URL: webUrl,
    CLINICAL_E2E_API_URL: apiUrl,
    CLINICAL_E2E_OUTPUT_DIR: join(temp, "results"),
    CLINICAL_E2E_SHOTS: join(temp, "screenshots"),
  };
  for (const key of Object.keys(env))
    if (/^(STORAGE_S3_|SMTP_|SIFEN_|DEMO_|ENABLE_DEMO)/.test(key)) delete env[key];
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await ready(db);
    run(
      process.execPath,
      [
        dbRequire.resolve("prisma/build/index.js"),
        "migrate",
        "deploy",
        "--schema",
        join(root, "packages/database/prisma/schema.prisma"),
      ],
      root,
      env,
      "Migrate disposable database"
    );
    // Compile the current reference catalog outside dev dist; installed dist may be older.
    const seedDir = join(temp, "database");
    mkdirSync(seedDir);
    writeFileSync(join(seedDir, "package.json"), '{"type":"module"}');
    symlinkSync(
      join(root, "packages/database/node_modules"),
      join(seedDir, "node_modules"),
      "junction"
    );
    run(
      process.execPath,
      [
        dbRequire.resolve("typescript/bin/tsc"),
        "-p",
        join(root, "packages/database/tsconfig.json"),
        "--outDir",
        seedDir,
        "--tsBuildInfoFile",
        join(temp, "database.tsbuildinfo"),
      ],
      root,
      env,
      "Build isolated reference catalog"
    );
    const { seedReferenceData } = await import(
      pathToFileURL(join(seedDir, "reference-seed.js")).href
    );
    await seedReferenceData(db);
    const hash = await apiRequire("argon2").hash("clinical-e2e-password", {
      type: apiRequire("argon2").argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const tenant = await db.tenant.create({
      data: { name: "Clínica sintética UX-021", slug: "clinical-e2e" },
    });
    const feature = await db.featureCode.findUniqueOrThrow({ where: { code: "veterinary" } });
    await db.tenantEntitlement.create({ data: { tenantId: tenant.id, featureCodeId: feature.id } });
    const common = ["patients.read", "customers.read", "vet.clinical.read"],
      write = [
        ...common,
        "vet.clinical.create",
        "vet.clinical.update",
        "vet.clinical.history_read",
      ];
    for (const [name, keys] of [
      ["writer", write],
      ["reader", common],
    ]) {
      const role = await db.role.create({
        data: { code: "CLINICAL_E2E_" + name.toUpperCase(), name: "Synthetic clinical " + name },
      });
      for (const key of keys) {
        const permission = await db.permission.findUniqueOrThrow({ where: { key } });
        await db.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      }
      const profile = await db.userProfile.create({
        data: {
          email: name + "@clinical-e2e.invalid",
          displayName: "Equipo sintético " + name,
          status: "ACTIVE",
        },
      });
      await db.userCredential.create({ data: { userProfileId: profile.id, passwordHash: hash } });
      await db.tenantMembership.create({
        data: { tenantId: tenant.id, userProfileId: profile.id, roleId: role.id, status: "ACTIVE" },
      });
    }
    env.CLINICAL_E2E_TENANT_ID = tenant.id;
  } finally {
    await db.$disconnect();
  }
  const apiDir = join(temp, "api"),
    webDir = join(temp, "web");
  mkdirSync(apiDir);
  mkdirSync(webDir);
  writeFileSync(join(apiDir, "package.json"), '{"type":"module"}');
  symlinkSync(join(root, "apps/api/node_modules"), join(apiDir, "node_modules"), "junction");
  run(
    process.execPath,
    [
      apiRequire.resolve("typescript/bin/tsc"),
      "-p",
      join(root, "apps/api/tsconfig.json"),
      "--outDir",
      apiDir,
      "--tsBuildInfoFile",
      join(temp, "api.tsbuildinfo"),
    ],
    root,
    env,
    "Build isolated API"
  );
  for (const entry of readdirSync(join(root, "apps/web"), { withFileTypes: true })) {
    if (entry.isDirectory() && !["src", "public", "scripts"].includes(entry.name)) continue;
    if (
      !entry.isDirectory() &&
      !/^(package\.json|tsconfig\.json|next\.config\.js|next-env\.d\.ts|vitest\.(config|setup)\.ts|postcss\.config\..+|tailwind\.config\..+|eslint\.config\..+)$/.test(
        entry.name
      )
    )
      continue;
    cpSync(join(root, "apps/web", entry.name), join(webDir, entry.name), { recursive: true });
  }
  symlinkSync(join(root, "apps/web/node_modules"), join(webDir, "node_modules"), "junction");
  run(
    process.execPath,
    [webRequire.resolve("next/dist/bin/next"), "build"],
    webDir,
    { ...env, NODE_ENV: "production" },
    "Build isolated web"
  );
  run(
    process.execPath,
    [join(webDir, "scripts/verify-build-output.mjs")],
    webDir,
    env,
    "Verify web output"
  );
  env.CLINICAL_E2E_API_ENTRY = join(apiDir, "src/main.js");
  env.CLINICAL_E2E_WEB_DIR = webDir;
  env.CLINICAL_E2E_NEXT_BIN = webRequire.resolve("next/dist/bin/next");
  mkdirSync(env.CLINICAL_E2E_SHOTS);
  // Optional bounded selection for diagnosing an independently recorded lane failure.
  // Never alters retries, navigation, config or permissions.
  const selection = process.argv.slice(2);
  if (selection.length && (selection.length !== 2 || selection[0] !== "--grep" || !selection[1]))
    throw Error("Only optional --grep <test pattern> is supported.");
  if (selection.length) console.info("Scoped Playwright selection: " + selection[1]);
  const browser = spawnSync(
    process.execPath,
    [
      e2eRequire.resolve("@playwright/test/cli"),
      "test",
      "--config",
      "clinical.playwright.config.ts",
      ...selection,
    ],
    { cwd: join(root, "apps/e2e"), env, stdio: "inherit", windowsHide: true }
  );
  result = browser.status ?? 1;
} finally {
  for (const name of [redisStarted && redisName, pgStarted && pgName].filter(Boolean)) {
    try {
      docker(["stop", name]);
    } catch {
      result = 1;
      console.error("Could not remove disposable container: " + name);
    }
  }
  console.info("Disposable clinical test containers removed; artifacts retained at " + temp);
}
process.exitCode = result;

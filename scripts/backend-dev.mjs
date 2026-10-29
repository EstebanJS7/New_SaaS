import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Use the app's existing TypeScript compiler: tsx/esbuild cannot emit Nest DI metadata.
const require = createRequire(resolve("package.json"));
const ts = require("typescript");
const entry = process.argv[2];
if (!entry) throw new Error("Usage: backend-dev.mjs <compiled-entry>");

let child;
let restarting = Promise.resolve();
let stopping = false;
async function stopChild() {
  const previous = child;
  child = undefined;
  if (!previous || previous.exitCode !== null || previous.signalCode !== null) return;
  await new Promise((done) => {
    const timeout = setTimeout(() => previous.kill("SIGKILL"), 5000);
    previous.once("exit", () => {
      clearTimeout(timeout);
      done();
    });
    previous.kill("SIGTERM");
  });
}

const format = {
  getCanonicalFileName: (name) => name,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => ts.sys.newLine,
};
const host = ts.createWatchCompilerHost(
  "tsconfig.json",
  { noEmitOnError: true },
  ts.sys,
  ts.createSemanticDiagnosticsBuilderProgram,
  (diagnostic) =>
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext([diagnostic], format)),
  (diagnostic) => process.stdout.write(ts.formatDiagnostic(diagnostic, format))
);
const afterCompile = host.afterProgramCreate;
host.afterProgramCreate = (builder) => {
  afterCompile?.(builder);
  if (
    ts
      .getPreEmitDiagnostics(builder.getProgram())
      .some((d) => d.category === ts.DiagnosticCategory.Error)
  )
    return;
  restarting = restarting.then(async () => {
    await stopChild();
    if (stopping) return;
    const envFile = fileURLToPath(new URL("../.env", import.meta.url));
    const envArgs = existsSync(envFile) ? [`--env-file=${envFile}`] : [];
    child = spawn(process.execPath, [...envArgs, entry], { stdio: "inherit" });
    const launched = child;
    launched.on("error", (error) => console.error("Backend process failed:", error.message));
    launched.on("exit", (code) => {
      if (code && !stopping && child === launched)
        console.error(`Backend exited (${code}); save a source file to retry.`);
    });
  });
};
const watcher = ts.createWatchProgram(host);
async function shutdown() {
  if (stopping) return;
  stopping = true;
  watcher.close();
  await restarting;
  await stopChild();
  if (process.connected) process.disconnect();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// IPC lets the test request a graceful stop on Windows, where kill(SIGTERM)
// forcibly terminates the supervisor rather than delivering a catchable signal.
if (process.connected) {
  process.on("message", (message) => {
    if (message === "shutdown") void shutdown();
  });
  process.on("disconnect", shutdown);
}

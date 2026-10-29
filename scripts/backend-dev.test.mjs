import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { test } from "node:test";

test(
  "backend watcher emits constructor metadata, restarts after edits and refuses type errors",
  { timeout: 60000 },
  async () => {
    const appRoot = fileURLToPath(new URL("../apps/api/", import.meta.url));
    const fixture = await mkdtemp(`${appRoot}.dev-check-`);
    let child;
    let output = "";
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 20000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`Watcher deadline exceeded:\n${output}`);
        await new Promise((done) => setTimeout(done, 100));
      }
    };
    const source = (version) => `import "reflect-metadata";
function injectable(): ClassDecorator { return () => {}; }
class Dependency {}
@injectable()
class Service { constructor(readonly dependency: Dependency) {} }
console.log("READY-${version}", Reflect.getMetadata("design:paramtypes", Service)[0].name);
setInterval(() => {}, 1000);
`;
    try {
      await mkdir(`${fixture}/src`);
      await writeFile(`${fixture}/package.json`, '{"type":"module"}');
      await writeFile(
        `${fixture}/tsconfig.json`,
        JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            skipLibCheck: true,
            outDir: "dist",
            types: ["node"],
          },
          include: ["src/**/*.ts"],
        })
      );
      await writeFile(`${fixture}/src/main.ts`, source(1));
      child = spawn(
        process.execPath,
        [fileURLToPath(new URL("./backend-dev.mjs", import.meta.url)), "dist/main.js"],
        { cwd: fixture, stdio: ["ignore", "pipe", "pipe", "ipc"] }
      );
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.stderr.on("data", (data) => {
        output += data;
      });
      await waitFor(() => output.includes("READY-1 Dependency"));
      await writeFile(`${fixture}/src/main.ts`, `${source(2)}const invalid: number = "wrong";\n`);
      await waitFor(() => output.includes("TS2322"));
      assert.ok(!output.includes("READY-2"), "invalid source must never start");
      await writeFile(`${fixture}/src/main.ts`, source(3));
      await waitFor(() => output.includes("READY-3 Dependency"));
      const exited = new Promise((done) => child.once("exit", done));
      child.send("shutdown");
      await exited;
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((done) => child.once("exit", done));
        if (child.connected) child.send("shutdown");
        else child.kill("SIGTERM");
        await exited;
      }
      // Only the directory returned by mkdtemp, under the API workspace, is removed.
      assert.ok(resolve(fixture).startsWith(`${resolve(appRoot)}${sep}.dev-check-`));
      await rm(fixture, { recursive: true, force: true });
    }
  }
);

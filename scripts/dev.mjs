import { spawn } from "node:child_process";

const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Run this command with pnpm dev.");
let child;
let stopping = false;
function run(args) {
  return new Promise((done, reject) => {
    child = spawn(process.execPath, [pnpm, ...args], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => done(code ?? 1));
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    child?.kill(signal);
  });
}
// Build workspace dependencies before Nest loads them; no full Next production build needed.
const built = await run([
  "build",
  "--filter=@newsaas/api",
  "--filter=@newsaas/worker",
  "--filter=@newsaas/ui",
]);
process.exitCode = built;
// Local servers must inherit exported settings (including AWS/provider keys).
// Build/CI caching retains its normal strict environment contract.
if (built === 0 && !stopping) {
  process.exitCode = await run(["exec", "turbo", "run", "dev", "--env-mode=loose"]);
}

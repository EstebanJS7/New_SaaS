import { createEnvParser } from "@newsaas/config";
import { workerEnvSchema } from "./worker-env.schema.js";

export const workerEnv = createEnvParser(workerEnvSchema);

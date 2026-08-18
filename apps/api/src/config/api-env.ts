import { createEnvParser } from "@newsaas/config";
import { apiEnvSchema } from "./api-env.schema.js";

export const apiEnv = createEnvParser(apiEnvSchema);

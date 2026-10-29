export function assertCommercialDemoEnvironment(env: NodeJS.ProcessEnv): void {
  if (!["development", "test"].includes(env.NODE_ENV ?? "") || env.ENABLE_DEMO_SEED !== "true") {
    throw new Error("Commercial demo requires an explicit development/test opt-in.");
  }
  for (const key of ["FISCAL_PROVIDER", "EMAIL_PROVIDER", "WHATSAPP_PROVIDER"] as const) {
    if (env[key] && env[key] !== "fake") {
      throw new Error(`Commercial demo requires ${key}=fake or unset.`);
    }
  }
}

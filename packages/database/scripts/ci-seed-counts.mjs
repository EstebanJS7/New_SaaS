// CI probe helper for the migrations job: prints reference-data row counts as
// JSON so the workflow can assert seed idempotency by comparing two
// consecutive `db:seed` runs against the same fresh database.
import { PrismaClient } from "../src/generated/index.js";

const db = new PrismaClient();

try {
  const counts = {
    roles: await db.role.count(),
    permissions: await db.permission.count(),
    featureCodes: await db.featureCode.count(),
    plans: await db.plan.count(),
    rolePermissions: await db.rolePermission.count(),
    planCapabilities: await db.planCapability.count(),
  };
  console.log(JSON.stringify(counts));
} finally {
  await db.$disconnect();
}

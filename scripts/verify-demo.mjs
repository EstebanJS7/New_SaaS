import assert from "node:assert/strict";
import { PrismaClient, Prisma } from "../packages/database/dist/generated/index.js";
import { seedCommercialDemo } from "../apps/api/dist/src/dev/demo-commercial-seed.js";
import { assertCommercialDemoEnvironment } from "../apps/api/dist/src/dev/demo-environment.js";

// Explicitly invoked live integration check; requires db:demo first, never resets data.
process.env.ENABLE_DEMO_SEED = "true";
assertCommercialDemoEnvironment(process.env);
const db = new PrismaClient();
try {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: "demo" } });
  const delegates = [
    "catalogItem",
    "supplier",
    "purchase",
    "purchaseLine",
    "sale",
    "saleLine",
    "payment",
    "cashRegister",
    "cashSession",
    "cashMovement",
    "stockMovement",
    "stockBalance",
    "auditLog",
  ];
  const snapshot = async (where) => Promise.all(delegates.map((name) => db[name].count({ where })));
  const before = await snapshot({ tenantId: tenant.id });
  const otherTenants = await snapshot({ tenantId: { not: tenant.id } });
  await seedCommercialDemo();
  await seedCommercialDemo();
  assert.deepEqual(
    await snapshot({ tenantId: tenant.id }),
    before,
    "reruns must not add commercial rows or audit entries"
  );
  assert.deepEqual(
    await snapshot({ tenantId: { not: tenant.id } }),
    otherTenants,
    "other tenants must remain untouched"
  );
  const items = await db.catalogItem.findMany({
    where: { tenantId: tenant.id, name: { endsWith: "· DEMO" }, tracksStock: true },
  });
  assert.equal(items.length, 3);
  for (const item of items) {
    const movements = await db.stockMovement.aggregate({
      where: { tenantId: tenant.id, catalogItemId: item.id },
      _sum: { quantity: true },
    });
    const balance = await db.stockBalance.findUniqueOrThrow({
      where: { tenantId_catalogItemId: { tenantId: tenant.id, catalogItemId: item.id } },
    });
    assert.ok(
      balance.quantity.equals(movements._sum.quantity ?? new Prisma.Decimal(0)),
      "stock projection must equal the ledger"
    );
  }
  const register = await db.cashRegister.findFirstOrThrow({
    where: { tenantId: tenant.id, name: "Caja histórica · DEMO" },
  });
  const closed = await db.cashSession.findFirstOrThrow({
    where: { tenantId: tenant.id, registerId: register.id, status: "CLOSED" },
  });
  assert.ok(closed.expectedAmount.equals("300000"));
  assert.ok(closed.differenceAmount.isZero());
  const replay = await db.idempotencyRecord.findFirstOrThrow({
    where: { tenantId: tenant.id, key: "demo-commercial-sale-v1" },
  });
  const payments = await db.payment.aggregate({
    where: { tenantId: tenant.id, saleId: replay.resultSaleId },
    _sum: { amount: true },
    _count: true,
  });
  assert.equal(payments._count, 2);
  assert.ok(payments._sum.amount.equals("185000"));
  console.info(
    "PASS: two repeat runs, tenant isolation, stock ledger, mixed payments and cash close."
  );
} finally {
  await db.$disconnect();
}

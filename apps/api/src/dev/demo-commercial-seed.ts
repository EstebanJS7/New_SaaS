import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { NestFactory } from "@nestjs/core";
import { PrismaService } from "@newsaas/database";
import { AppModule } from "../app.module.js";
import { RequestContextService } from "../context/request-context.service.js";
import { CatalogService } from "../catalog/catalog.service.js";
import { SuppliersService } from "../suppliers/suppliers.service.js";
import { PurchasesService } from "../purchases/purchases.service.js";
import { SalesService } from "../sales/sales.service.js";
import { CashService } from "../cash/cash.service.js";
import { createCatalogItemBody } from "../catalog/catalog.zod.js";
import { createPurchaseBody } from "../purchases/purchases.zod.js";
import { createSaleBody, completeSaleBody } from "../sales/sales.zod.js";
import { assertCommercialDemoEnvironment } from "./demo-environment.js";

/** Local operator command only: no HTTP route, no balances or confirmed records written directly. */
export async function seedCommercialDemo(): Promise<void> {
  assertCommercialDemoEnvironment(process.env);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const db = app.get(PrismaService);
    const tenant = await db.tenant.findUnique({ where: { slug: "demo" } });
    if (!tenant) throw new Error("Run the base demo seed first.");
    const membership = await db.tenantMembership.findFirst({
      where: {
        tenantId: tenant.id,
        status: "ACTIVE",
        userProfile: { email: "owner@demo.newsaas.test" },
        role: { code: "OWNER" },
      },
      include: { role: true },
    });
    if (!membership) throw new Error("Active demo owner membership is required.");
    const context = app.get(RequestContextService);
    await context.run(randomUUID(), async () => {
      context.setUserProfileId(membership.userProfileId);
      context.setTenantMembership({
        tenantId: tenant.id,
        membershipId: membership.id,
        roleId: membership.roleId,
        roleCode: membership.role.code,
      });
      // A lock-only transaction serializes simultaneous seed runs. Domain commands
      // commit in their own authoritative transactions; interrupted runs are resumable.
      await db.$transaction(
        async (lock) => {
          await lock.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`demo-commercial:${tenant.id}`}, 0))`;
          const catalog = app.get(CatalogService);
          const suppliers = app.get(SuppliersService);
          const purchases = app.get(PurchasesService);
          const sales = app.get(SalesService);
          const cash = app.get(CashService);
          const tax = await db.taxRate.findUniqueOrThrow({ where: { code: "IVA_10" } });
          const registerName = "Caja histórica · DEMO";
          const openRegisterName = "Caja de práctica · DEMO";
          // CASH completion resolves ONE open session per tenant. Never close a
          // user's existing session just to make fixtures fit.
          const openSessions = await db.cashSession.findMany({
            where: { tenantId: tenant.id, status: "OPEN" },
            include: { register: true },
          });
          if (
            openSessions.some(
              (session) => ![registerName, openRegisterName].includes(session.register.name)
            )
          ) {
            throw new Error(
              "Close the tenant's non-demo cash sessions before seeding commercial examples."
            );
          }
          const fixtures = [
            { name: "Consulta general · DEMO", kind: "SERVICE", price: "120000" },
            { name: "Alimento balanceado 1 kg · DEMO", kind: "PRODUCT", price: "65000" },
            { name: "Vacuna de ejemplo · DEMO", kind: "MEDICATION", price: "85000" },
            { name: "Insumo de curación · DEMO", kind: "SUPPLY", price: "15000" },
          ] as const;
          const items: string[] = [];
          for (const fixture of fixtures) {
            const existing = await db.catalogItem.findFirst({
              where: { tenantId: tenant.id, name: fixture.name },
            });
            const item =
              existing ??
              (await catalog.create(
                createCatalogItemBody.parse({
                  name: fixture.name,
                  kind: fixture.kind,
                  taxRateId: tax.id,
                  referencePriceAmount: fixture.price,
                  referencePriceCurrency: "PYG",
                  lowStockThreshold: fixture.kind === "SERVICE" ? null : "5",
                })
              ));
            items.push(item.id);
          }
          const [consultation, food, vaccine, supply] = items;
          if (!consultation || !food || !vaccine || !supply)
            throw new Error("Incomplete demo catalog.");
          const supplierName = "Distribuidora de práctica · DEMO";
          const supplier =
            (await db.supplier.findFirst({ where: { tenantId: tenant.id, name: supplierName } })) ??
            (await suppliers.create({ name: supplierName }));
          const purchase =
            (await db.purchase.findFirst({
              where: { tenantId: tenant.id, supplierId: supplier.id },
              orderBy: { createdAt: "asc" },
            })) ??
            (await purchases.create(
              createPurchaseBody.parse({
                supplierId: supplier.id,
                lines: [
                  { catalogItemId: food, quantity: "20", unitCost: "40000" },
                  { catalogItemId: vaccine, quantity: "30", unitCost: "50000" },
                  { catalogItemId: supply, quantity: "50", unitCost: "8000" },
                ],
              })
            ));
          if (purchase.status === "DRAFT") await purchases.receive(purchase.id);

          const register =
            (await db.cashRegister.findFirst({
              where: { tenantId: tenant.id, name: registerName },
            })) ?? (await cash.createRegister({ name: registerName }));
          const session =
            (await db.cashSession.findFirst({
              where: { tenantId: tenant.id, registerId: register.id },
              orderBy: { createdAt: "asc" },
            })) ?? (await cash.openSession({ registerId: register.id, openingAmount: "200000" }));
          // Never re-open a closed historical fixture; leave the practice session untouched on reruns.
          const sale =
            (await db.sale.findFirst({
              where: { tenantId: tenant.id, lines: { some: { catalogItemId: consultation } } },
              orderBy: { createdAt: "asc" },
            })) ??
            (await sales.create(
              createSaleBody.parse({
                customerId: "11111111-1111-1111-1111-111111111111",
                lines: [
                  { catalogItemId: consultation, quantity: "1" },
                  { catalogItemId: food, quantity: "1" },
                ],
              })
            ));
          if (sale.status === "DRAFT") {
            if (session.status !== "OPEN" || openSessions.some((entry) => entry.id !== session.id))
              throw new Error("Demo sale needs only its historical cash session open.");
            await sales.complete(
              sale.id,
              completeSaleBody.parse({
                payments: [
                  { method: "CASH", amount: "100000" },
                  { method: "CARD", amount: "85000" },
                ],
              }),
              "demo-commercial-sale-v1"
            );
          }
          if (session.status === "OPEN")
            await cash.closeSession(session.id, { countedAmount: "300000" });
          const draft = await db.sale.findFirst({
            where: { tenantId: tenant.id, lines: { some: { catalogItemId: supply } } },
          });
          if (!draft)
            await sales.create(
              createSaleBody.parse({ lines: [{ catalogItemId: supply, quantity: "2" }] })
            );
          const practice =
            (await db.cashRegister.findFirst({
              where: { tenantId: tenant.id, name: openRegisterName },
            })) ?? (await cash.createRegister({ name: openRegisterName }));
          const priorPractice = await db.cashSession.findFirst({
            where: { tenantId: tenant.id, registerId: practice.id },
          });
          if (!priorPractice)
            await cash.openSession({ registerId: practice.id, openingAmount: "150000" });
          console.info(
            "Commercial demo ready: 4 catalog fixtures, supplier, received purchase, completed mixed-payment sale, draft sale and cash examples. Existing fixtures preserved."
          );
        },
        { timeout: 120_000, maxWait: 120_000 }
      );
    });
  } finally {
    await app.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedCommercialDemo().catch((error: unknown) => {
    console.error(
      "Commercial demo failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    process.exitCode = 1;
  });
}

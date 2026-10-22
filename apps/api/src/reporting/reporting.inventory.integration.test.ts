import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import {
  SEEDED_TAX_RATE_IDS,
  type IsolationDatabase,
} from "../../test/support/in-memory-database.js";
import {
  seedRbacActor,
  seedRoleWithKeys,
  type RbacActor,
} from "../../test/support/rbac-fixture.js";
import {
  REPORT_PERIOD_DATE_FORMAT_MESSAGE,
  REPORT_PERIOD_MISSING_MESSAGE,
} from "./report.period.js";
import {
  REPORT_PERIOD_QUERY_INVALID_MESSAGE,
  REPORT_QUERY_NOT_ALLOWED_MESSAGE,
  type LowStockReportResponse,
  type StockReportResponse,
} from "./reporting.dto.js";
import { REPORTING_PERMISSIONS } from "./reporting.permissions.js";

/**
 * The inventory reports of [[REP-005]] over the REAL guard chain and the
 * in-memory boundary: `GET /reports/stock` and `GET /reports/low-stock`.
 *
 * This is where the row-level boundaries are proven, because the fake actually
 * APPLIES the predicates the repository builds: the half-open `createdAt` window
 * of the stock report's ledger read, and tenant isolation across the projection,
 * the ledger and the catalog read.
 *
 * The range is always an explicit `from`/`to` pair: a preset resolves against the
 * live clock, and an assertion about "today" is not a test.
 */

interface ErrorDto {
  error: { code: string; message: string };
}

interface ReportTenant {
  id: string;
  actor: RbacActor;
}

interface InventoryFixture {
  /** Probing tenant: holds `reports.read`, owns the inventory the reports count. */
  a: ReportTenant;
  /** Foreign tenant: holds `reports.read` too, owns rows A must NEVER see. */
  b: ReportTenant;
  /** Tenant with NO threshold anywhere: the "nobody opted in" first-run state. */
  c: ReportTenant;
  /** Member of A whose role holds NO report permission (403 probe). */
  noPermission: RbacActor;
  createItem(
    owner: ReportTenant,
    options: {
      name: string;
      kind?: "PRODUCT" | "SERVICE" | "MEDICATION" | "SUPPLY";
      tracksStock?: boolean;
      lowStockThreshold?: string | null;
    }
  ): { id: string };
  /** Seeds the projection. `quantity` is the CURRENT balance, never a flow. */
  setBalance(owner: ReportTenant, catalogItemId: string, quantity: string): void;
  /** Appends one immutable ledger row at an explicit instant. */
  seedMovement(
    owner: ReportTenant,
    options: {
      catalogItemId: string;
      quantity: string;
      createdAt: Date;
    }
  ): { id: string };
}

/**
 * Three tenants with the same `reports.read` grant and one actor without it. No
 * entitlement is seeded for any of them, which is the point: [[DEC-062]] leaves
 * the report surface ungated by feature code.
 */
function seedInventory(db: IsolationDatabase): InventoryFixture {
  const suffix = randomUUID().slice(0, 8);

  function seedTenant(letter: string): ReportTenant {
    const tenant = db.prisma.tenant.create({
      data: { slug: `stock-${letter}-${suffix}`, name: `Stock ${letter.toUpperCase()}` },
    });
    const role = seedRoleWithKeys(db, `STOCK_${letter.toUpperCase()}_${suffix}`, "Stock", [
      REPORTING_PERMISSIONS.read,
    ]);
    const actor = seedRbacActor(db, {
      email: `stock-${letter}-${suffix}@isolation.test`,
      tenantId: tenant.id,
      roleId: role.role.id,
    });
    return { id: tenant.id, actor };
  }

  const a = seedTenant("a");
  const b = seedTenant("b");
  const c = seedTenant("c");

  const noPermissionRole = seedRoleWithKeys(db, `STOCK_NONE_${suffix}`, "Stock none", []);
  const noPermission = seedRbacActor(db, {
    email: `stock-none-${suffix}@isolation.test`,
    tenantId: a.id,
    roleId: noPermissionRole.role.id,
  });

  const createItem: InventoryFixture["createItem"] = (owner, options) =>
    db.prisma.catalogItem.create({
      data: {
        tenantId: owner.id,
        kind: options.kind ?? "SUPPLY",
        name: options.name,
        taxRateId: SEEDED_TAX_RATE_IDS.EXEMPT,
        tracksStock: options.tracksStock ?? true,
        // Omitted and `null` both mean "not monitored" (DEC-065).
        lowStockThreshold: options.lowStockThreshold ?? null,
      },
    });

  const setBalance: InventoryFixture["setBalance"] = (owner, catalogItemId, quantity) => {
    db.prisma.stockBalance.upsert({
      where: { tenantId_catalogItemId: { tenantId: owner.id, catalogItemId } },
      create: { tenantId: owner.id, catalogItemId, quantity },
      update: { quantity },
    });
  };

  const seedMovement: InventoryFixture["seedMovement"] = (owner, options) => {
    const created = db.prisma.stockMovement.create({
      data: {
        tenantId: owner.id,
        catalogItemId: options.catalogItemId,
        type: "ADJUSTMENT",
        quantity: options.quantity,
        reason: "Fixture movement",
      },
    });
    const stored = db.tables.stockMovements.get(created.id);
    if (stored === undefined) {
      throw new Error("The in-memory stock movement row was not stored.");
    }
    // `stock_movement` is append-only and immutable, so its creation instant IS
    // its business instant; the fixture dates it and the report reads that column.
    stored.createdAt = options.createdAt;
    return { id: created.id };
  };

  return { a, b, c, noPermission, createItem, setBalance, seedMovement };
}

/**
 * The range every period-shaped HTTP assertion uses: 2026-06-10 through
 * 2026-06-11 in Asunción (`-03`), the half-open instant range
 * `[2026-06-10T03:00Z, 2026-06-12T03:00Z)`.
 */
const PERIOD_QUERY = "from=2026-06-10&to=2026-06-11";
const FROM_INSTANT = "2026-06-10T03:00:00.000Z";
const TO_INSTANT = "2026-06-12T03:00:00.000Z";

const EXPECTED_PERIOD_ECHO = {
  preset: null,
  fromDate: "2026-06-10",
  toDate: "2026-06-11",
  timeZone: "America/Asuncion",
  fromInstant: FROM_INSTANT,
  toInstant: TO_INSTANT,
} as const;

describe("the inventory reports (REP-005)", () => {
  let booted: BootedTestApp;
  let fixture: InventoryFixture;

  /** Tenant A's items: the reports' subject. */
  let itemFeed: string;
  let itemVaccine: string;
  let itemSyringe: string;
  let itemAlcohol: string;
  let itemGrooming: string;
  /** Tenant B's item: the row A must never see. */
  let itemForeign: string;
  /** Tenant C's item: a balance with NO threshold. */
  let itemUnmonitored: string;

  beforeAll(async () => {
    booted = await bootTestApp();
    fixture = seedInventory(booted.db);

    itemFeed = fixture.createItem(fixture.a, { name: "Balanceado 10kg" }).id;
    itemVaccine = fixture.createItem(fixture.a, {
      name: "Vacuna antirrábica",
      kind: "PRODUCT",
      lowStockThreshold: "5.000",
    }).id;
    itemSyringe = fixture.createItem(fixture.a, {
      name: "Jeringa 5ml",
      lowStockThreshold: "2.000",
    }).id;
    itemAlcohol = fixture.createItem(fixture.a, {
      name: "Alcohol 500ml",
      // EXACTLY at its threshold: `<=` includes it, with a zero shortfall.
      lowStockThreshold: "6.000",
    }).id;
    itemGrooming = fixture.createItem(fixture.a, {
      name: "Baño medicado",
      kind: "SERVICE",
      tracksStock: false,
      // Even a threshold on a non-tracking item must not make it inventory.
      lowStockThreshold: "100.000",
    }).id;

    // The CURRENT balances: a snapshot, with no date and no history.
    fixture.setBalance(fixture.a, itemFeed, "10.000");
    fixture.setBalance(fixture.a, itemVaccine, "3.000");
    fixture.setBalance(fixture.a, itemSyringe, "0.000");
    fixture.setBalance(fixture.a, itemAlcohol, "6.000");
    fixture.setBalance(fixture.a, itemGrooming, "1.000");

    // The PERIOD's flow. The first row lands exactly on the INCLUSIVE start.
    fixture.seedMovement(fixture.a, {
      catalogItemId: itemFeed,
      quantity: "15.000",
      createdAt: new Date(FROM_INSTANT),
    });
    fixture.seedMovement(fixture.a, {
      catalogItemId: itemFeed,
      quantity: "-5.000",
      createdAt: new Date("2026-06-10T12:00:00.000Z"),
    });
    // EXCLUDED: exactly at the exclusive end, so it belongs to the NEXT period.
    fixture.seedMovement(fixture.a, {
      catalogItemId: itemFeed,
      quantity: "-2.000",
      createdAt: new Date(TO_INSTANT),
    });
    // EXCLUDED: before the period starts.
    fixture.seedMovement(fixture.a, {
      catalogItemId: itemFeed,
      quantity: "40.000",
      createdAt: new Date("2026-06-01T12:00:00.000Z"),
    });
    fixture.seedMovement(fixture.a, {
      catalogItemId: itemVaccine,
      quantity: "-1.000",
      createdAt: new Date("2026-06-10T15:00:00.000Z"),
    });
    fixture.seedMovement(fixture.a, {
      catalogItemId: itemSyringe,
      quantity: "-20.000",
      createdAt: new Date("2026-06-10T16:00:00.000Z"),
    });

    // Tenant B: its own balance, its own movement, its own item.
    itemForeign = fixture.createItem(fixture.b, {
      name: "Producto ajeno",
      lowStockThreshold: "99.000",
    }).id;
    fixture.setBalance(fixture.b, itemForeign, "1.000");
    fixture.seedMovement(fixture.b, {
      catalogItemId: itemForeign,
      quantity: "777.000",
      createdAt: new Date("2026-06-10T12:00:00.000Z"),
    });

    // Tenant C: not one threshold anywhere, so it is unmonitored by design.
    itemUnmonitored = fixture.createItem(fixture.c, { name: "Insumo sin umbral" }).id;
    fixture.setBalance(fixture.c, itemUnmonitored, "5.000");
  });

  afterAll(async () => {
    await booted.close();
  });

  describe("GET /reports/stock", () => {
    it("reports the CURRENT balance beside the PERIOD's flow, with the period echoed", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/stock?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as StockReportResponse;
      expect(body.report).toBe("stock");
      expect(body.period).toEqual(EXPECTED_PERIOD_ECHO);
      // Two different facts per row: `quantity` is a snapshot, the three flow
      // columns are the period. Ordered by name ascending.
      expect(body.rows).toEqual([
        {
          catalogItemId: itemAlcohol,
          name: "Alcohol 500ml",
          kind: "SUPPLY",
          quantity: "6.000",
          inbound: "0.000",
          outbound: "0.000",
          net: "0.000",
        },
        {
          catalogItemId: itemFeed,
          name: "Balanceado 10kg",
          kind: "SUPPLY",
          quantity: "10.000",
          // 15 in and 5 out: the -2 at `toInstant` and the +40 before the period
          // contribute to NONE of these.
          inbound: "15.000",
          outbound: "5.000",
          net: "10.000",
        },
        {
          catalogItemId: itemSyringe,
          name: "Jeringa 5ml",
          kind: "SUPPLY",
          // A zero balance is a fact, so the row is PRESENT.
          quantity: "0.000",
          inbound: "0.000",
          outbound: "20.000",
          net: "-20.000",
        },
        {
          catalogItemId: itemVaccine,
          name: "Vacuna antirrábica",
          kind: "PRODUCT",
          quantity: "3.000",
          inbound: "0.000",
          outbound: "1.000",
          net: "-1.000",
        },
      ]);
      // A quantity is not money: no currency label is resolved or invented.
      expect(Object.keys(body)).not.toContain("currency");
    });

    it("excludes a tracksStock=false item and every movement outside the period", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/stock?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as StockReportResponse;
      // The SERVICE has a balance AND a threshold and still appears nowhere.
      expect(body.rows.map((row) => row.catalogItemId)).not.toContain(itemGrooming);
      expect(JSON.stringify(body)).not.toContain("Baño medicado");
      // The +40 BEFORE the period and the -2 exactly at its exclusive end reach
      // no total: 15 in and 5 out is the whole of the period's flow for this item.
      const feed = body.rows.find((row) => row.catalogItemId === itemFeed);
      expect(feed).toMatchObject({ inbound: "15.000", outbound: "5.000", net: "10.000" });
    });

    it("counts a boundary movement in the NEXT period, not this one", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get("/reports/stock?from=2026-06-12&to=2026-06-12")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as StockReportResponse;
      expect(body.period.fromInstant).toBe("2026-06-12T03:00:00.000Z");
      // The -2 exactly at the previous period's exclusive end is the FIRST
      // movement of this one, and the balance is unchanged: still a snapshot.
      const feed = body.rows.find((row) => row.catalogItemId === itemFeed);
      expect(feed).toMatchObject({ quantity: "10.000", inbound: "0.000", outbound: "2.000" });
      expect(feed?.net).toBe("-2.000");
    });

    it("refuses a malformed period with the same stable messages as every report", async () => {
      const cases: readonly { label: string; query: string; message: string }[] = [
        { label: "no period", query: "", message: REPORT_PERIOD_MISSING_MESSAGE },
        {
          label: "malformed date",
          query: "from=2026-02-30&to=2026-03-01",
          message: REPORT_PERIOD_DATE_FORMAT_MESSAGE,
        },
        {
          label: "unknown key",
          query: `${PERIOD_QUERY}&tenantId=11111111-1111-4111-8111-111111111111`,
          message: REPORT_PERIOD_QUERY_INVALID_MESSAGE,
        },
      ];

      for (const scenario of cases) {
        const response = await supertest(booted.app.getHttpServer())
          .get(`/reports/stock?${scenario.query}`)
          .set("Cookie", fixture.a.actor.cookie)
          .expect(400);
        expect((response.body as ErrorDto).error.code, scenario.label).toBe("VALIDATION_FAILED");
        expect((response.body as ErrorDto).error.message, scenario.label).toBe(scenario.message);
      }
    });

    it("refuses without reports.read, before any row is read", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get(`/reports/stock?${PERIOD_QUERY}`)
        .set("Cookie", fixture.noPermission.cookie)
        .expect(403);

      expect((response.body as ErrorDto).error.code).toBe("FORBIDDEN");
      expect(JSON.stringify(response.body)).not.toContain("Balanceado 10kg");
      expect(JSON.stringify(response.body)).not.toContain("10.000");
    });

    it("requires authentication at all", async () => {
      await supertest(booted.app.getHttpServer()).get(`/reports/stock?${PERIOD_QUERY}`).expect(401);
    });
  });

  describe("GET /reports/low-stock", () => {
    it("returns the items at or below their own threshold, most depleted first", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get("/reports/low-stock")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const body = response.body as LowStockReportResponse;
      expect(body.report).toBe("low-stock");
      expect(body.thresholdsConfigured).toBe(true);
      // `shortfall` descending — Jeringa and Vacuna both at 2.000, so the tie is
      // broken by NAME ascending — then the item exactly at its threshold.
      expect(body.rows).toEqual([
        {
          catalogItemId: itemSyringe,
          name: "Jeringa 5ml",
          quantity: "0.000",
          threshold: "2.000",
          shortfall: "2.000",
        },
        {
          catalogItemId: itemVaccine,
          name: "Vacuna antirrábica",
          quantity: "3.000",
          threshold: "5.000",
          shortfall: "2.000",
        },
        {
          catalogItemId: itemAlcohol,
          name: "Alcohol 500ml",
          quantity: "6.000",
          threshold: "6.000",
          shortfall: "0.000",
        },
      ]);
      // A current-state view: no period echo and no currency.
      expect(Object.keys(body).sort()).toEqual(["report", "rows", "thresholdsConfigured"]);
      // The SERVICE has a threshold that would be "low" and is still absent,
      // because it does not track stock.
      expect(JSON.stringify(body)).not.toContain("Baño medicado");
      // Balanceado has a balance and NO threshold: never monitored, never listed.
      expect(JSON.stringify(body)).not.toContain("Balanceado 10kg");
    });

    it("reports thresholdsConfigured=false for a tenant where nobody opted in", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get("/reports/low-stock")
        .set("Cookie", fixture.c.actor.cookie)
        .expect(200);

      const body = response.body as LowStockReportResponse;
      // The item has a balance of 5.000 and NO threshold: NULL means "not
      // monitored" (DEC-065), so it is not low — it is unmeasured.
      expect(body).toEqual({ report: "low-stock", thresholdsConfigured: false, rows: [] });
      expect(JSON.stringify(body)).not.toContain(itemUnmonitored);
    });

    it("refuses ANY query key, so a period cannot be silently ignored", async () => {
      // A caller that sent `?from` would believe a period had been applied. Every
      // key — a period key, a preset, a typo, a tenant id — is the same refusal.
      const queries: readonly string[] = [
        "from=2026-06-10",
        "to=2026-06-11",
        "from=2026-06-10&to=2026-06-11",
        "preset=today",
        "tenantId=11111111-1111-4111-8111-111111111111",
      ];

      for (const query of queries) {
        const response = await supertest(booted.app.getHttpServer())
          .get(`/reports/low-stock?${query}`)
          .set("Cookie", fixture.a.actor.cookie)
          .expect(400);
        expect((response.body as ErrorDto).error.code, query).toBe("VALIDATION_FAILED");
        expect((response.body as ErrorDto).error.message, query).toBe(
          REPORT_QUERY_NOT_ALLOWED_MESSAGE
        );
      }
    });

    it("refuses without reports.read, before any row is read", async () => {
      const response = await supertest(booted.app.getHttpServer())
        .get("/reports/low-stock")
        .set("Cookie", fixture.noPermission.cookie)
        .expect(403);

      expect((response.body as ErrorDto).error.code).toBe("FORBIDDEN");
      expect(JSON.stringify(response.body)).not.toContain("Jeringa 5ml");
    });

    it("requires authentication at all", async () => {
      await supertest(booted.app.getHttpServer()).get("/reports/low-stock").expect(401);
    });
  });

  describe("tenant isolation", () => {
    it("never shows another tenant's balance, movement or item in the stock report", async () => {
      const foreign = await supertest(booted.app.getHttpServer())
        .get(`/reports/stock?${PERIOD_QUERY}`)
        .set("Cookie", fixture.b.actor.cookie)
        .expect(200);

      const foreignBody = foreign.body as StockReportResponse;
      expect(foreignBody.rows.map((row) => row.catalogItemId)).toEqual([itemForeign]);
      expect(foreignBody.rows[0]).toMatchObject({
        name: "Producto ajeno",
        quantity: "1.000",
        inbound: "777.000",
        net: "777.000",
      });

      const local = await supertest(booted.app.getHttpServer())
        .get(`/reports/stock?${PERIOD_QUERY}`)
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      // Neither B's item, nor its name, nor its movement quantity reaches A.
      expect(JSON.stringify(local.body)).not.toContain(itemForeign);
      expect(JSON.stringify(local.body)).not.toContain("Producto ajeno");
      expect(JSON.stringify(local.body)).not.toContain("777.000");
    });

    it("never shows another tenant's low-stock row", async () => {
      const foreign = await supertest(booted.app.getHttpServer())
        .get("/reports/low-stock")
        .set("Cookie", fixture.b.actor.cookie)
        .expect(200);

      const foreignBody = foreign.body as LowStockReportResponse;
      expect(foreignBody.rows).toHaveLength(1);
      expect(foreignBody.rows[0]).toMatchObject({
        catalogItemId: itemForeign,
        name: "Producto ajeno",
        quantity: "1.000",
        threshold: "99.000",
        shortfall: "98.000",
      });

      const local = await supertest(booted.app.getHttpServer())
        .get("/reports/low-stock")
        .set("Cookie", fixture.a.actor.cookie)
        .expect(200);

      const localBody = local.body as LowStockReportResponse;
      expect(localBody.rows.map((row) => row.catalogItemId)).toEqual([
        itemSyringe,
        itemVaccine,
        itemAlcohol,
      ]);
      expect(JSON.stringify(local.body)).not.toContain(itemForeign);
      expect(JSON.stringify(local.body)).not.toContain("Producto ajeno");
      expect(JSON.stringify(local.body)).not.toContain("98.000");
    });
  });
});

import { Controller, Get } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import { bootTestApp, type BootedTestApp } from "../../test/support/boot-test-app.js";
import { seedTwoTenants, type TwoTenantFixture } from "../../test/support/seed-two-tenants.js";
import { enumerateRouteContracts, type RouteContractEntry } from "./route-enumeration.js";
import { isPortalSurfacePath, isPublicExemptRoute } from "./route-contract.js";
import { SCHEDULING_PERMISSIONS } from "../scheduling/appointment.permissions.js";
import { PORTAL_ACCESS_PERMISSION } from "../portal/portal.constants.js";

/**
 * ROUTE-CONTRACT PROBE (EPIC-02 design D1, tasks 1.1/1.6/2.5).
 *
 * ACCESSOR DECISION (task 1.1 spike): DI-container traversal via
 * `enumerateRouteContracts` (see route-enumeration.ts). `printRoutes()`
 * parsing was REJECTED — it renders an ASCII glyph tree with auto-added HEAD
 * siblings whose textual reconstruction is fragile; find-my-way internals are
 * private. DI traversal yields structured {path, method, metadata} exactly as
 * `Reflector.getAllAndOverride` resolves them at request time.
 *
 * Three complementary fences:
 * 1. STATIC INVENTORY PIN: the enumerated route table must EQUAL the fully
    expected `METHOD path` set below — a new or removed route fails this suite
 *   by name until the contract is deliberately updated (review suggestion:
 *   pinning ALL routes instead of a 6-of-N sample closes the under-
 *   enumeration blind spot).
 * 2. STATIC CONTRACT BUCKETING: every registered route must be public-exempt
 *    (`@Public` or `/auth/*` via the SHARED predicate in route-contract.ts —
 *    the exact rules PermissionGuard applies at runtime), PORTAL-SURFACE
 *    (`/portal/*`, enforced by PortalAuthGuard instead of staff metadata) or
 *    DECLARED (permission metadata present, empty array included). Any
 *    violation fails naming the route.
 * 3. RUNTIME TWIN: a synthetic UNdeclared private route composed into the real
 *    AppModule returns a 403 FORBIDDEN envelope and its handler never runs —
 *    proving the guard actually sits in front of handlers (not merely that
 *    metadata is absent).
 *
 * Surface fence (task 2.5): the inventory must contain NO route that creates,
 * edits or deletes Role records or Permission catalog entries. The only
 * mutating route touching the RBAC tables is the tenant override command
 * (`PUT /rbac/roles/:code/permissions`) — it writes TENANT-LOCAL override
 * verdicts (DEC-003), never Role or Permission records themselves.
 */

interface ErrorEnvelopeBody {
  error: { code: string; message: string; requestId: string };
}

/**
 * The COMPLETE shipped API surface. Exact-set equality is the assertion: an
 * undeclared newcomer cannot hide, and a removal is as visible as an add.
 */
const EXPECTED_ROUTE_INVENTORY: readonly string[] = [
  "POST /auth/login",
  "POST /auth/logout",
  "GET /auth/me",
  "GET /health/live",
  "GET /health/ready",
  "GET /memberships",
  "GET /memberships/me/permissions",
  "GET /memberships/:id",
  "POST /memberships/:id/role",
  "GET /rbac/roles",
  "GET /rbac/permissions",
  "PUT /rbac/roles/:code/permissions",
  "GET /settings/:namespace",
  "PUT /settings/:namespace",
  // EPIC-03 Phase B — tenant branding
  "GET /branding/current",
  "PUT /branding/current",
  "POST /branding/reset",
  // DEC-004 — tenant branding assets
  "POST /branding/assets/:kind",
  "GET /branding/assets/:kind",
  "GET /branding/assets/:kind/content",
  "DELETE /branding/assets/:kind",
  "GET /api/v1/public/tenants/:slug/branding",
  "GET /api/v1/public/branding/assets/:kind/content",
  // EPIC-04 — customers
  "GET /customers",
  "POST /customers",
  "GET /customers/:id",
  "PUT /customers/:id",
  "POST /customers/:id/deactivate",
  "GET /customers/:customerId/addresses",
  "POST /customers/:customerId/addresses",
  "GET /customers/:customerId/addresses/:id",
  "PUT /customers/:customerId/addresses/:id",
  "POST /customers/:customerId/addresses/:id/deactivate",
  "GET /customers/:customerId/contacts",
  "POST /customers/:customerId/contacts",
  "GET /customers/:customerId/contacts/:id",
  "PUT /customers/:customerId/contacts/:id",
  "POST /customers/:customerId/contacts/:id/deactivate",
  // EPIC-05 — patients (WU3.2 reads + global catalog; WU3.3 commands; WU3.4 guardians)
  "GET /patients",
  "GET /patients/catalog",
  "GET /patients/:id",
  "POST /patients",
  "PUT /patients/:id",
  "POST /patients/:id/deactivate",
  "GET /patients/:patientId/guardians",
  "GET /patients/:patientId/guardians/:id",
  "POST /patients/:patientId/guardians",
  "PUT /patients/:patientId/guardians/:id",
  "POST /patients/:patientId/guardians/:id/primary",
  "POST /patients/:patientId/guardians/:id/deactivate",
  // EPIC-06 — clinical encounter lifecycle (WU3)
  "GET /patients/:patientId/clinical/encounters",
  "POST /patients/:patientId/clinical/encounters",
  "GET /patients/:patientId/clinical/encounters/:id",
  "PUT /patients/:patientId/clinical/encounters/:id",
  "POST /patients/:patientId/clinical/encounters/:id/close",
  "POST /patients/:patientId/clinical/encounters/:id/amendments",
  // EPIC-06 — clinical specialized records (WU3)
  "GET /patients/:patientId/clinical/treatments",
  "POST /patients/:patientId/clinical/treatments",
  "PUT /patients/:patientId/clinical/treatments/:id",
  "GET /patients/:patientId/clinical/vaccinations",
  "POST /patients/:patientId/clinical/vaccinations",
  "PUT /patients/:patientId/clinical/vaccinations/:id",
  "GET /patients/:patientId/clinical/deworming",
  "POST /patients/:patientId/clinical/deworming",
  "PUT /patients/:patientId/clinical/deworming/:id",
  "GET /patients/:patientId/clinical/studies",
  "POST /patients/:patientId/clinical/studies",
  "PUT /patients/:patientId/clinical/studies/:id",
  "GET /patients/:patientId/clinical/weights",
  "POST /patients/:patientId/clinical/weights",
  "PUT /patients/:patientId/clinical/weights/:id",
  // EPIC-07 — staff scheduling (WU3)
  "GET /appointments",
  "POST /appointments",
  "GET /appointments/options",
  "GET /appointments/availability",
  "GET /appointments/:id",
  "PUT /appointments/:id",
  "POST /appointments/:id/confirm",
  "POST /appointments/:id/arrive",
  "POST /appointments/:id/start",
  "POST /appointments/:id/complete",
  "POST /appointments/:id/cancel",
  "POST /appointments/:id/no-show",
  // EPIC-08 WU4B — staff booking-request decisions (OFF the /portal surface)
  "GET /booking-requests",
  "POST /booking-requests/:id/approve",
  "POST /booking-requests/:id/reject",
  // EPIC-08 — isolated portal identity surface + staff portal-access commands
  "POST /portal/login",
  "POST /portal/logout",
  "GET /portal/me",
  // EPIC-08 WU3 — holder-owned portal READ surface
  "GET /portal/pets",
  "GET /portal/pets/:id",
  "GET /portal/appointments",
  "GET /portal/appointments/:id",
  // DEC-007 A2a — holder-facing union availability read (no professional input)
  "GET /portal/availability",
  // EPIC-08 WU4A — holder booking-request command (PENDING only; no Appointment)
  "POST /portal/pets/:id/bookings",
  // EPIC-08 — holder-facing read of the holder's OWN booking requests
  "GET /portal/bookings",
  // EPIC-08 WU4C — holder profile self-service (own phone + address only)
  "GET /portal/profile",
  "PUT /portal/profile",
  "POST /customers/:customerId/portal-access",
  "POST /customers/:customerId/portal-access/revoke",
];

function isDeclared(entry: RouteContractEntry): boolean {
  return entry.permissions !== undefined;
}

/**
 * Exact granular permission every clinical route MUST declare (EPIC-06 WU3
 * review correction). The permission-less 403 sweep only proves that SOME key
 * is required; this map fails by name when a route is decorated with the wrong
 * `vet.clinical.*` key (e.g. autosave mapped to `read`), which a generic denial
 * can never catch.
 */
const CLINICAL_PERMISSION_BY_ROUTE: Readonly<Record<string, string>> = {
  "GET /patients/:patientId/clinical/encounters": "vet.clinical.read",
  "POST /patients/:patientId/clinical/encounters": "vet.clinical.create",
  "GET /patients/:patientId/clinical/encounters/:id": "vet.clinical.read",
  "PUT /patients/:patientId/clinical/encounters/:id": "vet.clinical.update",
  "POST /patients/:patientId/clinical/encounters/:id/close": "vet.clinical.close",
  "POST /patients/:patientId/clinical/encounters/:id/amendments": "vet.clinical.amend",
  "GET /patients/:patientId/clinical/treatments": "vet.clinical.read",
  "POST /patients/:patientId/clinical/treatments": "vet.clinical.create",
  "PUT /patients/:patientId/clinical/treatments/:id": "vet.clinical.update",
  "GET /patients/:patientId/clinical/vaccinations": "vet.clinical.read",
  "POST /patients/:patientId/clinical/vaccinations": "vet.clinical.create",
  "PUT /patients/:patientId/clinical/vaccinations/:id": "vet.clinical.update",
  "GET /patients/:patientId/clinical/deworming": "vet.clinical.read",
  "POST /patients/:patientId/clinical/deworming": "vet.clinical.create",
  "PUT /patients/:patientId/clinical/deworming/:id": "vet.clinical.update",
  "GET /patients/:patientId/clinical/studies": "vet.clinical.read",
  "POST /patients/:patientId/clinical/studies": "vet.clinical.create",
  "PUT /patients/:patientId/clinical/studies/:id": "vet.clinical.update",
  "GET /patients/:patientId/clinical/weights": "vet.clinical.read",
  "POST /patients/:patientId/clinical/weights": "vet.clinical.create",
  "PUT /patients/:patientId/clinical/weights/:id": "vet.clinical.update",
};

/**
 * Exact granular permission every scheduling route MUST declare (EPIC-07 WU3).
 * Pinned against the runtime `SCHEDULING_PERMISSIONS` constants so a route
 * decorated with the wrong tier (e.g. a lifecycle command mapped to `manage`)
 * fails by name, which a generic permission-less denial sweep cannot catch.
 */
const SCHEDULING_PERMISSION_BY_ROUTE: Readonly<Record<string, string>> = {
  "GET /appointments": SCHEDULING_PERMISSIONS.read,
  "GET /appointments/options": SCHEDULING_PERMISSIONS.read,
  // DEC-007 A1 — availability is a read, NOT a manage, route.
  "GET /appointments/availability": SCHEDULING_PERMISSIONS.read,
  "GET /appointments/:id": SCHEDULING_PERMISSIONS.read,
  "POST /appointments": SCHEDULING_PERMISSIONS.manage,
  "PUT /appointments/:id": SCHEDULING_PERMISSIONS.manage,
  "POST /appointments/:id/confirm": SCHEDULING_PERMISSIONS.transition,
  "POST /appointments/:id/arrive": SCHEDULING_PERMISSIONS.transition,
  "POST /appointments/:id/start": SCHEDULING_PERMISSIONS.transition,
  "POST /appointments/:id/complete": SCHEDULING_PERMISSIONS.transition,
  "POST /appointments/:id/cancel": SCHEDULING_PERMISSIONS.transition,
  "POST /appointments/:id/no-show": SCHEDULING_PERMISSIONS.transition,
  // EPIC-08 WU4B — staff booking-request decisions all require `manage`.
  "GET /booking-requests": SCHEDULING_PERMISSIONS.manage,
  "POST /booking-requests/:id/approve": SCHEDULING_PERMISSIONS.manage,
  "POST /booking-requests/:id/reject": SCHEDULING_PERMISSIONS.manage,
};

/**
 * Staff portal-access commands (EPIC-08 task 2.3). They live OFF the
 * `/portal/*` surface and must stay DECLARED on the staff chain with the
 * seeded `portal.access.manage` key — pinning the exact key fails by name if a
 * future edit weakens the declaration or wrongly fences the route as portal.
 */
const PORTAL_ACCESS_PERMISSION_BY_ROUTE: Readonly<Record<string, string>> = {
  "POST /customers/:customerId/portal-access": PORTAL_ACCESS_PERMISSION,
  "POST /customers/:customerId/portal-access/revoke": PORTAL_ACCESS_PERMISSION,
};

describe("route-contract probe (deny-by-default)", () => {
  let booted: BootedTestApp;
  let inventory: RouteContractEntry[];

  beforeAll(async () => {
    booted = await bootTestApp();
    inventory = enumerateRouteContracts(booted.app);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("enumerates EXACTLY the pinned route inventory (full-surface guard)", () => {
    const actual = inventory.map((entry) => `${entry.method} ${entry.path}`).sort();
    const expected = [...EXPECTED_ROUTE_INVENTORY].sort();
    // Symmetric diff names every surprise on BOTH sides.
    const unexpected = actual.filter((route) => !expected.includes(route));
    const missing = expected.filter((route) => !actual.includes(route));
    const report = [
      ...unexpected.map((route) => `UNDECLARED NEW ROUTE: ${route}`),
      ...missing.map((route) => `EXPECTED ROUTE MISSING: ${route}`),
    ];
    expect(report).toEqual([]);
  });

  it("maps EVERY clinical route to its intended granular vet.clinical.* permission", () => {
    const actualByRoute = new Map(
      inventory
        .filter((entry) => entry.path.startsWith("/patients/:patientId/clinical"))
        .map((entry) => [
          `${entry.method} ${entry.path}`,
          entry.permissions === undefined ? [] : [...entry.permissions],
        ])
    );
    const report: string[] = [];
    for (const [route, expected] of Object.entries(CLINICAL_PERMISSION_BY_ROUTE)) {
      const actual = actualByRoute.get(route);
      if (!actual) {
        report.push(`MISSING CLINICAL ROUTE: ${route}`);
      } else if (actual.length !== 1 || actual[0] !== expected) {
        report.push(
          `WRONG CLINICAL PERMISSION: ${route} expected [${expected}] got [${actual.join(", ")}]`
        );
      }
    }
    for (const route of actualByRoute.keys()) {
      if (!(route in CLINICAL_PERMISSION_BY_ROUTE)) {
        report.push(`UNDECLARED CLINICAL ROUTE: ${route}`);
      }
    }
    expect(report).toEqual([]);
  });

  it("maps EVERY scheduling route to its intended granular scheduling.appointment.* permission", () => {
    const actualByRoute = new Map(
      inventory
        .filter(
          (entry) =>
            entry.path.startsWith("/appointments") || entry.path.startsWith("/booking-requests")
        )
        .map((entry) => [
          `${entry.method} ${entry.path}`,
          entry.permissions === undefined ? [] : [...entry.permissions],
        ])
    );
    const report: string[] = [];
    for (const [route, expected] of Object.entries(SCHEDULING_PERMISSION_BY_ROUTE)) {
      const actual = actualByRoute.get(route);
      if (!actual) {
        report.push(`MISSING SCHEDULING ROUTE: ${route}`);
      } else if (actual.length !== 1 || actual[0] !== expected) {
        report.push(
          `WRONG SCHEDULING PERMISSION: ${route} expected [${expected}] got [${actual.join(", ")}]`
        );
      }
    }
    for (const route of actualByRoute.keys()) {
      if (!(route in SCHEDULING_PERMISSION_BY_ROUTE)) {
        report.push(`UNDECLARED SCHEDULING ROUTE: ${route}`);
      }
    }
    expect(report).toEqual([]);
  });

  it("buckets EVERY route as public-exempt, portal-surface, or declared — violations are named", () => {
    const violations = inventory.filter(
      (entry) =>
        !isPublicExemptRoute(entry) && !isPortalSurfacePath(entry.path) && !isDeclared(entry)
    );
    const named = violations.map(
      (entry) => `${entry.method} ${entry.path} (no @RequirePermissions/@Public)`
    );
    expect(named).toEqual([]);
  });

  it("declared routes carry string-array payloads (contract typing guard)", () => {
    for (const entry of inventory.filter(isDeclared)) {
      expect(Array.isArray(entry.permissions), `${entry.method} ${entry.path}`).toBe(true);
      for (const key of entry.permissions ?? []) {
        expect(typeof key).toBe("string");
      }
    }
  });
});

describe("surface fence — no catalog/role mutation routes (task 2.5)", () => {
  let booted: BootedTestApp;
  let inventory: RouteContractEntry[];

  beforeAll(async () => {
    booted = await bootTestApp();
    inventory = enumerateRouteContracts(booted.app);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("registers no POST/PATCH/DELETE against roles or permissions", () => {
    const offenders = inventory.filter(
      (entry) =>
        ["POST", "PATCH", "DELETE"].includes(entry.method) &&
        /^\/(rbac\/)?(roles|permissions)/.test(entry.path)
    );
    expect(offenders.map((entry) => `${entry.method} ${entry.path}`)).toEqual([]);
  });

  it("allows PUT ONLY for the role-permission mapping replace command", () => {
    const putRoutes = inventory.filter((entry) => entry.method === "PUT");
    const mappingReplace = putRoutes.filter((entry) =>
      /^\/rbac\/roles\/[^/]+\/permissions$/.test(entry.path)
    );
    expect(mappingReplace.map((entry) => entry.path)).toEqual(["/rbac/roles/:code/permissions"]);
    // Every OTHER PUT is foreign to the RBAC surface and unregulated here —
    // but any PUT addressing roles/permissions OUTSIDE the exact mapping
    // shape would be a catalog/role mutation surface:
    const rbacMutators = putRoutes.filter(
      (entry) => /roles|permissions/.test(entry.path) && !mappingReplace.includes(entry)
    );
    expect(rbacMutators.map((entry) => `${entry.method} ${entry.path}`)).toEqual([]);
  });
});

describe("portal surface fence (EPIC-08 task 2.3)", () => {
  let booted: BootedTestApp;
  let inventory: RouteContractEntry[];

  beforeAll(async () => {
    booted = await bootTestApp();
    inventory = enumerateRouteContracts(booted.app);
  });

  afterAll(async () => {
    await booted.close();
  });

  it("fences EXACTLY the /portal/* surface — the pinned portal inventory", () => {
    const portalRoutes = inventory.filter((entry) => isPortalSurfacePath(entry.path));
    const actual = portalRoutes.map((entry) => `${entry.method} ${entry.path}`).sort();
    expect(actual).toEqual([
      "GET /portal/appointments",
      "GET /portal/appointments/:id",
      "GET /portal/availability",
      "GET /portal/bookings",
      "GET /portal/me",
      "GET /portal/pets",
      "GET /portal/pets/:id",
      "GET /portal/profile",
      "POST /portal/login",
      "POST /portal/logout",
      "POST /portal/pets/:id/bookings",
      "PUT /portal/profile",
    ]);
    // The predicate is never satisfied by a near-miss path.
    for (const nearMiss of ["/portal", "/portal-access", "/customers/x/portal-access"]) {
      expect(isPortalSurfacePath(nearMiss), nearMiss).toBe(nearMiss === "/portal");
    }
  });

  it("keeps portal-surface routes free of staff permission metadata", () => {
    // Portal policy is enforced by PortalAuthGuard, not by @RequirePermissions.
    const offenders = inventory
      .filter((entry) => isPortalSurfacePath(entry.path) && entry.permissions !== undefined)
      .map((entry) => `${entry.method} ${entry.path}`);
    expect(offenders).toEqual([]);
  });

  it("keeps login the ONLY @Public portal route", () => {
    const publicPortal = inventory
      .filter((entry) => isPortalSurfacePath(entry.path) && entry.isPublic)
      .map((entry) => `${entry.method} ${entry.path}`)
      .sort();
    expect(publicPortal).toEqual(["POST /portal/login"]);
  });

  it("keeps the staff booking-request routes DECLARED and OFF the portal surface", () => {
    const report: string[] = [];
    for (const route of [
      "GET /booking-requests",
      "POST /booking-requests/:id/approve",
      "POST /booking-requests/:id/reject",
    ]) {
      const entry = inventory.find((row) => `${row.method} ${row.path}` === route);
      if (!entry) {
        report.push(`MISSING STAFF BOOKING-REQUEST ROUTE: ${route}`);
        continue;
      }
      if (isPortalSurfacePath(entry.path)) {
        report.push(`STAFF ROUTE WRONGLY FENCED AS PORTAL: ${route}`);
      }
      if (isPublicExemptRoute(entry)) {
        report.push(`STAFF ROUTE WRONGLY PUBLIC-EXEMPT: ${route}`);
      }
      if (entry.permissions?.length !== 1) {
        report.push(`UNDECLARED STAFF BOOKING-REQUEST ROUTE: ${route}`);
      }
    }
    expect(report).toEqual([]);
  });

  it("keeps the staff portal-access commands DECLARED and OFF the portal surface", () => {
    const report: string[] = [];
    for (const [route, expected] of Object.entries(PORTAL_ACCESS_PERMISSION_BY_ROUTE)) {
      const entry = inventory.find((row) => `${row.method} ${row.path}` === route);
      if (!entry) {
        report.push(`MISSING STAFF PORTAL-ACCESS ROUTE: ${route}`);
        continue;
      }
      const permissions = entry.permissions === undefined ? [] : [...entry.permissions];
      if (permissions.length !== 1 || permissions[0] !== expected) {
        report.push(
          `WRONG PERMISSION: ${route} expected [${expected}] got [${permissions.join(", ")}]`
        );
      }
      if (isPortalSurfacePath(entry.path)) {
        report.push(`STAFF ROUTE WRONGLY FENCED AS PORTAL: ${route}`);
      }
      if (isPublicExemptRoute(entry)) {
        report.push(`STAFF ROUTE WRONGLY PUBLIC-EXEMPT: ${route}`);
      }
    }
    expect(report).toEqual([]);
  });
});

describe("runtime twin — synthetic undeclared route is denied pre-handler", () => {
  const handlerSpy = vi.fn((): Record<string, boolean> => ({ touched: true }));

  @Controller("undeclared-private-probe")
  class UndeclaredProbeController {
    @Get()
    probe(): Record<string, boolean> {
      return handlerSpy();
    }
  }

  let booted: BootedTestApp;
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    booted = await bootTestApp({ extraControllers: [UndeclaredProbeController] });
    fixture = seedTwoTenants(booted.db);
  });

  afterAll(async () => {
    fixture.cleanup();
    await booted.close();
  });

  it("rejects WITH 403 FORBIDDEN even for a fully privileged member", async () => {
    const response = await supertest(booted.app.getHttpServer())
      .get("/undeclared-private-probe")
      .set("Cookie", fixture.actors.a.cookie)
      .expect(403);

    expect((response.body as ErrorEnvelopeBody).error.code).toBe("FORBIDDEN");
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});

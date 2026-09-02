import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { RequestContextService } from "../context/request-context.service.js";
import type { AuditAppendInput, AuditWriter } from "../audit/audit-writer.service.js";
import { CustomersService } from "./customers.service.js";
import type {
  CustomerRow,
  CustomerAddressRow,
  CustomerContactRow,
  CustomerDelegate,
  CustomerAddressDelegate,
  CustomerContactDelegate,
  CustomersPrisma,
} from "./customers.service.js";

describe("CustomersService", () => {
  let requestContext: RequestContextService;
  let appendMock: Mock<(input: AuditAppendInput) => Promise<{ id: string; action: string }>>;
  let audit: AuditWriter;
  let customers: Map<string, CustomerRow>;
  let addresses: Map<string, CustomerAddressRow>;
  let contacts: Map<string, CustomerContactRow>;
  let service: CustomersService;

  function withContext<T>(work: () => T): T {
    return requestContext.run("req-1", () => {
      requestContext.setUserProfileId("user-1");
      requestContext.setTenantMembership({
        tenantId: "tenant-1",
        membershipId: "mem-1",
        roleId: "role-1",
        roleCode: "OWNER",
      });
      return work();
    });
  }

  function makeService(): CustomersService {
    const customerDelegate: CustomerDelegate = {
      findMany: ({ where, orderBy }) => {
        let rows = [...customers.values()].filter(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            (where.isActive === undefined || candidate.isActive === where.isActive)
        );
        if (orderBy?.displayName) {
          rows = rows.sort((left, right) => left.displayName.localeCompare(right.displayName));
          if (orderBy.displayName === "desc") rows.reverse();
        }
        return Promise.resolve(rows);
      },
      findFirst: ({ where }) =>
        Promise.resolve(
          [...customers.values()].find(
            (candidate) => candidate.id === where.id && candidate.tenantId === where.tenantId
          ) ?? null
        ),
      create: ({ data }) => {
        const now = new Date();
        const payload = data as Omit<CustomerRow, "id" | "createdAt" | "updatedAt">;
        const created: CustomerRow = {
          id: `cust-${customers.size + 1}`,
          ...payload,
          isActive: payload.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        };
        customers.set(created.id, created);
        return Promise.resolve(created);
      },
      updateMany: ({ where, data }) => {
        const existing = customers.get(where.id);
        if (
          existing?.tenantId !== where.tenantId ||
          (where.isActive !== undefined && existing?.isActive !== where.isActive)
        ) {
          return Promise.resolve({ count: 0 });
        }
        if (data.displayName !== undefined) existing.displayName = data.displayName;
        if (data.legalName !== undefined) existing.legalName = data.legalName ?? null;
        if (data.taxId !== undefined) existing.taxId = data.taxId ?? null;
        if (data.firstName !== undefined) existing.firstName = data.firstName ?? null;
        if (data.lastName !== undefined) existing.lastName = data.lastName ?? null;
        if (data.documentNumber !== undefined)
          existing.documentNumber = data.documentNumber ?? null;
        if (data.isActive !== undefined) existing.isActive = data.isActive;
        existing.updatedAt = new Date();
        return Promise.resolve({ count: 1 });
      },
    };

    const addressDelegate: CustomerAddressDelegate = {
      findMany: ({ where }) =>
        Promise.resolve(
          [...addresses.values()].filter(
            (candidate) =>
              candidate.tenantId === where.tenantId &&
              candidate.customerId === where.customerId &&
              (where.isActive === undefined || candidate.isActive === where.isActive)
          )
        ),
      findFirst: ({ where }) =>
        Promise.resolve(
          [...addresses.values()].find(
            (candidate) =>
              candidate.id === where.id &&
              candidate.tenantId === where.tenantId &&
              candidate.customerId === where.customerId
          ) ?? null
        ),
      create: ({ data }) => {
        const now = new Date();
        const payload = data as Omit<CustomerAddressRow, "id" | "createdAt" | "updatedAt">;
        const created: CustomerAddressRow = {
          id: `addr-${addresses.size + 1}`,
          ...payload,
          isActive: payload.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        };
        addresses.set(created.id, created);
        return Promise.resolve(created);
      },
      updateMany: ({ where, data }) => {
        const existing = addresses.get(where.id);
        if (
          existing?.tenantId !== where.tenantId ||
          existing?.customerId !== where.customerId ||
          (where.isActive !== undefined && existing?.isActive !== where.isActive)
        ) {
          return Promise.resolve({ count: 0 });
        }
        if (data.label !== undefined) existing.label = data.label ?? null;
        if (data.line1 !== undefined) existing.line1 = data.line1 ?? null;
        if (data.line2 !== undefined) existing.line2 = data.line2 ?? null;
        if (data.city !== undefined) existing.city = data.city ?? null;
        if (data.state !== undefined) existing.state = data.state ?? null;
        if (data.postalCode !== undefined) existing.postalCode = data.postalCode ?? null;
        if (data.countryCode !== undefined) existing.countryCode = data.countryCode ?? null;
        if (data.isActive !== undefined) existing.isActive = data.isActive;
        existing.updatedAt = new Date();
        return Promise.resolve({ count: 1 });
      },
    };

    const contactDelegate: CustomerContactDelegate = {
      findMany: ({ where }) =>
        Promise.resolve(
          [...contacts.values()].filter(
            (candidate) =>
              candidate.tenantId === where.tenantId &&
              candidate.customerId === where.customerId &&
              (where.isActive === undefined || candidate.isActive === where.isActive)
          )
        ),
      findFirst: ({ where }) =>
        Promise.resolve(
          [...contacts.values()].find(
            (candidate) =>
              candidate.id === where.id &&
              candidate.tenantId === where.tenantId &&
              candidate.customerId === where.customerId
          ) ?? null
        ),
      create: ({ data }) => {
        const now = new Date();
        const payload = data as Omit<CustomerContactRow, "id" | "createdAt" | "updatedAt">;
        const created: CustomerContactRow = {
          id: `ctc-${contacts.size + 1}`,
          ...payload,
          isActive: payload.isActive ?? true,
          createdAt: now,
          updatedAt: now,
        };
        contacts.set(created.id, created);
        return Promise.resolve(created);
      },
      updateMany: ({ where, data }) => {
        const existing = contacts.get(where.id);
        if (
          existing?.tenantId !== where.tenantId ||
          existing?.customerId !== where.customerId ||
          (where.isActive !== undefined && existing?.isActive !== where.isActive)
        ) {
          return Promise.resolve({ count: 0 });
        }
        if (data.kind !== undefined) existing.kind = data.kind;
        if (data.label !== undefined) existing.label = data.label ?? null;
        if (data.value !== undefined) existing.value = data.value;
        if (data.isPrimary !== undefined) existing.isPrimary = data.isPrimary;
        if (data.isActive !== undefined) existing.isActive = data.isActive;
        existing.updatedAt = new Date();
        return Promise.resolve({ count: 1 });
      },
    };

    const prisma = {
      $transaction: async <T>(work: (tx: unknown) => Promise<T>) =>
        work({
          customer: customerDelegate,
          customerAddress: addressDelegate,
          customerContact: contactDelegate,
          auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
        }),
      customer: customerDelegate,
      customerAddress: addressDelegate,
      customerContact: contactDelegate,
    } as unknown as CustomersPrisma;

    return new CustomersService(prisma, requestContext, audit);
  }

  beforeEach(() => {
    requestContext = new RequestContextService();
    appendMock = vi
      .fn<(input: AuditAppendInput) => Promise<{ id: string; action: string }>>()
      .mockResolvedValue({ id: "audit-1", action: "customer.created" });
    audit = { append: appendMock } as unknown as AuditWriter;
    customers = new Map<string, CustomerRow>();
    addresses = new Map<string, CustomerAddressRow>();
    contacts = new Map<string, CustomerContactRow>();
    service = makeService();
  });

  it("creates an INDIVIDUAL customer", async () => {
    const result = await withContext(() =>
      service.create({
        kind: "INDIVIDUAL",
        displayName: "Ana García",
        firstName: "Ana",
        lastName: "García",
      })
    );
    expect(result.kind).toBe("INDIVIDUAL");
    expect(result.displayName).toBe("Ana García");
    expect(result.legalName).toBeNull();
    expect(result.taxId).toBeNull();
    expect(appendMock).toHaveBeenCalledTimes(1);
  });

  it("creates a COMPANY customer", async () => {
    const result = await withContext(() =>
      service.create({
        kind: "COMPANY",
        displayName: "Paws S.A.",
        legalName: "Paws Sociedad Anónima",
        taxId: "80012345-6",
      })
    );
    expect(result.kind).toBe("COMPANY");
    expect(result.legalName).toBe("Paws Sociedad Anónima");
    expect(result.firstName).toBeNull();
    expect(result.lastName).toBeNull();
    expect(appendMock).toHaveBeenCalledTimes(1);
  });

  it("lists only active customers by default", async () => {
    await withContext(() => service.create({ kind: "INDIVIDUAL", displayName: "Active Customer" }));
    const inactive = await withContext(() =>
      service.create({ kind: "INDIVIDUAL", displayName: "Inactive Customer" })
    );
    await withContext(() => service.deactivate(inactive.id));

    const list = await withContext(() => service.list());
    expect(list).toHaveLength(1);
    expect(list[0].displayName).toBe("Active Customer");
  });

  it("returns 404 for a cross-tenant customer", async () => {
    const foreign = await withContext(() =>
      service.create({ kind: "INDIVIDUAL", displayName: "Foreign" })
    );

    await expect(
      requestContext.run("req-2", () => {
        requestContext.setUserProfileId("user-2");
        requestContext.setTenantMembership({
          tenantId: "tenant-2",
          membershipId: "mem-2",
          roleId: "role-2",
          roleCode: "OWNER",
        });
        return service.get(foreign.id);
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects kind-mismatched updates", async () => {
    const customer = await withContext(() =>
      service.create({ kind: "INDIVIDUAL", displayName: "Ana" })
    );
    await expect(
      withContext(() => service.update(customer.id, { taxId: "123" }))
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("deactivates a customer idempotently", async () => {
    const customer = await withContext(() =>
      service.create({ kind: "INDIVIDUAL", displayName: "Ana" })
    );
    const first = await withContext(() => service.deactivate(customer.id));
    expect(first.isActive).toBe(false);

    appendMock.mockClear();
    const second = await withContext(() => service.deactivate(customer.id));
    expect(second.isActive).toBe(false);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock.mock.calls[0][0].metadata).toMatchObject({
      changedFields: [],
    });
  });

  it("audit metadata contains only IDs and field names, no PII", async () => {
    await withContext(() =>
      service.create({
        kind: "INDIVIDUAL",
        displayName: "Ana García",
        firstName: "Ana",
        lastName: "García",
      })
    );
    const appendCall = appendMock.mock.calls[0][0];
    expect(appendCall.targetType).toBe("customer");
    expect(appendCall.targetId).toMatch(/^cust-/);
    expect(appendCall.metadata).not.toHaveProperty("displayName");
    expect(appendCall.metadata).not.toHaveProperty("firstName");
  });

  it("returns an exact allowlisted customer DTO", async () => {
    const result = await withContext(() =>
      service.create({ kind: "INDIVIDUAL", displayName: "Ana" })
    );
    expect(Object.keys(result).sort()).toEqual(
      [
        "id",
        "tenantId",
        "kind",
        "displayName",
        "legalName",
        "taxId",
        "firstName",
        "lastName",
        "documentNumber",
        "isActive",
        "createdAt",
        "updatedAt",
      ].sort()
    );
  });

  it("co-commits exactly one audit row on update", async () => {
    const customer = await withContext(() =>
      service.create({ kind: "INDIVIDUAL", displayName: "Ana" })
    );
    appendMock.mockClear();

    await withContext(() => service.update(customer.id, { displayName: "Ana María" }));

    expect(appendMock).toHaveBeenCalledTimes(1);
    const appendCall = appendMock.mock.calls[0][0];
    expect(appendCall.action).toBe("customer.updated");
    expect(appendCall.targetId).toBe(customer.id);
    expect(appendCall.metadata).toMatchObject({ changedFields: ["displayName"] });
  });

  it("creates and deactivates an address", async () => {
    const customer = await withContext(() =>
      service.create({ kind: "INDIVIDUAL", displayName: "Ana" })
    );
    const address = await withContext(() =>
      service.createAddress(customer.id, {
        line1: "Calle Falsa 123",
        city: "Buenos Aires",
      })
    );
    expect(address.line1).toBe("Calle Falsa 123");

    const deactivated = await withContext(() => service.deactivateAddress(address.id, customer.id));
    expect(deactivated.isActive).toBe(false);
  });

  it("returns 404 for a cross-tenant address", async () => {
    const customer = await withContext(() =>
      service.create({ kind: "INDIVIDUAL", displayName: "Ana" })
    );
    const address = await withContext(() =>
      service.createAddress(customer.id, { line1: "Calle Falsa 123" })
    );

    await expect(
      requestContext.run("req-2", () => {
        requestContext.setUserProfileId("user-2");
        requestContext.setTenantMembership({
          tenantId: "tenant-2",
          membershipId: "mem-2",
          roleId: "role-2",
          roleCode: "OWNER",
        });
        return service.getAddress(address.id, customer.id);
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates and deactivates a contact", async () => {
    const customer = await withContext(() =>
      service.create({ kind: "INDIVIDUAL", displayName: "Ana" })
    );
    const contact = await withContext(() =>
      service.createContact(customer.id, { kind: "EMAIL", value: "ana@test.test" })
    );
    expect(contact.value).toBe("ana@test.test");

    const deactivated = await withContext(() => service.deactivateContact(contact.id, customer.id));
    expect(deactivated.isActive).toBe(false);
  });

  it("returns 404 for a cross-tenant contact", async () => {
    const customer = await withContext(() =>
      service.create({ kind: "INDIVIDUAL", displayName: "Ana" })
    );
    const contact = await withContext(() =>
      service.createContact(customer.id, { kind: "EMAIL", value: "ana@test.test" })
    );

    await expect(
      requestContext.run("req-2", () => {
        requestContext.setUserProfileId("user-2");
        requestContext.setTenantMembership({
          tenantId: "tenant-2",
          membershipId: "mem-2",
          roleId: "role-2",
          roleCode: "OWNER",
        });
        return service.getContact(contact.id, customer.id);
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects cross-tenant customer updates at the database write", async () => {
    const customer = await withContext(() =>
      service.create({ kind: "INDIVIDUAL", displayName: "Ana" })
    );

    await expect(
      requestContext.run("req-2", () => {
        requestContext.setUserProfileId("user-2");
        requestContext.setTenantMembership({
          tenantId: "tenant-2",
          membershipId: "mem-2",
          roleId: "role-2",
          roleCode: "OWNER",
        });
        return service.update(customer.id, { displayName: "Eve" });
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects cross-tenant customer deactivation at the database write", async () => {
    const customer = await withContext(() =>
      service.create({ kind: "INDIVIDUAL", displayName: "Ana" })
    );

    await expect(
      requestContext.run("req-2", () => {
        requestContext.setUserProfileId("user-2");
        requestContext.setTenantMembership({
          tenantId: "tenant-2",
          membershipId: "mem-2",
          roleId: "role-2",
          roleCode: "OWNER",
        });
        return service.deactivate(customer.id);
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

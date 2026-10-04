import { describe, expect, it } from "vitest";
import { InMemorySecretStore } from "./in-memory-secret-store.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";

describe("InMemorySecretStore", () => {
  it("stores and returns a value", async () => {
    const store = new InMemorySecretStore();
    await store.put({ tenantId: TENANT, key: "fsk_one", value: "value" });
    expect(await store.get({ tenantId: TENANT, key: "fsk_one" })).toBe("value");
  });

  it("scopes reads and writes by tenant", async () => {
    const store = new InMemorySecretStore();
    await store.put({ tenantId: TENANT, key: "fsk_one", value: "mine" });
    await store.put({ tenantId: OTHER_TENANT, key: "fsk_one", value: "theirs" });

    expect(await store.get({ tenantId: TENANT, key: "fsk_one" })).toBe("mine");
    expect(await store.get({ tenantId: OTHER_TENANT, key: "fsk_one" })).toBe("theirs");
    expect(
      await store.get({ tenantId: "33333333-3333-3333-3333-333333333333", key: "fsk_one" })
    ).toBeNull();
  });

  it("deletes idempotently", async () => {
    const store = new InMemorySecretStore();
    await store.put({ tenantId: TENANT, key: "fsk_one", value: "value" });

    await store.delete({ tenantId: TENANT, key: "fsk_one" });
    await store.delete({ tenantId: TENANT, key: "fsk_one" });

    expect(await store.get({ tenantId: TENANT, key: "fsk_one" })).toBeNull();
  });

  it("reports presence", async () => {
    const store = new InMemorySecretStore();
    expect(await store.has({ tenantId: TENANT, key: "fsk_one" })).toBe(false);
    await store.put({ tenantId: TENANT, key: "fsk_one", value: "value" });
    expect(await store.has({ tenantId: TENANT, key: "fsk_one" })).toBe(true);
    expect(await store.has({ tenantId: OTHER_TENANT, key: "fsk_one" })).toBe(false);
  });

  it("does not confuse a composite tenant and key collision", async () => {
    const store = new InMemorySecretStore();
    await store.put({ tenantId: "a", key: "b:c", value: "first" });
    await store.put({ tenantId: "a:b", key: "c", value: "second" });

    expect(await store.get({ tenantId: "a", key: "b:c" })).toBe("first");
    expect(await store.get({ tenantId: "a:b", key: "c" })).toBe("second");
  });
});

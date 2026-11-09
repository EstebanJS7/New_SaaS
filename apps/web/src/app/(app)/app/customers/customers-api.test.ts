import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCustomer,
  getCustomer,
  updateCustomer,
  CustomerRequestError,
  customerError,
  customerWriteBlocked,
} from "./customers-api";
afterEach(() => vi.unstubAllGlobals());
describe("Customer transport safety", () => {
  it.each([401, 403, 404, 400, 409, 500, 408])(
    "sanitizes HTTP %s without exposing server text",
    async (status) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Private name and SQL exception" } }), {
          status,
        })
      );
      vi.stubGlobal("fetch", fetch);
      const error = await createCustomer({ displayName: "Synthetic" }).catch((e) => e as unknown);
      expect(error).toBeInstanceOf(CustomerRequestError);
      expect(customerError(error)).not.toContain("Private");
      expect(customerWriteBlocked(error)).toBe([401, 403, 404, 500, 408].includes(status));
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );
  it("treats lost and malformed mutation acknowledgements as uncertain without replay", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(Error("network"))
      .mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    for (let i = 0; i < 2; i++) {
      const error = await updateCustomer("id", {}).catch((e) => e as unknown);
      expect(error).toMatchObject({ uncertain: true });
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("distinguishes a failed read from an uncertain command", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Error("private")));
    const error = await getCustomer("id").catch((e) => e as unknown);
    expect(error).toMatchObject({ uncertain: false });
  });
  it("preserves exact update body and no-store without adding keys or retries", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"id":"confirmed"}'));
    vi.stubGlobal("fetch", fetch);
    await updateCustomer("id", { firstName: "Ana" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual([
      "/api/customers/id",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: '{"firstName":"Ana"}',
        cache: "no-store",
      },
    ]);
  });
  it("carries an explicit fiscal declaration and never adds the field to an omission", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"id":"confirmed"}'))
      .mockResolvedValueOnce(new Response('{"id":"confirmed"}'));
    vi.stubGlobal("fetch", fetch);

    await createCustomer({
      kind: "COMPANY",
      displayName: "Paws S.A.",
      legalName: "Paws Sociedad Anónima",
      taxId: "80012345-6",
      fiscalOperationType: "B2G",
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: '{"kind":"COMPANY","displayName":"Paws S.A.","legalName":"Paws Sociedad Anónima","taxId":"80012345-6","fiscalOperationType":"B2G"}',
    });

    await updateCustomer("id", { displayName: "Paws S.A." });
    const omission = fetch.mock.calls[1]?.[1] as { body: string };
    expect(omission.body).toBe('{"displayName":"Paws S.A."}');
    expect(omission.body).not.toContain("fiscalOperationType");
  });
});

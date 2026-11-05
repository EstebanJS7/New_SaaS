import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWorkingBranches } from "./working-branches";

afterEach(() => vi.restoreAllMocks());

describe("fetchWorkingBranches (MB-002)", () => {
  it("reads the caller's branches through the memberships proxy", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ branches: [{ id: "b-1", name: "Casa central" }] }), {
          status: 200,
        })
      )
    );
    global.fetch = fetchMock;
    await expect(fetchWorkingBranches()).resolves.toEqual([{ id: "b-1", name: "Casa central" }]);
    expect(fetchMock).toHaveBeenCalledWith("/api/memberships/me/branches", { cache: "no-store" });
  });

  it("fails on an error answer instead of pretending there are no branches", async () => {
    global.fetch = vi.fn(() => Promise.resolve(new Response("{}", { status: 500 })));
    await expect(fetchWorkingBranches()).rejects.toThrow();
  });
});

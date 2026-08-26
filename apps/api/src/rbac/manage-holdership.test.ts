import { describe, expect, it } from "vitest";
import { lockActiveMembershipRows } from "./manage-holdership.js";

describe("lockActiveMembershipRows", () => {
  it("locks every active tenant membership without an admin-class filter", async () => {
    let queryText = "";
    let boundValues: unknown[] = [];

    await lockActiveMembershipRows(
      {
        $queryRaw: (query, ...values) => {
          queryText = query.join("");
          boundValues = values;
          return Promise.resolve([]);
        },
      },
      "tenant-a"
    );

    expect(queryText).toContain('FROM "tenant_membership"');
    expect(queryText).toContain('"tenant_id" = ');
    expect(queryText).toContain("\"status\" = 'ACTIVE'");
    expect(queryText).toContain('ORDER BY "id" ASC');
    expect(queryText).toContain("FOR UPDATE");
    expect(queryText).not.toContain('"role_id"');
    expect(boundValues).toEqual(["tenant-a"]);
  });
});

import { describe, expect, it } from "vitest";
import { withTimeout } from "./with-timeout.js";

describe("withTimeout", () => {
  it("resolves with the operation result when it settles in time", async () => {
    await expect(withTimeout(() => Promise.resolve("value"), 500, "probe")).resolves.toBe("value");
  });

  it("propagates the underlying rejection when the operation fails fast", async () => {
    const failure = new Error("boom");
    await expect(withTimeout(async () => Promise.reject(failure), 500, "probe")).rejects.toThrow(
      "boom"
    );
  });

  it("rejects with a labeled timeout error when the operation hangs", async () => {
    await expect(
      withTimeout(() => new Promise<string>(() => undefined), 20, "database")
    ).rejects.toThrow(/Dependency 'database' timed out after 20ms/);
  });

  it("does not leave the losing promise as an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", listener);

    try {
      // Operation times out first, then rejects late.
      await expect(
        withTimeout(
          () =>
            new Promise<string>((_resolve, reject) => {
              setTimeout(() => reject(new Error("late failure")), 60);
            }),
          10,
          "late"
        )
      ).rejects.toThrow(/timed out/);

      // Give the late rejection a chance to fire before asserting silence.
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });
});

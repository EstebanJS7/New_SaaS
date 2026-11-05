import { describe, expect, it } from "vitest";
import { forwardedForHeader } from "./forwarded-for";

describe("forwardedForHeader (DEC-093)", () => {
  it("passes on the address Caddy set, IPv4 or IPv6, single or listed", () => {
    expect(forwardedForHeader(new Headers({ "x-forwarded-for": "203.0.113.10" }))).toEqual({
      "x-forwarded-for": "203.0.113.10",
    });
    expect(
      forwardedForHeader(new Headers({ "x-forwarded-for": "2001:db8::1, 172.30.0.2" }))
    ).toEqual({ "x-forwarded-for": "2001:db8::1, 172.30.0.2" });
  });

  it("drops an absent, empty, oversized or non-address value", () => {
    expect(forwardedForHeader(new Headers())).toEqual({});
    expect(forwardedForHeader(undefined)).toEqual({});
    expect(forwardedForHeader(new Headers({ "x-forwarded-for": " " }))).toEqual({});
    expect(forwardedForHeader(new Headers({ "x-forwarded-for": "evil; x=y" }))).toEqual({});
    expect(forwardedForHeader(new Headers({ "x-forwarded-for": "unknown" }))).toEqual({});
    expect(
      forwardedForHeader(new Headers({ "x-forwarded-for": "1.1.1.1,".repeat(60) + "1.1.1.1" }))
    ).toEqual({});
  });
});

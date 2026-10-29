import { describe, expect, it } from "vitest";
import { safeStaffReturnPath, staffSignInPath } from "./staff-return-path";
const id = "11111111-1111-4111-8111-111111111111";
describe("safe staff return destinations", () => {
  it.each([
    "https://evil.test/app",
    "//evil.test/app",
    "/api/auth/logout",
    "/clinic/pets",
    "/app/../api",
    "/app/%2e%2e/login",
    "/application",
    "/app/unknown",
    "/app/\\evil",
    "/app/patients/not-a-uuid",
    undefined,
  ])("rejects %s", (value) => {
    expect(safeStaffReturnPath(value)).toBe("/app");
  });
  it("retains only UUID context and the known clinical anchor", () => {
    expect(
      safeStaffReturnPath(
        `/app/patients/${id}?encounter=${id}&appointment=${id}&notes=secret&tenantId=other#patient-clinical`
      )
    ).toBe(`/app/patients/${id}?appointment=${id}&encounter=${id}#patient-clinical`);
    expect(safeStaffReturnPath(`/app/sales/${id}?payment=secret#notes`)).toBe(`/app/sales/${id}`);
    expect(safeStaffReturnPath(`/app/patients/${id}?encounter=${id}&encounter=${id}`)).toBe(
      `/app/patients/${id}`
    );
  });
  it("retains sales history without search text or other query context", () => {
    expect(safeStaffReturnPath("/app/sales/history?q=Confidential&page=2#notes")).toBe(
      "/app/sales/history"
    );
    expect(safeStaffReturnPath("/app/patients/history")).toBe("/app");
  });
  it("builds only local sign-in links", () => {
    expect(staffSignInPath("https://evil.test")).toBe("/login");
    expect(
      new URL(staffSignInPath(`/app/sales/${id}`), "https://staff.invalid").searchParams.get(
        "returnTo"
      )
    ).toBe(`/app/sales/${id}`);
  });
});

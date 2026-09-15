/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  allowedTransitions,
  listAppointmentOptions,
  listAppointments,
  rescheduleAppointment,
  transitionAppointment,
  userFacingAgendaError,
  type Appointment,
} from "./agenda-api";

const APPOINTMENT_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";

const APPOINTMENT: Appointment = {
  id: APPOINTMENT_ID,
  tenantId: "tenant-a",
  branchId: BRANCH_ID,
  patientId: "33333333-3333-4333-8333-333333333333",
  professionalMembershipId: "44444444-4444-4444-8444-444444444444",
  status: "SCHEDULED",
  startAt: "2026-09-14T12:00:00.000Z",
  endAt: "2026-09-14T12:30:00.000Z",
  version: 1,
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function callInput(fetchMock: ReturnType<typeof vi.fn>, index: number): RequestInfo | URL {
  const call = fetchMock.mock.calls[index] as unknown as [RequestInfo | URL, RequestInit?];
  return call[0];
}

function callInit(fetchMock: ReturnType<typeof vi.fn>, index: number): RequestInit {
  const call = fetchMock.mock.calls[index] as unknown as [RequestInfo | URL, RequestInit];
  return call[1];
}

describe("agenda-api contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the list query string from the defined filters only", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([APPOINTMENT])));
    global.fetch = fetchMock;

    await expect(listAppointments()).resolves.toEqual([APPOINTMENT]);
    expect(resolveRequestUrl(callInput(fetchMock, 0))).toBe("/api/scheduling/appointments");

    await listAppointments({ branchId: BRANCH_ID, status: "CONFIRMED" });
    expect(resolveRequestUrl(callInput(fetchMock, 1))).toBe(
      `/api/scheduling/appointments?branchId=${BRANCH_ID}&status=CONFIRMED`
    );
  });

  it("requests the options and named-command paths", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(APPOINTMENT)));
    global.fetch = fetchMock;

    await listAppointmentOptions();
    expect(resolveRequestUrl(callInput(fetchMock, 0))).toBe("/api/scheduling/appointments/options");

    await transitionAppointment(APPOINTMENT_ID, "confirm");
    expect(resolveRequestUrl(callInput(fetchMock, 1))).toBe(
      `/api/scheduling/appointments/${APPOINTMENT_ID}/confirm`
    );
    expect(callInit(fetchMock, 1).method).toBe("POST");
  });

  it("PUTs the reschedule body with the optimistic version", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(APPOINTMENT)));
    global.fetch = fetchMock;

    await rescheduleAppointment(APPOINTMENT_ID, {
      startAt: "2026-09-14T13:00:00.000Z",
      endAt: "2026-09-14T13:30:00.000Z",
      version: 1,
    });

    expect(resolveRequestUrl(callInput(fetchMock, 0))).toBe(
      `/api/scheduling/appointments/${APPOINTMENT_ID}`
    );
    const init = callInit(fetchMock, 0);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      startAt: "2026-09-14T13:00:00.000Z",
      endAt: "2026-09-14T13:30:00.000Z",
      version: 1,
    });
  });

  it("surfaces the stable CONFLICT code on a 409 overlap", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "CONFLICT", message: "Overlaps another appointment." } }, 409)
      )
    );

    const error = (await transitionAppointment(APPOINTMENT_ID, "confirm").catch(
      (caught: unknown) => caught
    )) as ApiRequestError;

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.code).toBe("CONFLICT");
    expect(error.status).toBe(409);
  });

  it("rejects a malformed appointment id before any request", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    await expect(
      rescheduleAppointment("not-a-uuid", {
        startAt: APPOINTMENT.startAt,
        endAt: APPOINTMENT.endAt,
        version: 1,
      })
    ).rejects.toMatchObject({ code: "INVALID_IDENTIFIER" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps the stable error contract to UX copy", () => {
    expect(userFacingAgendaError(new ApiRequestError("FORBIDDEN", "Access denied", 403))).toBe(
      "You do not have permission to view the agenda."
    );
    expect(userFacingAgendaError(new ApiRequestError("UNAUTHENTICATED", "Auth", 401))).toBe(
      "You must be signed in to view the agenda."
    );
    expect(userFacingAgendaError(new Error("boom"))).toBe("boom");
  });

  it("exposes the legal lifecycle edges per status", () => {
    expect(allowedTransitions("SCHEDULED")).toEqual(["confirm", "cancel"]);
    expect(allowedTransitions("CANCELLED")).toEqual([]);
  });
});

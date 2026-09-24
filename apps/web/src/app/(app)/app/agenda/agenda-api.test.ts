/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  allowedTransitions,
  approveBookingRequest,
  getSchedulingSettings,
  listAppointmentOptions,
  listAppointments,
  listBookingRequests,
  rejectBookingRequest,
  rescheduleAppointment,
  transitionAppointment,
  userFacingAgendaError,
  userFacingBookingRequestError,
  type Appointment,
  type BookingRequest,
} from "./agenda-api";

const APPOINTMENT_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "99999999-9999-4999-8999-999999999999";
const MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";

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

const BOOKING_REQUEST: BookingRequest = {
  id: REQUEST_ID,
  patientId: "33333333-3333-4333-8333-333333333333",
  status: "PENDING",
  startAt: "2026-09-14T15:00:00.000Z",
  endAt: "2026-09-14T15:30:00.000Z",
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

  it("reads the scheduling namespace through the settings proxy and unwraps the envelope", async () => {
    const namespace = { conflictPolicy: "REJECT", availability: [], blocks: [] };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ settings: namespace })));
    global.fetch = fetchMock;

    await expect(getSchedulingSettings()).resolves.toEqual(namespace);
    expect(resolveRequestUrl(callInput(fetchMock, 0))).toBe("/api/settings/scheduling");
  });

  it("rejects a settings response without a namespace envelope", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({})));

    await expect(getSchedulingSettings()).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("accepts a namespace whose arrays carry contract-shaped entries", async () => {
    const namespace = {
      conflictPolicy: "ALLOW",
      availability: [
        {
          membershipId: MEMBERSHIP_ID,
          branchId: BRANCH_ID,
          weekday: 1,
          startMinute: 540,
          endMinute: 780,
        },
      ],
      blocks: [
        {
          membershipId: MEMBERSHIP_ID,
          branchId: BRANCH_ID,
          startsAt: "2026-09-14T13:00:00.000Z",
          endsAt: "2026-09-14T14:00:00.000Z",
        },
      ],
    };
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ settings: namespace })));

    await expect(getSchedulingSettings()).resolves.toEqual(namespace);
  });

  it("rejects every namespace that fails the scheduling settings shape contract", async () => {
    const window = {
      membershipId: MEMBERSHIP_ID,
      branchId: BRANCH_ID,
      weekday: 1,
      startMinute: 540,
      endMinute: 780,
    };
    const block = {
      membershipId: MEMBERSHIP_ID,
      branchId: BRANCH_ID,
      startsAt: "2026-09-14T13:00:00.000Z",
      endsAt: "2026-09-14T14:00:00.000Z",
    };
    // The `{ settings: {} }` case is the exact gap the runtime check closes: it
    // used to pass the non-null-object check and cast, then crash the mapping on
    // `settings.availability.filter(...)`.
    const cases: [string, unknown][] = [
      ["an empty namespace", {}],
      ["an unknown conflict policy", { conflictPolicy: "MAYBE", availability: [], blocks: [] }],
      ["a missing availability array", { conflictPolicy: "REJECT", blocks: [] }],
      ["a non-array blocks value", { conflictPolicy: "REJECT", availability: [], blocks: {} }],
      [
        "an availability entry with a non-integer weekday",
        { conflictPolicy: "REJECT", availability: [{ ...window, weekday: 1.5 }], blocks: [] },
      ],
      [
        "an availability entry whose end is not after its start",
        { conflictPolicy: "REJECT", availability: [{ ...window, endMinute: 540 }], blocks: [] },
      ],
      [
        "an availability entry missing a read field",
        {
          conflictPolicy: "REJECT",
          availability: [{ membershipId: MEMBERSHIP_ID, branchId: BRANCH_ID, weekday: 1 }],
          blocks: [],
        },
      ],
      [
        "a block entry with an unparseable instant",
        { conflictPolicy: "REJECT", availability: [], blocks: [{ ...block, startsAt: "soon" }] },
      ],
      [
        "a block entry whose end is not after its start",
        {
          conflictPolicy: "REJECT",
          availability: [],
          blocks: [{ ...block, endsAt: block.startsAt }],
        },
      ],
    ];

    for (const [label, namespace] of cases) {
      global.fetch = vi.fn(() => Promise.resolve(jsonResponse({ settings: namespace })));
      const error = await getSchedulingSettings().catch((caught: unknown) => caught);
      expect(error, label).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).code, label).toBe("MALFORMED_RESPONSE");
    }
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

describe("booking-request client contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs the booking-request list", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([BOOKING_REQUEST])));
    global.fetch = fetchMock;

    await expect(listBookingRequests()).resolves.toEqual([BOOKING_REQUEST]);
    expect(resolveRequestUrl(callInput(fetchMock, 0))).toBe("/api/scheduling/booking-requests");
    expect(callInit(fetchMock, 0).method).toBeUndefined();
  });

  it("POSTs an approval with EXACTLY the anchors when there is no override", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(APPOINTMENT)));
    global.fetch = fetchMock;

    await approveBookingRequest(REQUEST_ID, {
      branchId: BRANCH_ID,
      professionalMembershipId: MEMBERSHIP_ID,
    });

    expect(resolveRequestUrl(callInput(fetchMock, 0))).toBe(
      `/api/scheduling/booking-requests/${REQUEST_ID}/approve`
    );
    const init = callInit(fetchMock, 0);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      branchId: BRANCH_ID,
      professionalMembershipId: MEMBERSHIP_ID,
    });
  });

  it("POSTs an approval with an all-or-nothing slot override", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(APPOINTMENT)));
    global.fetch = fetchMock;

    await approveBookingRequest(REQUEST_ID, {
      branchId: BRANCH_ID,
      professionalMembershipId: MEMBERSHIP_ID,
      startAt: "2026-09-14T16:00:00.000Z",
      endAt: "2026-09-14T16:30:00.000Z",
    });

    expect(JSON.parse(callInit(fetchMock, 0).body as string)).toEqual({
      branchId: BRANCH_ID,
      professionalMembershipId: MEMBERSHIP_ID,
      startAt: "2026-09-14T16:00:00.000Z",
      endAt: "2026-09-14T16:30:00.000Z",
    });
  });

  it("POSTs a rejection with no body fields", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ ...BOOKING_REQUEST, status: "REJECTED" }))
    );
    global.fetch = fetchMock;

    await expect(rejectBookingRequest(REQUEST_ID)).resolves.toMatchObject({ status: "REJECTED" });
    expect(resolveRequestUrl(callInput(fetchMock, 0))).toBe(
      `/api/scheduling/booking-requests/${REQUEST_ID}/reject`
    );
    const init = callInit(fetchMock, 0);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("rejects a malformed request id before any decision request", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    await expect(
      approveBookingRequest("not-a-uuid", {
        branchId: BRANCH_ID,
        professionalMembershipId: MEMBERSHIP_ID,
      })
    ).rejects.toMatchObject({ code: "INVALID_IDENTIFIER" });
    await expect(rejectBookingRequest("not-a-uuid")).rejects.toMatchObject({
      code: "INVALID_IDENTIFIER",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps the decision error contract to non-committal 409 copy and specific other codes", () => {
    const conflict = userFacingBookingRequestError(
      new ApiRequestError("CONFLICT", "Overlaps another appointment.", 409)
    );
    // The overloaded 409 must not pick one cause nor claim the request is still
    // pending; it names the possibilities and reports the refresh.
    expect(conflict).toContain("may no longer be free");
    expect(conflict).toContain("may already have been decided");
    expect(conflict).toContain("refreshed");
    expect(conflict).not.toBe("Overlaps another appointment.");
    expect(userFacingBookingRequestError(new ApiRequestError("FORBIDDEN", "Denied", 403))).toBe(
      "You do not have permission to decide booking requests."
    );
    expect(userFacingBookingRequestError(new ApiRequestError("NOT_FOUND", "Gone", 404))).toBe(
      "The booking request, or the branch or professional you selected, could not be found."
    );
    expect(userFacingBookingRequestError(new Error("boom"))).toBe("boom");
  });
});

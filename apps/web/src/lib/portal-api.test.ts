/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  cancelPortalAppointment,
  cancelPortalBooking,
  createPortalBooking,
  getPortalMe,
  getPortalPet,
  getPortalProfile,
  isPortalConflictError,
  isPortalDeniedError,
  isPortalNotFoundError,
  listPortalAppointments,
  listPortalAvailability,
  listPortalBookings,
  listPortalPets,
  reschedulePortalAppointment,
  updatePortalProfile,
  userFacingPortalAppointmentCancelError,
  userFacingPortalAppointmentsError,
  userFacingPortalBookingCancelError,
  userFacingPortalError,
  userFacingPortalProfileError,
  userFacingPortalRescheduleError,
} from "./portal-api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [RequestInfo | URL, RequestInit] {
  return fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
}

describe("portal-api contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getPortalMe GETs /api/portal/me with cache: no-store and no method", async () => {
    const me = {
      portal: { portalAccessId: "access-1", customerId: "customer-1" },
      requestId: "r1",
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(me)));
    global.fetch = fetchMock;

    await expect(getPortalMe()).resolves.toEqual(me);

    const [input, init] = lastCall(fetchMock);
    expect(resolveRequestUrl(input)).toBe("/api/portal/me");
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
  });

  it("listPortalPets GETs /api/portal/pets with cache: no-store", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])));
    global.fetch = fetchMock;

    await expect(listPortalPets()).resolves.toEqual([]);

    const [input, init] = lastCall(fetchMock);
    expect(resolveRequestUrl(input)).toBe("/api/portal/pets");
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("getPortalPet GETs /api/portal/pets/:id with cache: no-store", async () => {
    const pet = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Rex",
      speciesId: "species-1",
      speciesName: "Dog",
      breedId: null,
      breedName: null,
      sex: "MALE",
      birthDate: null,
      isActive: true,
      clinical: { encounters: [], vaccinations: [] },
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(pet)));
    global.fetch = fetchMock;

    await expect(getPortalPet(pet.id)).resolves.toEqual(pet);

    const [input, init] = lastCall(fetchMock);
    expect(resolveRequestUrl(input)).toBe(`/api/portal/pets/${pet.id}`);
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("surfaces the stable error code and status on a 404", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "NOT_FOUND", message: "Portal pet was not found." } }, 404)
      )
    );
    global.fetch = fetchMock;

    const error = await getPortalPet("11111111-1111-4111-8111-111111111111").catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("NOT_FOUND");
    expect((error as ApiRequestError).status).toBe(404);
    expect(isPortalNotFoundError(error)).toBe(true);
    expect(isPortalDeniedError(error)).toBe(false);
  });

  it("classifies FORBIDDEN and FEATURE_NOT_ENTITLED as denied", () => {
    expect(isPortalDeniedError(new ApiRequestError("FORBIDDEN", "nope", 403))).toBe(true);
    expect(isPortalDeniedError(new ApiRequestError("FEATURE_NOT_ENTITLED", "nope", 403))).toBe(
      true
    );
    expect(isPortalDeniedError(new ApiRequestError("UNAUTHENTICATED", "nope", 401))).toBe(false);
    expect(isPortalDeniedError(new Error("boom"))).toBe(false);
  });
});

describe("portal booking client contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listPortalAvailability GETs /api/portal/availability with exactly the three allowed keys", async () => {
    const availability = {
      date: "2026-06-15",
      timeZone: "America/Asuncion",
      durationMinutes: 30,
      stepMinutes: 30,
      slots: [{ startAt: "2026-06-15T13:00:00.000Z", endAt: "2026-06-15T13:30:00.000Z" }],
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(availability)));
    global.fetch = fetchMock;

    await expect(
      listPortalAvailability({ date: "2026-06-15", durationMinutes: 30, stepMinutes: 30 })
    ).resolves.toEqual(availability);

    const [input, init] = lastCall(fetchMock);
    // The full query string is pinned: date + durationMinutes + stepMinutes and
    // NOTHING else (an extra key would be refused by the proxy boundary).
    expect(resolveRequestUrl(input)).toBe(
      "/api/portal/availability?date=2026-06-15&durationMinutes=30&stepMinutes=30"
    );
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
  });

  it("listPortalBookings GETs /api/portal/bookings and returns the envelope", async () => {
    const envelope = {
      timeZone: "America/Asuncion",
      bookings: [
        {
          id: "booking-1",
          patientId: "11111111-1111-4111-8111-111111111111",
          patientName: "Rex",
          status: "PENDING",
          startAt: "2026-06-15T13:00:00.000Z",
          endAt: "2026-06-15T13:30:00.000Z",
        },
      ],
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(envelope)));
    global.fetch = fetchMock;

    await expect(listPortalBookings()).resolves.toEqual(envelope);

    const [input, init] = lastCall(fetchMock);
    expect(resolveRequestUrl(input)).toBe("/api/portal/bookings");
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
  });

  it("createPortalBooking POSTs the chosen slot's exact Z-suffixed instants untouched", async () => {
    const petId = "11111111-1111-4111-8111-111111111111";
    const created = {
      id: "booking-1",
      patientId: petId,
      status: "PENDING",
      startAt: "2026-06-15T13:00:00.000Z",
      endAt: "2026-06-15T13:30:00.000Z",
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(created, 201)));
    global.fetch = fetchMock;

    await expect(
      createPortalBooking(petId, {
        startAt: "2026-06-15T13:00:00.000Z",
        endAt: "2026-06-15T13:30:00.000Z",
      })
    ).resolves.toEqual(created);

    const [input, init] = lastCall(fetchMock);
    expect(resolveRequestUrl(input)).toBe(`/api/portal/pets/${petId}/bookings`);
    expect(init.method).toBe("POST");
    expect(init).toMatchObject({ cache: "no-store" });
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    // The API DTO accepts `Z`-suffixed instants (`datetime({ offset: true })`),
    // so the availability value is forwarded verbatim — no reformatting.
    expect(JSON.parse(init.body as string)).toEqual({
      startAt: "2026-06-15T13:00:00.000Z",
      endAt: "2026-06-15T13:30:00.000Z",
    });
  });
});

describe("portal appointments client contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listPortalAppointments GETs /api/portal/appointments and returns the envelope", async () => {
    const envelope = {
      timeZone: "America/Asuncion",
      appointments: [
        {
          id: "appt-1",
          patientId: "11111111-1111-4111-8111-111111111111",
          patientName: "Rex",
          status: "SCHEDULED",
          startAt: "2026-06-15T13:00:00.000Z",
          endAt: "2026-06-15T13:30:00.000Z",
        },
      ],
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(envelope)));
    global.fetch = fetchMock;

    await expect(listPortalAppointments()).resolves.toEqual(envelope);

    const [input, init] = lastCall(fetchMock);
    expect(resolveRequestUrl(input)).toBe("/api/portal/appointments");
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
  });
});

describe("portal profile client contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const profile = {
    phone: "+595 21 555 1234",
    address: {
      label: "Home",
      line1: "Av. Mcal. Lopez 123",
      line2: null,
      city: "Asuncion",
      state: null,
      postalCode: "1209",
      countryCode: "PY",
    },
  };

  it("getPortalProfile GETs /api/portal/profile with cache: no-store and no method", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(profile)));
    global.fetch = fetchMock;

    await expect(getPortalProfile()).resolves.toEqual(profile);

    const [input, init] = lastCall(fetchMock);
    expect(resolveRequestUrl(input)).toBe("/api/portal/profile");
    expect(init).toMatchObject({ cache: "no-store" });
    expect(init.method).toBeUndefined();
  });

  it("updatePortalProfile PUTs /api/portal/profile with the strict phone/address body", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(profile)));
    global.fetch = fetchMock;

    await expect(
      updatePortalProfile({
        phone: "+595 21 555 1234",
        address: {
          line1: "Av. Mcal. Lopez 123",
          city: "Asuncion",
          postalCode: "1209",
          countryCode: "PY",
        },
      })
    ).resolves.toEqual(profile);

    const [input, init] = lastCall(fetchMock);
    expect(resolveRequestUrl(input)).toBe("/api/portal/profile");
    expect(init.method).toBe("PUT");
    expect(init).toMatchObject({ cache: "no-store" });
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    // Exactly the two top-level keys and the seven address keys: an extra key
    // (email, name, kind, tax data, identity) is a 400 from the API's
    // `.strict()` schema, so the client never adds one.
    expect(JSON.parse(init.body as string)).toEqual({
      phone: "+595 21 555 1234",
      address: {
        line1: "Av. Mcal. Lopez 123",
        city: "Asuncion",
        postalCode: "1209",
        countryCode: "PY",
      },
    });
  });

  it("updatePortalProfile sends only the supplied keys, never undefined ones", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(profile)));
    global.fetch = fetchMock;

    await updatePortalProfile({ phone: "555-0000" });

    const [, init] = lastCall(fetchMock);
    // `address` is absent, so the API leaves the stored address untouched
    // instead of receiving an `undefined` key it can only reject or ignore.
    expect(JSON.parse(init.body as string)).toEqual({ phone: "555-0000" });
  });

  it("updatePortalProfile sends an explicit null to clear a field", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ phone: null, address: null })));
    global.fetch = fetchMock;

    await updatePortalProfile({ phone: null, address: null });

    const [, init] = lastCall(fetchMock);
    // `null` is a deliberate clear and must survive JSON serialization; an
    // absent key would instead leave the stored value untouched.
    expect(JSON.parse(init.body as string)).toEqual({ phone: null, address: null });
  });

  it("surfaces the stable code on a profile PUT refusal", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "VALIDATION_FAILED", message: "Invalid body." } }, 400)
      )
    );
    global.fetch = fetchMock;

    const error = await updatePortalProfile({ phone: "555-0000" }).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).code).toBe("VALIDATION_FAILED");
    expect((error as ApiRequestError).status).toBe(400);
  });
});

describe("portal appointment command client contract (DEC-007 A2d)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cancelPortalBooking POSTs /api/portal/bookings/:id/cancel with cache: no-store", async () => {
    const cancelled = {
      id: "booking-1",
      patientId: "11111111-1111-4111-8111-111111111111",
      status: "CANCELLED",
      startAt: "2026-06-15T13:00:00.000Z",
      endAt: "2026-06-15T13:30:00.000Z",
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(cancelled)));
    global.fetch = fetchMock;

    await expect(cancelPortalBooking("booking-1")).resolves.toEqual(cancelled);

    const [input, init] = lastCall(fetchMock);
    expect(resolveRequestUrl(input)).toBe("/api/portal/bookings/booking-1/cancel");
    expect(init.method).toBe("POST");
    expect(init).toMatchObject({ cache: "no-store" });
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("cancelPortalAppointment POSTs /api/portal/appointments/:id/cancel", async () => {
    const cancelled = {
      id: "appt-1",
      patientId: "11111111-1111-4111-8111-111111111111",
      status: "CANCELLED",
      startAt: "2026-06-15T13:00:00.000Z",
      endAt: "2026-06-15T13:30:00.000Z",
      version: 2,
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(cancelled)));
    global.fetch = fetchMock;

    await expect(cancelPortalAppointment("appt-1")).resolves.toEqual(cancelled);

    const [input, init] = lastCall(fetchMock);
    expect(resolveRequestUrl(input)).toBe("/api/portal/appointments/appt-1/cancel");
    expect(init.method).toBe("POST");
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("reschedulePortalAppointment PUTs the exact slot instants plus the read version", async () => {
    const moved = {
      id: "appt-1",
      patientId: "11111111-1111-4111-8111-111111111111",
      status: "SCHEDULED",
      startAt: "2026-06-16T13:00:00.000Z",
      endAt: "2026-06-16T13:30:00.000Z",
      version: 2,
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(moved)));
    global.fetch = fetchMock;

    await expect(
      reschedulePortalAppointment("appt-1", {
        startAt: "2026-06-16T13:00:00.000Z",
        endAt: "2026-06-16T13:30:00.000Z",
        version: 1,
      })
    ).resolves.toEqual(moved);

    const [input, init] = lastCall(fetchMock);
    expect(resolveRequestUrl(input)).toBe("/api/portal/appointments/appt-1");
    expect(init.method).toBe("PUT");
    expect(init).toMatchObject({ cache: "no-store" });
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    // The chosen slot's instants go out verbatim AND the optimistic guard is
    // sent; without `version` the API can never accept the move.
    expect(JSON.parse(init.body as string)).toEqual({
      startAt: "2026-06-16T13:00:00.000Z",
      endAt: "2026-06-16T13:30:00.000Z",
      version: 1,
    });
  });
});

describe("userFacingPortalError", () => {
  it("never echoes the server message text for a known or unknown code", () => {
    const known = new ApiRequestError("NOT_FOUND", "Portal pet was not found.", 404);
    expect(userFacingPortalError(known)).not.toContain("Portal pet was not found.");

    const unknown = new ApiRequestError("SOMETHING_NEW", "raw upstream detail", 500);
    const copy = userFacingPortalError(unknown);
    expect(copy).not.toContain("raw upstream detail");
    expect(copy).toBe("Something went wrong. Please try again.");
  });

  it("maps denied codes to distinct copy", () => {
    expect(userFacingPortalError(new ApiRequestError("FORBIDDEN", "x", 403))).toBe(
      "You do not have access to this portal."
    );
    expect(userFacingPortalError(new ApiRequestError("FEATURE_NOT_ENTITLED", "x", 403))).toBe(
      "The client portal is not available for this clinic."
    );
  });

  it("treats a masked not-found as uncertain rather than claiming the pet exists elsewhere", () => {
    const copy = userFacingPortalError(new ApiRequestError("NOT_FOUND", "x", 404));
    expect(copy).toContain("may not exist");
    expect(copy).toContain("may not be linked to your account");
  });

  it("maps a 409 to cause-neutral copy naming both masked possibilities", () => {
    const copy = userFacingPortalError(new ApiRequestError("CONFLICT", "raw conflict detail", 409));
    expect(copy).not.toContain("raw conflict detail");
    // The create command performs no conflict check today, so the copy must not
    // name a cause: a wrong cause is worse than none.
    expect(copy).not.toContain("taken");
    expect(copy).not.toContain("decided");
    expect(copy).toContain("refresh");
  });

  it("maps the appointments not-found without borrowing the pet wording", () => {
    const copy = userFacingPortalAppointmentsError(
      new ApiRequestError("NOT_FOUND", "raw upstream detail", 404)
    );
    expect(copy).toContain("appointment");
    // The appointments surface is not a single pet; never reuse the pet copy.
    expect(copy).not.toContain("pet");
    expect(copy).toContain("may not exist");
    expect(copy).toContain("may not be linked to your account");
    expect(copy).not.toContain("raw upstream detail");
  });

  it("delegates every other appointments code to the shared copy", () => {
    expect(userFacingPortalAppointmentsError(new ApiRequestError("FORBIDDEN", "x", 403))).toBe(
      "You do not have access to this portal."
    );
    expect(userFacingPortalAppointmentsError(new ApiRequestError("INTERNAL", "x", 500))).toBe(
      "Something went wrong. Please try again."
    );
  });

  it("classifies only a CONFLICT as a command precondition failure", () => {
    expect(isPortalConflictError(new ApiRequestError("CONFLICT", "x", 409))).toBe(true);
    expect(isPortalConflictError(new ApiRequestError("NOT_FOUND", "x", 404))).toBe(false);
    expect(isPortalConflictError(new Error("boom"))).toBe(false);
  });

  it("names the decided-request cause for a booking-cancel 409 and never echoes the server", () => {
    const copy = userFacingPortalBookingCancelError(
      new ApiRequestError("CONFLICT", "Only a pending booking request can be cancelled.", 409)
    );
    // The cancel command IS a PENDING compare-and-set, so this cause is known.
    expect(copy).toContain("already have been decided");
    expect(copy).toContain("refreshed");
    expect(copy).not.toContain("Only a pending booking request can be cancelled.");
  });

  it("names the request, not a pet, for a masked booking-cancel not-found", () => {
    const copy = userFacingPortalBookingCancelError(
      new ApiRequestError("NOT_FOUND", "raw upstream detail", 404)
    );
    expect(copy).toContain("request");
    expect(copy).not.toContain("pet");
    expect(copy).not.toContain("raw upstream detail");
  });

  it("names the changed-appointment cause for an appointment-cancel 409", () => {
    const copy = userFacingPortalAppointmentCancelError(
      new ApiRequestError("CONFLICT", "Cannot cancel an appointment in status COMPLETED.", 409)
    );
    expect(copy).toContain("may have already changed");
    expect(copy).toContain("cancellable");
    expect(copy).toContain("refreshed");
    expect(copy).not.toContain("Cannot cancel an appointment in status COMPLETED.");
  });

  it("names both causes the move command checks for a 409", () => {
    const copy = userFacingPortalRescheduleError(
      new ApiRequestError("CONFLICT", "The appointment was updated by another writer.", 409)
    );
    expect(copy).toContain("may no longer be free");
    expect(copy).toContain("may have changed");
    expect(copy).toContain("refreshed");
    expect(copy).not.toContain("The appointment was updated by another writer.");
  });

  it("reuses the appointment not-found wording for cancelled or moved appointments", () => {
    const missing = new ApiRequestError("NOT_FOUND", "raw detail", 404);
    expect(userFacingPortalAppointmentCancelError(missing)).toContain("appointment");
    expect(userFacingPortalRescheduleError(missing)).toContain("appointment");
    expect(userFacingPortalAppointmentCancelError(missing)).not.toContain("pet");
  });

  it("delegates every other command code to the shared copy", () => {
    const forbidden = new ApiRequestError("FORBIDDEN", "x", 403);
    expect(userFacingPortalBookingCancelError(forbidden)).toBe(
      "You do not have access to this portal."
    );
    expect(userFacingPortalAppointmentCancelError(forbidden)).toBe(
      "You do not have access to this portal."
    );
    expect(userFacingPortalRescheduleError(new ApiRequestError("INTERNAL", "x", 500))).toBe(
      "Something went wrong. Please try again."
    );
  });
});

describe("userFacingPortalProfileError", () => {
  it("keeps a masked profile not-found cause-neutral and never borrows the pet wording", () => {
    const copy = userFacingPortalProfileError(
      new ApiRequestError("NOT_FOUND", "the session customer was not resolved upstream", 404)
    );
    // The profile masks "not yours" and "nothing to resolve" as the same 404,
    // so the copy names both possibilities instead of asserting one.
    expect(copy).toContain("profile");
    expect(copy).toContain("may not exist yet");
    expect(copy).toContain("may not be linked to your account");
    expect(copy).not.toContain("pet");
    expect(copy).not.toContain("the session customer was not resolved upstream");
  });

  it("maps a validation failure without echoing which internal rule fired", () => {
    const copy = userFacingPortalProfileError(
      new ApiRequestError("VALIDATION_FAILED", "Invalid profile update body.", 400)
    );
    expect(copy).toContain("not accepted");
    expect(copy).not.toContain("Invalid profile update body.");
  });

  it("delegates denied and unknown codes to the shared copy", () => {
    expect(userFacingPortalProfileError(new ApiRequestError("FORBIDDEN", "x", 403))).toBe(
      "You do not have access to this portal."
    );
    expect(userFacingPortalProfileError(new ApiRequestError("INTERNAL", "x", 500))).toBe(
      "Something went wrong. Please try again."
    );
  });
});

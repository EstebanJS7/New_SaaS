import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PortalProfileView } from "./portal-profile";

function TestWrapper({ children }: { readonly children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

type Call = [RequestInfo | URL, RequestInit];

function calls(fetchMock: ReturnType<typeof vi.fn>): Call[] {
  return fetchMock.mock.calls as unknown as Call[];
}

function writes(fetchMock: ReturnType<typeof vi.fn>): Call[] {
  return calls(fetchMock).filter(([, init]) => init?.method === "PUT");
}

const EMPTY_PROFILE = { phone: null, address: null };

const FULL_PROFILE = {
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

function renderView(): void {
  render(
    <TestWrapper>
      <PortalProfileView />
    </TestWrapper>
  );
}

/** Fetch double that answers the profile read and (optionally) the PUT by URL. */
function routeFetch(routes: {
  readonly profile: { readonly body: unknown; readonly status?: number };
  readonly save?: { readonly body: unknown; readonly status?: number; readonly pending?: boolean };
}): ReturnType<typeof vi.fn> {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "PUT") {
      const save = routes.save ?? { body: FULL_PROFILE };
      if (save.pending) {
        return new Promise<Response>(() => undefined);
      }
      return Promise.resolve(jsonResponse(save.body, save.status));
    }
    return Promise.resolve(jsonResponse(routes.profile.body, routes.profile.status));
  });
}

describe("PortalProfileView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state while the read is in flight", () => {
    // A never-resolving read keeps the query in its loading state.
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderView();

    const loading = screen.getByTestId("portal-profile-loading");
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute("role", "status");
  });

  it("treats an empty profile as a normal state, not an error", async () => {
    global.fetch = routeFetch({ profile: { body: EMPTY_PROFILE } });

    renderView();

    expect(await screen.findByTestId("portal-profile-empty")).toBeInTheDocument();
    // The holder can still fill the form from an empty profile.
    expect(screen.getByTestId("portal-profile-form")).toBeInTheDocument();
    // Nothing here reads as a failure.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a denied state when the API refuses access", async () => {
    global.fetch = routeFetch({
      profile: { body: { error: { code: "FORBIDDEN", message: "Access denied" } }, status: 403 },
    });

    renderView();

    const denied = await screen.findByTestId("portal-profile-denied");
    expect(denied).toHaveAttribute("role", "alert");
    expect(denied).toHaveTextContent("You do not have access to this portal.");
  });

  it("renders an error state with generic copy for an unmapped failure", async () => {
    global.fetch = routeFetch({
      profile: {
        body: { error: { code: "INTERNAL", message: "boom: upstream stack" } },
        status: 500,
      },
    });

    renderView();

    const error = await screen.findByTestId("portal-profile-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent("Something went wrong. Please try again.");
    expect(error).not.toHaveTextContent("boom: upstream stack");
  });

  it("keeps a masked not-found cause-neutral and names no pet", async () => {
    global.fetch = routeFetch({
      profile: {
        body: { error: { code: "NOT_FOUND", message: "profile was not resolved upstream" } },
        status: 404,
      },
    });

    renderView();

    const error = await screen.findByTestId("portal-profile-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(/profile/i);
    expect(error).toHaveTextContent(/may not exist yet/i);
    expect(error).toHaveTextContent(/may not be linked to your account/i);
    expect(error).not.toHaveTextContent("profile was not resolved upstream");
    expect(error).not.toHaveTextContent(/that pet/i);
  });

  it("states plainly that email is staff-operated and offers no email field", async () => {
    global.fetch = routeFetch({ profile: { body: FULL_PROFILE } });

    const { container } = render(
      <TestWrapper>
        <PortalProfileView />
      </TestWrapper>
    );

    const note = await screen.findByTestId("portal-profile-email-note");
    expect(note).toHaveTextContent("managed by clinic staff");
    expect(note).toHaveTextContent("cannot be changed here");
    // No field the API would refuse: email, name, kind, tax or identity.
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(container.querySelector('input[name="email"]')).toBeNull();
    expect(container.textContent).not.toMatch(
      /\btax id\b|\br\.?u\.?c\b|\bfirst name\b|\blast name\b/i
    );
  });

  it("prefills every editable field from the profile read", async () => {
    global.fetch = routeFetch({ profile: { body: FULL_PROFILE } });

    renderView();

    expect(await screen.findByTestId("portal-profile-form")).toBeInTheDocument();
    expect(screen.getByTestId("portal-profile-phone")).toHaveValue("+595 21 555 1234");
    expect(screen.getByTestId("portal-profile-address-label")).toHaveValue("Home");
    expect(screen.getByTestId("portal-profile-address-line1")).toHaveValue("Av. Mcal. Lopez 123");
    expect(screen.getByTestId("portal-profile-address-city")).toHaveValue("Asuncion");
    expect(screen.getByTestId("portal-profile-address-postal-code")).toHaveValue("1209");
    expect(screen.getByTestId("portal-profile-address-country-code")).toHaveValue("PY");
  });

  it("tells the holder details can be removed and offers a removal control for each", async () => {
    global.fetch = routeFetch({ profile: { body: FULL_PROFILE } });

    renderView();

    const note = await screen.findByTestId("portal-profile-removal-note");
    expect(note).toHaveTextContent(/remove your phone number and address/i);
    // The old claim that details cannot be removed is gone.
    expect(note).not.toHaveTextContent("cannot remove");
    expect(screen.getByTestId("portal-profile-remove-phone")).toBeInTheDocument();
    expect(screen.getByTestId("portal-profile-remove-address")).toBeInTheDocument();
  });

  it("offers no removal control when there is nothing stored to remove", async () => {
    global.fetch = routeFetch({ profile: { body: EMPTY_PROFILE } });

    renderView();
    await screen.findByTestId("portal-profile-form");

    expect(screen.queryByTestId("portal-profile-remove-phone")).toBeNull();
    expect(screen.queryByTestId("portal-profile-remove-address")).toBeNull();
  });

  it("asks for confirmation and clears the phone only after the holder confirms", async () => {
    const fetchMock = routeFetch({
      profile: { body: FULL_PROFILE },
      save: { body: { phone: null, address: FULL_PROFILE.address } },
    });
    global.fetch = fetchMock;

    renderView();
    fireEvent.click(await screen.findByTestId("portal-profile-remove-phone"));

    // The first click removes nothing: it opens the confirmation instead.
    expect(writes(fetchMock)).toHaveLength(0);
    const confirmation = screen.getByTestId("portal-profile-remove-phone-confirm");
    expect(confirmation).toHaveAttribute("role", "alertdialog");
    expect(confirmation).toHaveTextContent(/remove your phone number/i);

    fireEvent.click(screen.getByTestId("portal-profile-remove-phone-confirm-yes"));
    await waitFor(() => {
      const put = writes(fetchMock)[0];
      expect(put).toBeDefined();
      expect(resolveRequestUrl(put[0])).toBe("/api/portal/profile");
      expect(JSON.parse(put[1].body as string)).toEqual({ phone: null });
    });
    // The form resets from the response: the phone field is empty and the
    // removal control is gone because there is no longer a stored phone.
    expect(await screen.findByTestId("portal-profile-phone")).toHaveValue("");
    await waitFor(() => {
      expect(screen.queryByTestId("portal-profile-remove-phone")).toBeNull();
    });
  });

  it("asks for confirmation and clears the address only after the holder confirms", async () => {
    const fetchMock = routeFetch({
      profile: { body: FULL_PROFILE },
      save: { body: { phone: FULL_PROFILE.phone, address: null } },
    });
    global.fetch = fetchMock;

    renderView();
    fireEvent.click(await screen.findByTestId("portal-profile-remove-address"));
    expect(writes(fetchMock)).toHaveLength(0);

    fireEvent.click(screen.getByTestId("portal-profile-remove-address-confirm-yes"));
    await waitFor(() => {
      const put = writes(fetchMock)[0];
      expect(put).toBeDefined();
      expect(JSON.parse(put[1].body as string)).toEqual({ address: null });
    });
    expect(await screen.findByTestId("portal-profile-address-line1")).toHaveValue("");
  });

  it("cancels a removal without sending a request", async () => {
    const fetchMock = routeFetch({ profile: { body: FULL_PROFILE } });
    global.fetch = fetchMock;

    renderView();
    fireEvent.click(await screen.findByTestId("portal-profile-remove-address"));
    fireEvent.click(screen.getByTestId("portal-profile-remove-address-confirm-cancel"));

    expect(screen.queryByTestId("portal-profile-remove-address-confirm")).toBeNull();
    expect(screen.getByTestId("portal-profile-remove-address")).toBeInTheDocument();
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it("does not repeat the removed-details claim after a successful save", async () => {
    const fetchMock = routeFetch({
      profile: { body: FULL_PROFILE },
      save: { body: FULL_PROFILE },
    });
    global.fetch = fetchMock;

    renderView();
    fireEvent.click(await screen.findByTestId("portal-profile-save"));
    const success = await screen.findByTestId("portal-profile-save-success");
    expect(success).toHaveTextContent("Your profile has been updated.");
    // The fixed copy no longer tells the holder details are irremovable, and
    // never claims a cleared field was "saved".
    expect(success).not.toHaveTextContent("cannot be removed");
    expect(success).not.toHaveTextContent(/\bsaved\b/i);
  });

  it("mirrors the API's length limits on every input", async () => {
    global.fetch = routeFetch({ profile: { body: FULL_PROFILE } });

    renderView();
    await screen.findByTestId("portal-profile-form");

    // Mirrored EXACTLY from portal-profile.dto.ts: phone 255, label 100,
    // line1 200, line2 200, city 100, state 100, postalCode 20, countryCode 2.
    expect(screen.getByTestId("portal-profile-phone")).toHaveAttribute("maxlength", "255");
    expect(screen.getByTestId("portal-profile-address-label")).toHaveAttribute("maxlength", "100");
    expect(screen.getByTestId("portal-profile-address-line1")).toHaveAttribute("maxlength", "200");
    expect(screen.getByTestId("portal-profile-address-line2")).toHaveAttribute("maxlength", "200");
    expect(screen.getByTestId("portal-profile-address-city")).toHaveAttribute("maxlength", "100");
    expect(screen.getByTestId("portal-profile-address-state")).toHaveAttribute("maxlength", "100");
    expect(screen.getByTestId("portal-profile-address-postal-code")).toHaveAttribute(
      "maxlength",
      "20"
    );
    expect(screen.getByTestId("portal-profile-address-country-code")).toHaveAttribute(
      "maxlength",
      "2"
    );
  });

  it("stops an over-long phone before the API and keeps what was typed", async () => {
    const fetchMock = routeFetch({ profile: { body: FULL_PROFILE } });
    global.fetch = fetchMock;

    renderView();
    const phone = await screen.findByTestId("portal-profile-phone");
    // `maxLength` does not gate a programmatic change, so validation must.
    const overLong = "9".repeat(256);
    fireEvent.change(phone, { target: { value: overLong } });
    fireEvent.click(screen.getByTestId("portal-profile-save"));

    const validation = await screen.findByTestId("portal-profile-validation-error");
    expect(validation).toHaveTextContent("255 characters or fewer");
    expect(screen.getByTestId("portal-profile-phone")).toHaveValue(overLong);
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it("stops a country code that is not exactly two characters", async () => {
    const fetchMock = routeFetch({ profile: { body: FULL_PROFILE } });
    global.fetch = fetchMock;

    renderView();
    fireEvent.change(await screen.findByTestId("portal-profile-address-country-code"), {
      target: { value: "P" },
    });
    fireEvent.click(screen.getByTestId("portal-profile-save"));

    const validation = await screen.findByTestId("portal-profile-validation-error");
    expect(validation).toHaveTextContent("exactly 2 characters");
    // The typed value is preserved for the holder to correct.
    expect(screen.getByTestId("portal-profile-address-country-code")).toHaveValue("P");
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it("saves the edited phone with the prefilled address as exactly the strict body", async () => {
    const fetchMock = routeFetch({
      profile: { body: FULL_PROFILE },
      save: { body: { phone: "555-9999", address: FULL_PROFILE.address } },
    });
    global.fetch = fetchMock;

    renderView();
    fireEvent.change(await screen.findByTestId("portal-profile-phone"), {
      target: { value: "555-9999" },
    });
    fireEvent.click(screen.getByTestId("portal-profile-save"));

    await waitFor(() => {
      const put = writes(fetchMock)[0];
      expect(put).toBeDefined();
      expect(resolveRequestUrl(put[0])).toBe("/api/portal/profile");
      expect(JSON.parse(put[1].body as string)).toEqual({
        phone: "555-9999",
        address: {
          label: "Home",
          line1: "Av. Mcal. Lopez 123",
          city: "Asuncion",
          postalCode: "1209",
          countryCode: "PY",
        },
      });
    });

    expect(await screen.findByTestId("portal-profile-save-success")).toHaveTextContent(
      "Your profile has been updated."
    );
  });

  it("matches the API's line1 rule and preserves every typed value", async () => {
    const fetchMock = routeFetch({ profile: { body: FULL_PROFILE } });
    global.fetch = fetchMock;

    renderView();
    // Clear the required line while changing another address field.
    fireEvent.change(await screen.findByTestId("portal-profile-address-line1"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("portal-profile-address-city"), {
      target: { value: "Encarnacion" },
    });
    fireEvent.click(screen.getByTestId("portal-profile-save"));

    const validation = await screen.findByTestId("portal-profile-validation-error");
    expect(validation).toHaveAttribute("role", "alert");
    expect(validation).toHaveTextContent(/first line of your address/i);

    // Nothing the holder typed was lost, and no request was sent.
    expect(screen.getByTestId("portal-profile-address-city")).toHaveValue("Encarnacion");
    expect(screen.getByTestId("portal-profile-phone")).toHaveValue("+595 21 555 1234");
    expect(screen.queryByTestId("portal-profile-save-success")).toBeNull();
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it("stops a save with neither phone nor address before it reaches the API", async () => {
    const fetchMock = routeFetch({ profile: { body: EMPTY_PROFILE } });
    global.fetch = fetchMock;

    renderView();
    await screen.findByTestId("portal-profile-form");
    fireEvent.click(screen.getByTestId("portal-profile-save"));

    expect(await screen.findByTestId("portal-profile-validation-error")).toHaveTextContent(
      /phone number or an address/i
    );
    expect(writes(fetchMock)).toHaveLength(0);
  });

  it("shows a saving state while the PUT is in flight", async () => {
    const fetchMock = routeFetch({
      profile: { body: FULL_PROFILE },
      save: { body: FULL_PROFILE, pending: true },
    });
    global.fetch = fetchMock;

    renderView();
    await screen.findByTestId("portal-profile-form");
    fireEvent.click(screen.getByTestId("portal-profile-save"));

    const saving = await screen.findByTestId("portal-profile-saving");
    expect(saving).toHaveAttribute("role", "status");
    expect(screen.getByTestId("portal-profile-save")).toBeDisabled();
  });

  it("leaves the form usable and the input intact after a failed save", async () => {
    const fetchMock = routeFetch({
      profile: { body: FULL_PROFILE },
      save: { body: { error: { code: "INTERNAL", message: "boom: upstream stack" } }, status: 500 },
    });
    global.fetch = fetchMock;

    renderView();
    fireEvent.change(await screen.findByTestId("portal-profile-phone"), {
      target: { value: "555-0000" },
    });
    fireEvent.click(screen.getByTestId("portal-profile-save"));

    const error = await screen.findByTestId("portal-profile-save-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent("Something went wrong. Please try again.");
    expect(error).not.toHaveTextContent("boom: upstream stack");

    expect(screen.getByTestId("portal-profile-save")).toBeEnabled();
    expect(screen.getByTestId("portal-profile-phone")).toHaveValue("555-0000");
    expect(screen.queryByTestId("portal-profile-save-success")).toBeNull();
  });

  it("maps a save 400 to the validation copy without echoing the server", async () => {
    const fetchMock = routeFetch({
      profile: { body: FULL_PROFILE },
      save: {
        body: { error: { code: "VALIDATION_FAILED", message: "Invalid profile update body." } },
        status: 400,
      },
    });
    global.fetch = fetchMock;

    renderView();
    await screen.findByTestId("portal-profile-form");
    fireEvent.click(screen.getByTestId("portal-profile-save"));

    const error = await screen.findByTestId("portal-profile-save-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent("Some of the details you entered are not accepted.");
    expect(error).not.toHaveTextContent("Invalid profile update body.");
    expect(screen.getByTestId("portal-profile-save")).toBeEnabled();
  });
});

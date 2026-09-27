import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NewSupplierPage from "./new/page";
import EditSupplierPage from "./[id]/edit/page";

/**
 * The route param is a canonical UUID because the proxy refuses a malformed id;
 * the fixture id and the mocked route param stay the same value.
 */
const { SUPPLIER_ID, pushMock, backMock } = vi.hoisted(() => ({
  SUPPLIER_ID: "11111111-1111-4111-8111-111111111111",
  pushMock: vi.fn(),
  backMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, back: backMock }),
  useParams: () => ({ id: SUPPLIER_ID }),
}));

const CONFLICT_MESSAGE = "A supplier with this tax identifier already exists in this tenant.";

const SUPPLIER = {
  id: SUPPLIER_ID,
  tenantId: "tenant-a",
  name: "Distribuidora Central",
  legalName: "Distribuidora Central S.A.",
  taxId: "80012345-6",
  email: "compras@distribuidora.example",
  phone: "+595981123456",
  address: "Av. Mcal. López 1234, Asunción",
  isActive: true,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

function TestWrapper({ children }: { readonly children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

function submitForm(): void {
  const form = screen.getByRole("button", { name: /Create supplier|Save changes/ }).closest("form");
  fireEvent.submit(form!);
}

function renderNewPage(): void {
  render(
    <TestWrapper>
      <NewSupplierPage />
    </TestWrapper>
  );
}

function renderEditPage(): void {
  render(
    <TestWrapper>
      <EditSupplierPage />
    </TestWrapper>
  );
}

describe("NewSupplierPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    backMock.mockReset();
  });

  it("creates the supplier through the proxy and routes to its edit page on success", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(SUPPLIER, 201)));
    global.fetch = fetchMock;

    renderNewPage();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Distribuidora Central" } });
    fireEvent.change(screen.getByLabelText("Tax identifier"), { target: { value: "80012345-6" } });
    submitForm();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(`/app/suppliers/${SUPPLIER_ID}/edit`);
    });

    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(resolveUrl(input)).toBe("/api/suppliers");
    expect(init.method).toBe("POST");
    // The create body carries no lifecycle flag: isActive has its own command.
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Distribuidora Central",
      taxId: "80012345-6",
    });
  });

  it("shows a pending, disabled form while the create is in flight", async () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderNewPage();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Distribuidora Central" } });
    submitForm();

    expect(await screen.findByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("renders a permission-denied state when the create is refused with 403", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied." } }, 403)
      )
    );

    renderNewPage();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Distribuidora Central" } });
    submitForm();

    expect(
      await screen.findByText("You do not have permission to manage suppliers.")
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("renders the API validation message when the create is refused with 400", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: "VALIDATION_FAILED", message: "Invalid supplier create body." } },
          400
        )
      )
    );

    renderNewPage();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Distribuidora Central" } });
    submitForm();

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid supplier create body.");
  });
});

describe("EditSupplierPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    backMock.mockReset();
  });

  it("renders an explicit loading state while the supplier is pending", () => {
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderEditPage();

    expect(screen.getByText("Loading supplier...")).toBeInTheDocument();
  });

  it("renders the not-found state when the supplier is missing", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "NOT_FOUND", message: "Supplier was not found." } }, 404)
      )
    );

    renderEditPage();

    expect(await screen.findByText("Supplier not found.")).toBeInTheDocument();
  });

  it("renders a permission-denied state when the read is refused with 403", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied." } }, 403)
      )
    );

    renderEditPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Permission denied");
    expect(alert).toHaveTextContent("You do not have permission to manage suppliers.");
  });

  it("updates the supplier and returns to the list on success", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Promise.resolve(jsonResponse({ ...SUPPLIER, name: "Distribuidora Central S.A." }));
      }
      return Promise.resolve(jsonResponse(SUPPLIER));
    });
    global.fetch = fetchMock;

    renderEditPage();

    const name = await screen.findByLabelText("Name");
    fireEvent.change(name, { target: { value: "Distribuidora Central S.A." } });
    submitForm();

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/app/suppliers");
    });

    const putCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT");
    expect(putCall).toBeDefined();
    expect(resolveUrl(putCall![0])).toBe(`/api/suppliers/${SUPPLIER_ID}`);
    expect(JSON.parse(putCall![1]?.body as string)).toEqual({
      name: "Distribuidora Central S.A.",
    });
  });

  it("renders a duplicate tax identifier 409 as a conflict when the update is refused", async () => {
    global.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Promise.resolve(
          jsonResponse({ error: { code: "CONFLICT", message: CONFLICT_MESSAGE } }, 409)
        );
      }
      return Promise.resolve(jsonResponse(SUPPLIER));
    });

    renderEditPage();

    const taxId = await screen.findByLabelText("Tax identifier");
    fireEvent.change(taxId, { target: { value: "99999999-9" } });
    submitForm();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Tax identifier conflict");
    expect(alert).toHaveTextContent(CONFLICT_MESSAGE);
    expect(taxId).toHaveAttribute("aria-invalid", "true");
    // A refused write never navigates away from the form.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("offers no delete affordance on the edit page", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(SUPPLIER)));

    renderEditPage();

    await screen.findByLabelText("Name");
    expect(
      screen.queryByRole("button", { name: /delete|remove|deactivate/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PortalPetsList } from "./portal-pets-list";

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

const REX_ID = "11111111-1111-4111-8111-111111111111";
const MILO_ID = "22222222-2222-4222-8222-222222222222";

const PETS = [
  {
    id: REX_ID,
    name: "Rex",
    speciesId: "species-1",
    breedId: "breed-1",
    sex: "MALE",
    birthDate: "2020-05-01T00:00:00.000Z",
    isActive: true,
  },
  {
    id: MILO_ID,
    name: "Milo",
    speciesId: "species-1",
    breedId: null,
    sex: "UNKNOWN",
    birthDate: null,
    isActive: false,
  },
];

function renderList(): void {
  render(
    <TestWrapper>
      <PortalPetsList slug="acme-clinic" />
    </TestWrapper>
  );
}

describe("PortalPetsList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state while the pets read is in flight", () => {
    // A never-resolving read keeps the query in its loading state.
    global.fetch = vi.fn(() => new Promise<Response>(() => undefined));

    renderList();

    expect(screen.getByTestId("portal-pets-loading")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("treats an empty list as a normal state, not an error", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse([])));

    renderList();

    expect(await screen.findByTestId("portal-pets-empty")).toBeInTheDocument();
    expect(screen.getByText("No pets yet")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a denied state when the API refuses access", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: { code: "FORBIDDEN", message: "Access denied" } }, 403))
    );

    renderList();

    const denied = await screen.findByTestId("portal-pets-denied");
    expect(denied).toHaveAttribute("role", "alert");
    expect(denied).toHaveTextContent("You do not have access to this portal.");
  });

  it("renders an error state with generic copy for an unmapped failure", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "INTERNAL", message: "boom: upstream stack" } }, 500)
      )
    );

    renderList();

    const error = await screen.findByTestId("portal-pets-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent("Something went wrong. Please try again.");
    expect(error).not.toHaveTextContent("boom: upstream stack");
  });

  it("lists the pets, preserves the slug in each detail link, and never prints raw catalog ids", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(PETS)));

    const { container } = render(
      <TestWrapper>
        <PortalPetsList slug="acme-clinic" />
      </TestWrapper>
    );

    expect(await screen.findByText("Rex")).toBeInTheDocument();
    expect(screen.getByText("Milo")).toBeInTheDocument();

    await waitFor(() => {
      const links = screen.getAllByTestId("portal-pet-link");
      expect(links.map((link) => link.getAttribute("href"))).toEqual([
        `/acme-clinic/pets/${REX_ID}`,
        `/acme-clinic/pets/${MILO_ID}`,
      ]);
    });

    // Meaningful facts are shown; the catalog ids that have no portal route are not.
    expect(screen.getByText("Male · Born 2020-05-01")).toBeInTheDocument();
    expect(screen.getByText("Sex not recorded · Inactive")).toBeInTheDocument();
    expect(container.textContent).not.toContain("species-1");
    expect(container.textContent).not.toContain("breed-1");
  });
});

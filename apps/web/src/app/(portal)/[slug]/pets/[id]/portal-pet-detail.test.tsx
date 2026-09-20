import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PortalPetDetailView } from "./portal-pet-detail";

const PET_ID = "11111111-1111-4111-8111-111111111111";
const SLUG = "acme-clinic";

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

const PET_DETAIL = {
  id: PET_ID,
  name: "Rex",
  speciesId: "species-1",
  breedId: "breed-1",
  sex: "MALE",
  birthDate: "2020-05-01T00:00:00.000Z",
  isActive: true,
  clinical: {
    encounters: [
      {
        id: "encounter-1",
        status: "CLOSED",
        clientSummary: "Routine check-up; all healthy.",
        closedAt: "2026-08-01T10:00:00.000Z",
      },
    ],
    vaccinations: [
      { id: "vaccination-1", vaccine: "Rabies", administeredAt: "2026-07-15T09:00:00.000Z" },
    ],
  },
};

function renderDetail(): void {
  render(
    <TestWrapper>
      <PortalPetDetailView slug={SLUG} petId={PET_ID} />
    </TestWrapper>
  );
}

describe("PortalPetDetailView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the pet identity and the allowlisted clinical summary", async () => {
    global.fetch = vi.fn(() => Promise.resolve(jsonResponse(PET_DETAIL)));

    renderDetail();

    expect(await screen.findByText("Rex")).toBeInTheDocument();
    expect(screen.getByText("Male · Born 2020-05-01")).toBeInTheDocument();
    expect(screen.getByText("Routine check-up; all healthy.")).toBeInTheDocument();
    expect(screen.getByText("Rabies")).toBeInTheDocument();
    expect(screen.getByText("Given 2026-07-15")).toBeInTheDocument();
    // The booking entry point keeps the tenant slug.
    expect(screen.getByTestId("portal-book-link")).toHaveAttribute(
      "href",
      `/acme-clinic/pets/${PET_ID}/book`
    );
  });

  it("handles a 404 honestly without claiming the pet exists elsewhere", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "NOT_FOUND", message: "Portal pet was not found." } }, 404)
      )
    );

    renderDetail();

    const notFound = await screen.findByTestId("portal-pet-not-found");
    expect(notFound).toHaveAttribute("role", "alert");
    expect(notFound).toHaveTextContent("We could not find that pet.");
    expect(notFound).toHaveTextContent("may not be linked to your account");
    // The mapper never echoes the server message.
    expect(notFound).not.toHaveTextContent("Portal pet was not found.");
  });

  it("renders a denied state when the API refuses access", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(jsonResponse({ error: { code: "FORBIDDEN", message: "nope" } }, 403))
    );

    renderDetail();

    const denied = await screen.findByTestId("portal-pet-denied");
    expect(denied).toHaveAttribute("role", "alert");
    expect(denied).toHaveTextContent("You do not have access to this portal.");
  });
});

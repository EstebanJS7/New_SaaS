import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { StaffMember } from "./team-api";
import { CapabilitiesProvider, type Capabilities } from "@/lib/capabilities";
import { TeamSurface } from "./team-surface";

const OWNER: StaffMember = {
  membershipId: "11111111-1111-4111-8111-111111111111",
  userProfileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "duenia@clinica.test",
  displayName: "María Pérez",
  roleCode: "OWNER",
  status: "ACTIVE",
  activationPending: false,
  createdAt: "2026-11-01T10:00:00.000Z",
  branchIds: [],
};
const INVITED: StaffMember = {
  ...OWNER,
  membershipId: "22222222-2222-4222-8222-222222222222",
  userProfileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  email: "ana@clinica.test",
  displayName: "Ana Gómez",
  roleCode: "VETERINARIAN",
  activationPending: true,
};
const SUSPENDED: StaffMember = {
  ...OWNER,
  membershipId: "33333333-3333-4333-8333-333333333333",
  userProfileId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  email: "juan@clinica.test",
  displayName: "Juan Ruiz",
  roleCode: "CASHIER",
  status: "SUSPENDED",
};

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call = {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
    };
    calls.push(call);
    return Promise.resolve(handler(call));
  });
  return calls;
}

function renderSurface(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TeamSurface />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});

afterEach(() => vi.restoreAllMocks());

describe("TeamSurface (ONB-001) — the directory", () => {
  it("lists every member with role and activation state", async () => {
    installFetch(() => json({ members: [OWNER, INVITED, SUSPENDED] }));
    renderSurface();

    const rows = await screen.findAllByTestId("team-member");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Activo")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Invitación pendiente")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Suspendido")).toBeInTheDocument();
    expect(screen.getByLabelText("Rol de Ana Gómez")).toHaveValue("VETERINARIAN");
    // Only a pending invitation offers a re-send, and only a suspended member a reactivation.
    expect(screen.getAllByRole("button", { name: "Reenviar invitación" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Reactivar" })).toHaveLength(1);
  });

  it("says permission is missing instead of pretending the clinic has no staff", async () => {
    installFetch(() => json({ error: { code: "FORBIDDEN", message: "x" } }, 403));
    renderSurface();
    expect(await screen.findByText("No tenés permiso para ver el personal")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invitar persona" })).toBeNull();
  });

  it("offers a retry when the list cannot be loaded", async () => {
    installFetch(() => json({ error: { code: "INTERNAL", message: "x" } }, 500));
    renderSurface();
    expect(await screen.findByText("No se pudo cargar la lista del personal.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver a intentar" })).toBeInTheDocument();
  });
});

describe("TeamSurface (ONB-001) — inviting", () => {
  function openForm(): void {
    fireEvent.click(screen.getByRole("button", { name: "Invitar persona" }));
  }

  it("validates before sending, and sends nothing for an empty form", async () => {
    const calls = installFetch(() => json({ members: [OWNER] }));
    renderSurface();
    await screen.findAllByTestId("team-member");
    openForm();
    fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));

    expect(await screen.findByText("Escribí el nombre.")).toBeInTheDocument();
    expect(screen.getByText("Escribí un email válido.")).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("posts the invitation and confirms only after the API answers", async () => {
    const calls = installFetch((call) =>
      call.method === "POST"
        ? json({
            invitation: {
              membershipId: INVITED.membershipId,
              userProfileId: INVITED.userProfileId,
              activationPending: true,
            },
          })
        : json({ members: [OWNER] })
    );
    renderSurface();
    await screen.findAllByTestId("team-member");
    openForm();
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: " Ana Gómez " } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@clinica.test" } });
    fireEvent.change(screen.getByLabelText("Rol"), { target: { value: "RECEPTIONIST" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));

    const notice = await screen.findByTestId("team-notice");
    expect(notice.textContent).toContain("Invitación enviada a ana@clinica.test");
    const post = calls.find((call) => call.method === "POST");
    expect(post?.url).toBe("/api/memberships/invitations");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      email: "ana@clinica.test",
      displayName: "Ana Gómez",
      roleCode: "RECEPTIONIST",
    });
  });

  it("shows the API's own sentence when the person is already a member", async () => {
    installFetch((call) =>
      call.method === "POST"
        ? json(
            {
              error: { code: "CONFLICT", message: "Esa persona ya forma parte de esta clínica." },
            },
            409
          )
        : json({ members: [OWNER] })
    );
    renderSurface();
    await screen.findAllByTestId("team-member");
    openForm();
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "María" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: OWNER.email } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));

    expect(
      await screen.findByText("Esa persona ya forma parte de esta clínica.")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("team-notice")).toBeNull();
  });
});

describe("TeamSurface (ONB-001) — commands", () => {
  it("re-sends an invitation and says so", async () => {
    const calls = installFetch((call) =>
      call.method === "POST"
        ? json({ invitation: { ...INVITED, activationPending: true } })
        : json({ members: [OWNER, INVITED] })
    );
    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Reenviar invitación" }));

    expect((await screen.findByTestId("team-notice")).textContent).toContain(INVITED.email);
    expect(
      calls.some((call) => call.url === `/api/memberships/${INVITED.membershipId}/activation`)
    ).toBe(true);
  });

  it("asks before suspending, and suspends only on confirmation", async () => {
    const calls = installFetch((call) =>
      call.method === "POST"
        ? json({ membership: { status: "SUSPENDED" } })
        : json({ members: [OWNER, INVITED] })
    );
    renderSurface();
    const rows = await screen.findAllByTestId("team-member");
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Suspender" }));

    expect(await screen.findByText("¿Suspender a Ana Gómez?")).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Suspender acceso" }));
    expect((await screen.findByTestId("team-notice")).textContent).toContain(
      "Ana Gómez ya no puede ingresar"
    );
    expect(calls.find((call) => call.method === "POST")?.url).toBe(
      `/api/memberships/${INVITED.membershipId}/suspend`
    );
  });

  it("keeps the dialog open with a translated message when the last manager would be lost", async () => {
    installFetch((call) =>
      call.method === "POST"
        ? json(
            {
              error: {
                code: "CONFLICT",
                message:
                  "Cannot remove the last effective holder of users.membership.manage from the tenant.",
              },
            },
            409
          )
        : json({ members: [OWNER, INVITED] })
    );
    renderSurface();
    const rows = await screen.findAllByTestId("team-member");
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Suspender" }));
    fireEvent.click(await screen.findByRole("button", { name: "Suspender acceso" }));

    expect(
      await screen.findByText(/debe conservar al menos una persona que gestione el personal/)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("team-notice")).toBeNull();
  });

  it("asks before changing a role, then posts the new role", async () => {
    const calls = installFetch((call) =>
      call.method === "POST" ? json({ assignment: {} }) : json({ members: [OWNER, INVITED] })
    );
    renderSurface();
    await screen.findAllByTestId("team-member");
    fireEvent.change(screen.getByLabelText("Rol de Ana Gómez"), { target: { value: "ADMIN" } });

    expect(await screen.findByText("¿Cambiar el rol de Ana Gómez?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar rol" }));

    await waitFor(() =>
      expect(calls.find((call) => call.method === "POST")?.url).toBe(
        `/api/memberships/${INVITED.membershipId}/role`
      )
    );
    expect(JSON.parse(calls.find((call) => call.method === "POST")?.body ?? "{}")).toEqual({
      roleCode: "ADMIN",
    });
  });
});

describe("TeamSurface (MB-001) — where each person works", () => {
  const CENTRAL = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    name: "Casa central",
    address: null,
    phone: null,
    isActive: true,
    staffCount: 2,
    createdAt: "2026-11-01T10:00:00.000Z",
  };
  const NORTE = { ...CENTRAL, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: "Norte" };
  const VIEJA = {
    ...CENTRAL,
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    name: "Vieja",
    isActive: false,
  };

  function handler(branches: unknown[]) {
    return (call: Call): Response => {
      if (call.url === "/api/branches") return json({ branches });
      if (call.method === "PUT") return json({ assignment: { branchIds: [NORTE.id] } });
      if (call.method === "POST") {
        return json({
          invitation: { membershipId: "m", userProfileId: "p", activationPending: true },
        });
      }
      return json({
        members: [
          { ...OWNER, branchIds: [CENTRAL.id, VIEJA.id] },
          { ...INVITED, branchIds: [] },
        ],
      });
    };
  }

  it("shows no branch controls for a single-branch clinic", async () => {
    installFetch(handler([CENTRAL]));
    renderSurface();
    await screen.findAllByTestId("team-member");
    expect(screen.queryByTestId("member-branches")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sucursales" })).toBeNull();
  });

  it("lists each person's branches, marking a deactivated one", async () => {
    installFetch(handler([CENTRAL, NORTE, VIEJA]));
    renderSurface();
    const lines = await screen.findAllByTestId("member-branches");
    expect(lines[0]).toHaveTextContent("Trabaja en: Casa central, Vieja (desactivada)");
    expect(lines[1]).toHaveTextContent("Sin sucursal asignada");
  });

  it("replaces a person's branches with the chosen active ones", async () => {
    const calls = installFetch(handler([CENTRAL, NORTE, VIEJA]));
    renderSurface();
    await screen.findAllByTestId("member-branches");
    fireEvent.click(screen.getAllByRole("button", { name: "Sucursales" })[0]);

    const group = screen.getByRole("group", { name: "Sucursales de María Pérez" });
    // Only active branches are offered.
    expect(within(group).queryByLabelText("Vieja")).toBeNull();
    fireEvent.click(within(group).getByLabelText("Casa central"));
    fireEvent.click(within(group).getByLabelText("Norte"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar sucursales" }));

    expect(await screen.findByTestId("team-notice")).toHaveTextContent(
      "María Pérez trabaja en: Norte."
    );
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.url).toBe(`/api/memberships/${OWNER.membershipId}/branches`);
    expect(JSON.parse(put?.body ?? "{}")).toEqual({ branchIds: [NORTE.id] });
  });

  it("does not let a person end up with no branch", async () => {
    const calls = installFetch(handler([CENTRAL, NORTE]));
    renderSurface();
    await screen.findAllByTestId("member-branches");
    fireEvent.click(screen.getAllByRole("button", { name: "Sucursales" })[0]);
    fireEvent.click(screen.getByLabelText("Casa central"));
    expect(screen.getByText("Elegí al menos una sucursal.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar sucursales" })).toBeDisabled();
    expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  it("invites into the chosen branches (all active ones by default)", async () => {
    const calls = installFetch(handler([CENTRAL, NORTE, VIEJA]));
    renderSurface();
    await screen.findAllByTestId("team-member");
    fireEvent.click(screen.getByRole("button", { name: "Invitar persona" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@clinica.test" } });
    const group = screen.getByRole("group", { name: "Sucursales donde trabaja" });
    expect(within(group).getByLabelText("Casa central")).toBeChecked();
    expect(within(group).getByLabelText("Norte")).toBeChecked();
    fireEvent.click(within(group).getByLabelText("Casa central"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));

    await screen.findByTestId("team-notice");
    const post = calls.find((call) => call.url.endsWith("/invitations"));
    expect(JSON.parse(post?.body ?? "{}")).toMatchObject({ branchIds: [NORTE.id] });
  });
});

/**
 * UX-037: the team screen offers its commands only to a caller who may manage
 * memberships; branch controls also need `branches.manage`. Unknown ⇒ offered.
 */
describe("TeamSurface gated by the caller's capabilities (UX-037)", () => {
  const BRANCHES = [
    { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Casa central", isActive: true },
    { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: "Norte", isActive: true },
  ];
  function handler(call: Call): Response {
    if (call.url === "/api/branches") return json({ branches: BRANCHES });
    return json({ members: [OWNER, SUSPENDED] });
  }
  function renderWith(capabilities?: Capabilities): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (
      <QueryClientProvider client={client}>
        <TeamSurface />
      </QueryClientProvider>
    );
    render(
      capabilities === undefined ? (
        tree
      ) : (
        <CapabilitiesProvider value={capabilities}>{tree}</CapabilitiesProvider>
      )
    );
  }

  it("shows the no-access state and reads nothing without users.membership.manage", () => {
    const calls = installFetch(handler);
    renderWith({ permissions: [] });
    expect(
      screen.getByRole("heading", { name: "No tenés permiso para ver el personal" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invitar persona" })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("hides the branch controls without branches.manage and never reads the branches", async () => {
    const calls = installFetch(handler);
    renderWith({ permissions: ["users.membership.manage"] });
    await screen.findAllByTestId("team-member");
    expect(screen.getByRole("button", { name: "Invitar persona" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sucursales" })).toBeNull();
    expect(calls.some((call) => call.url === "/api/branches")).toBe(false);
  });

  it.each([
    ["granted", { permissions: ["users.membership.manage", "branches.manage"] }],
    ["unknown", undefined],
  ])("offers every command when capabilities are %s", async (_label, capabilities) => {
    installFetch(handler);
    renderWith(capabilities);
    await screen.findAllByTestId("team-member");
    expect(screen.getByRole("button", { name: "Invitar persona" })).toBeInTheDocument();
    expect((await screen.findAllByRole("button", { name: "Sucursales" })).length).toBeGreaterThan(
      0
    );
    expect(screen.getByRole("button", { name: "Reactivar" })).toBeInTheDocument();
  });
});

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  bff,
  closeSession,
  createCatalogItem,
  openSessions,
  runTag,
  salesOf,
  sessionMovements,
  signInAsStaff,
} from "../support/staff.js";
import { DEMO } from "./fixtures.js";

/**
 * Branches and staff assignment ([[MB-001]], first delivery of [[DEC-094]]), driven in a browser:
 * "en «Configuración › Sucursales», cree una sucursal, asigne personal, verifique las restricciones
 * de la story (no desactivar la última activa ni una con turnos pendientes) y vea que la caja y las
 * ventas respetan la sucursal de trabajo."
 *
 * The owner creates the branch and assigns people on the real screens; the refusals are asserted on
 * the exact status and Spanish sentence the API answers — both through the BFF, with the state
 * re-read afterwards, and through the surfaces that show them (the confirmation dialog and the
 * per-person editor). With two active working branches the Cash and counter forms ask where; the
 * register opened in the new branch is the one that receives the sale's cash, and a sale in a branch
 * the person does not work at is refused without creating anything.
 *
 * The lane's database outlives a run, so names carry a per-run tag, the assertions count only what
 * this run created, and the branch, the assignment, the drawer session and the appointment are
 * undone through the same public routes at the end. An interrupted run is cleaned first, for the
 * same reason.
 */

/** The demo seed's only branch, from `packages/database/src/demo-seed.ts`. */
const BASELINE_BRANCH_NAME = "Demo Main Branch";
/** The demo seed's professional, the only member with the VETERINARIAN role in this clinic. */
const DEMO_VET_NAME = "Demo Veterinarian";
/** This spec's branch names; the prefix is how an interrupted run's leftovers are recognized. */
const BRANCH_PREFIX = "Sucursal e2e ";

/** `apps/api/src/branches/branches.service.ts` — the sentences the API answers. */
const LAST_ACTIVE_MESSAGE = "Tiene que quedar al menos una sucursal activa.";
const PENDING_APPOINTMENT_MESSAGE =
  "La sucursal tiene 1 turno pendiente: reprogramalo o cancelalo antes de desactivarla.";
const ASSIGNMENT_PENDING_MESSAGE =
  "Esa persona tiene 1 turno pendiente en una sucursal que le quitás: reasignalo antes.";
/** `apps/api/src/branches/branch-scope.ts` — one `400` for foreign, unknown, inactive or unassigned. */
const NOT_WORKING_MESSAGE =
  "No trabajás en esa sucursal o está desactivada: elegí otra o pedí que te asignen.";

interface Branch {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly staffCount: number;
}

interface StaffMember {
  readonly membershipId: string;
  readonly email: string;
  readonly displayName: string;
  readonly roleCode: string;
  readonly branchIds: readonly string[];
}

interface CashRegister {
  readonly id: string;
  readonly name: string;
  readonly branchId: string;
  readonly branchName: string | null;
}

interface SaleDetail {
  readonly id: string;
  readonly status: string;
  readonly total: string;
  readonly branchId: string;
}

interface Appointment {
  readonly id: string;
  readonly branchId: string;
  readonly status: string;
  readonly startAt: string;
  readonly endAt: string;
}

interface ApiErrorBody {
  readonly error?: { readonly code?: string; readonly message?: string };
}

async function listBranches(request: APIRequestContext): Promise<Branch[]> {
  return (await bff<{ branches: Branch[] }>(request, "GET", "/api/branches")).branches;
}

/** The caller's ACTIVE working branches, as `/memberships/me/branches` reports them. */
async function workingBranchIds(request: APIRequestContext): Promise<string[]> {
  const body = await bff<{ branches: readonly { readonly id: string }[] }>(
    request,
    "GET",
    "/api/memberships/me/branches"
  );
  return body.branches.map((branch) => branch.id).sort();
}

async function listDirectory(request: APIRequestContext): Promise<StaffMember[]> {
  return (await bff<{ members: StaffMember[] }>(request, "GET", "/api/memberships/directory"))
    .members;
}

/** One refusal, with the exact status and the envelope the BFF relays. */
async function refusal(
  request: APIRequestContext,
  method: "POST" | "PUT",
  path: string,
  body?: unknown
): Promise<{ readonly status: number; readonly code: string; readonly message: string }> {
  const response =
    method === "POST"
      ? await request.post(path, { data: body ?? {} })
      : await request.put(path, { data: body ?? {} });
  const payload = (await response.json()) as ApiErrorBody;
  return {
    status: response.status(),
    code: payload.error?.code ?? "",
    message: payload.error?.message ?? "",
  };
}

/** Turnos still to happen, the ones that refuse a deactivation or an assignment removal. */
function isUpcoming(appointment: Appointment): boolean {
  return (
    (appointment.status === "SCHEDULED" || appointment.status === "CONFIRMED") &&
    Date.parse(appointment.endAt) > Date.now()
  );
}

/**
 * A run that died can leave its own ACTIVE branch behind, and that would make the last-active rule
 * unreachable for the next run. This closes the drawers and sessions INSIDE branches this spec
 * names, cancels their upcoming turnos and deactivates them. The clinic's own branch, other specs'
 * fixtures and every branch this spec did not name are left untouched.
 */
async function clearInterruptedRun(request: APIRequestContext): Promise<void> {
  const registers = await bff<CashRegister[]>(request, "GET", "/api/cash/registers");
  const open = await openSessions(request);
  const leftovers = (await listBranches(request)).filter(
    (branch) => branch.isActive && branch.name.startsWith(BRANCH_PREFIX)
  );
  for (const branch of leftovers) {
    const registerIds = registers
      .filter((register) => register.branchId === branch.id)
      .map((register) => register.id);
    for (const session of open.filter((candidate) => registerIds.includes(candidate.registerId))) {
      await closeSession(request, session.id);
    }
    const appointments = await bff<Appointment[]>(
      request,
      "GET",
      `/api/scheduling/appointments?branchId=${branch.id}`
    );
    for (const appointment of appointments.filter(isUpcoming)) {
      await bff(request, "POST", `/api/scheduling/appointments/${appointment.id}/cancel`, {});
    }
    await bff(request, "POST", `/api/branches/${branch.id}/deactivate`, {});
  }
}

/** Opens one person's branch editor and returns its checkbox group. */
async function openBranchEditor(page: Page, memberName: string) {
  const row = page.getByTestId("team-member").filter({ hasText: memberName });
  await row.getByRole("button", { name: "Sucursales" }).click();
  return { row, group: row.getByRole("group", { name: `Sucursales de ${memberName}` }) };
}

test.describe("branches and staff assignment", () => {
  test("a branch is created, staff assigned, both deactivation rules enforced, and cash and sales stay in the working branch", async ({
    page,
  }) => {
    await signInAsStaff(page);
    const request = page.request;
    await clearInterruptedRun(request);

    const tag = runTag();
    const branchName = `${BRANCH_PREFIX}${tag}`;
    const rejectedRegisterName = `Caja ajena ${tag}`;
    const item = await createCatalogItem(request, {
      name: `Consulta de sucursal ${tag}`,
      kind: "SERVICE",
      price: "25000.00",
    });

    const baselineBranches = (await listBranches(request)).filter((branch) => branch.isActive);
    expect(baselineBranches).toHaveLength(1);
    const [baselineBranch] = baselineBranches;
    if (baselineBranch === undefined) throw new Error("The demo clinic has no active branch.");
    expect(baselineBranch.name).toBe(BASELINE_BRANCH_NAME);
    expect(await workingBranchIds(request)).toEqual([baselineBranch.id]);

    let branchId: string | undefined;
    let sessionId: string | undefined;
    let appointmentId: string | undefined;
    let owner: StaffMember | undefined;
    let vet: StaffMember | undefined;
    let ownerAssigned = false;
    let vetAssigned = false;

    try {
      // --- The last-active rule, before a second branch exists --------------------------------
      await page.getByRole("link", { name: "Sucursales" }).click();
      await expect(page).toHaveURL(/\/app\/settings\/branches$/);
      await expect(page.getByRole("heading", { name: "Sucursales", level: 1 })).toBeVisible();
      const baselineRow = page.getByTestId("branch-row").filter({ hasText: BASELINE_BRANCH_NAME });
      await expect(baselineRow).toContainText("Activa");
      // The screen offers no action the API would refuse: with one active branch there is no
      // "Desactivar" at all, and the BFF answer below is what proves the rule.
      await expect(baselineRow.getByRole("button", { name: "Desactivar" })).toHaveCount(0);
      expect(
        await refusal(request, "POST", `/api/branches/${baselineBranch.id}/deactivate`)
      ).toEqual({ status: 409, code: "CONFLICT", message: LAST_ACTIVE_MESSAGE });
      const afterLastActive = await listBranches(request);
      expect(afterLastActive.filter((branch) => branch.isActive)).toHaveLength(1);
      expect(afterLastActive.find((branch) => branch.id === baselineBranch.id)?.isActive).toBe(
        true
      );

      // --- The branch is created on its own screen -------------------------------------------
      await page.getByRole("button", { name: "Agregar sucursal" }).click();
      const form = page.getByRole("region", { name: "Nueva sucursal" });
      await form.getByLabel("Nombre", { exact: true }).fill(branchName);
      await form.getByLabel("Dirección").fill(`Av. e2e ${tag}`);
      await form.getByRole("button", { name: "Agregar sucursal" }).click();
      await expect(page.getByTestId("branches-notice")).toHaveText(
        `${branchName} quedó agregada. Asigná quién trabaja ahí desde Personal.`
      );
      const branchRow = page.getByTestId("branch-row").filter({ hasText: branchName });
      await expect(branchRow).toContainText("Activa");
      await expect(branchRow).toContainText("0 personas asignadas");
      const created = (await listBranches(request)).find((branch) => branch.name === branchName);
      if (created === undefined) throw new Error(`${branchName} was not created.`);
      branchId = created.id;
      expect(created.isActive).toBe(true);

      // --- Until somebody is assigned, the branch is not a workplace -------------------------
      // A real active branch the owner does not work at: both writes answer the same 400 and
      // create nothing, which is what "la caja y las ventas respetan la sucursal de trabajo" means.
      expect(
        await refusal(request, "POST", "/api/sales", {
          branchId: created.id,
          lines: [{ catalogItemId: item.id, quantity: "1" }],
        })
      ).toEqual({ status: 400, code: "VALIDATION_FAILED", message: NOT_WORKING_MESSAGE });
      expect(await salesOf(request, item.id)).toHaveLength(0);
      expect(
        await refusal(request, "POST", "/api/cash/registers", {
          name: rejectedRegisterName,
          branchId: created.id,
        })
      ).toEqual({ status: 400, code: "VALIDATION_FAILED", message: NOT_WORKING_MESSAGE });
      expect(
        (await bff<CashRegister[]>(request, "GET", "/api/cash/registers")).some(
          (register) => register.name === rejectedRegisterName
        )
      ).toBe(false);

      // --- Staff assignment, on «Personal» ---------------------------------------------------
      owner = (await listDirectory(request)).find((member) => member.email === DEMO.staffEmail);
      vet = (await listDirectory(request)).find((member) => member.displayName === DEMO_VET_NAME);
      if (owner === undefined || vet === undefined) {
        throw new Error("The demo clinic's owner or veterinarian is missing.");
      }
      expect(vet.roleCode).toBe("VETERINARIAN");
      await page.getByRole("link", { name: "Personal" }).click();
      await expect(page).toHaveURL(/\/app\/settings\/team$/);
      const vetEditor = await openBranchEditor(page, vet.displayName);
      await expect(vetEditor.row).toContainText(BASELINE_BRANCH_NAME);
      await vetEditor.group.getByLabel(branchName).check();
      await vetEditor.row.getByRole("button", { name: "Guardar sucursales" }).click();
      await expect(page.getByTestId("team-notice")).toContainText(`${vet.displayName} trabaja en:`);
      await expect(page.getByTestId("team-notice")).toContainText(branchName);
      await expect(vetEditor.row.getByTestId("member-branches")).toContainText(branchName);
      vetAssigned = true;
      expect(
        (await listDirectory(request)).find((member) => member.membershipId === vet?.membershipId)
          ?.branchIds
      ).toEqual(expect.arrayContaining([baselineBranch.id, created.id]));

      // --- A turno in the new branch ---------------------------------------------------------
      const patient = (
        await bff<readonly { readonly id: string; readonly name: string }[]>(
          request,
          "GET",
          "/api/patients"
        )
      ).find((candidate) => candidate.name === DEMO.portalPetName);
      if (patient === undefined) throw new Error("The demo patient is missing.");
      const startAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      startAt.setUTCMinutes(Number.parseInt(tag.slice(-2), 36) % 60, 0, 0);
      const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);
      const appointment = await bff<Appointment>(request, "POST", "/api/scheduling/appointments", {
        branchId: created.id,
        patientId: patient.id,
        professionalMembershipId: vet.membershipId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      });
      appointmentId = appointment.id;
      expect(appointment.status).toBe("SCHEDULED");

      // --- The branch with a pending turno cannot be deactivated -----------------------------
      await page.getByRole("link", { name: "Sucursales" }).click();
      await expect(page.getByTestId("branch-row").filter({ hasText: branchName })).toContainText(
        "Activa"
      );
      await page
        .getByTestId("branch-row")
        .filter({ hasText: branchName })
        .getByRole("button", { name: "Desactivar" })
        .click();
      const deactivateDialog = page.getByRole("dialog", { name: `¿Desactivar ${branchName}?` });
      await deactivateDialog.getByRole("button", { name: "Desactivar", exact: true }).click();
      // The API's sentence reaches the operator, and the dialog stays open on the refusal.
      await expect(deactivateDialog.getByRole("alert")).toHaveText(PENDING_APPOINTMENT_MESSAGE);
      await deactivateDialog.getByRole("button", { name: "Volver" }).click();
      await expect(deactivateDialog).toBeHidden();
      expect(await refusal(request, "POST", `/api/branches/${created.id}/deactivate`)).toEqual({
        status: 409,
        code: "CONFLICT",
        message: PENDING_APPOINTMENT_MESSAGE,
      });
      expect(
        (await bff<Appointment>(request, "GET", `/api/scheduling/appointments/${appointment.id}`))
          .status
      ).toBe("SCHEDULED");
      expect(
        (await listBranches(request)).find((branch) => branch.id === created.id)?.isActive
      ).toBe(true);

      // --- Nor is that branch taken away from the person who has the turno -------------------
      await page.getByRole("link", { name: "Personal" }).click();
      const removedEditor = await openBranchEditor(page, vet.displayName);
      await removedEditor.group.getByLabel(branchName).uncheck();
      await removedEditor.row.getByRole("button", { name: "Guardar sucursales" }).click();
      await expect(removedEditor.row.getByRole("alert")).toHaveText(ASSIGNMENT_PENDING_MESSAGE);
      expect(
        (await listDirectory(request)).find((member) => member.membershipId === vet?.membershipId)
          ?.branchIds
      ).toContain(created.id);
      await removedEditor.row.getByRole("button", { name: "Cancelar" }).click();

      // --- The owner now works in two branches ----------------------------------------------
      const ownerEditor = await openBranchEditor(page, owner.displayName);
      await ownerEditor.group.getByLabel(branchName).check();
      await ownerEditor.row.getByRole("button", { name: "Guardar sucursales" }).click();
      await expect(page.getByTestId("team-notice")).toContainText(
        `${owner.displayName} trabaja en:`
      );
      await expect(page.getByTestId("team-notice")).toContainText(branchName);
      ownerAssigned = true;
      expect(await workingBranchIds(request)).toEqual([baselineBranch.id, created.id].sort());

      // --- The drawer belongs to the chosen branch ------------------------------------------
      await page.goto("/app/cash");
      await expect(page.getByRole("heading", { name: "Caja", level: 1 })).toBeVisible();
      await expect(page.getByTestId("registers-loading")).toHaveCount(0);
      const registerName = `Caja ${branchName}`;
      await page.getByLabel("Nombre de la caja").fill(registerName);
      // Offered only because the owner works at more than one active branch.
      await page.getByLabel("Sucursal", { exact: true }).selectOption({ label: branchName });
      await page.getByRole("button", { name: "Crear caja" }).click();
      await expect(page.getByTestId("register-created")).toContainText(
        `La caja "${registerName}" fue creada.`
      );
      await expect(page.getByRole("listitem").filter({ hasText: registerName })).toContainText(
        branchName
      );
      const register = (await bff<CashRegister[]>(request, "GET", "/api/cash/registers")).find(
        (candidate) => candidate.name === registerName
      );
      if (register === undefined) throw new Error(`${registerName} was not created.`);
      expect(register.branchId).toBe(created.id);
      expect(register.branchName).toBe(branchName);

      await page.getByLabel("Caja", { exact: true }).selectOption({ label: registerName });
      await page.getByLabel("Importe inicial").fill("50000,00");
      await page.getByRole("button", { name: "Abrir sesión" }).click();
      const opening = page.getByRole("dialog", { name: "Revisar apertura" });
      await opening.getByRole("button", { name: "Confirmar apertura" }).click();
      await expect(page.getByTestId("session-opened")).toContainText("Sesión abierta para la caja");
      const session = (await openSessions(request)).find(
        (candidate) => candidate.registerId === register.id
      );
      if (session === undefined) throw new Error("The branch drawer has no open session.");
      sessionId = session.id;

      // --- The sale is created and paid in that branch --------------------------------------
      await page.goto("/app/sales");
      await page.getByLabel("Nombre del artículo", { exact: true }).fill(item.name);
      await page.getByRole("button", { name: "Agregar a la venta", exact: true }).click();
      // Offered only because the owner works at more than one active branch.
      await page.getByLabel("Sucursal de la venta").selectOption({ label: branchName });
      await page.getByRole("button", { name: "Continuar al pago", exact: true }).click();
      await page.getByRole("button", { name: "Revisar venta", exact: true }).click();
      const review = page.getByRole("dialog", { name: "Revisar y confirmar venta" });
      await review.getByRole("button", { name: "Confirmar venta", exact: true }).click();
      await expect(page.getByText("Venta completada", { exact: true })).toBeVisible();

      const sales = await salesOf(request, item.id);
      expect(sales).toHaveLength(1);
      const saleId = sales[0]?.id ?? "";
      const detail = await bff<SaleDetail>(request, "GET", `/api/sales/${saleId}`);
      expect(detail.status).toBe("COMPLETED");
      expect(detail.branchId).toBe(created.id);
      // The cash went into the branch's own drawer, not to whichever drawer is open elsewhere.
      const movements = await sessionMovements(request, session.id);
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ type: "SALE", amount: detail.total });
    } finally {
      // Undo only what this run created, through the same public routes the browser uses.
      if (branchId !== undefined) {
        if (
          sessionId !== undefined &&
          (await openSessions(request)).some((session) => session.id === sessionId)
        ) {
          await closeSession(request, sessionId);
        }
        if (appointmentId !== undefined) {
          const current = await bff<Appointment>(
            request,
            "GET",
            `/api/scheduling/appointments/${appointmentId}`
          );
          if (isUpcoming(current)) {
            await bff(request, "POST", `/api/scheduling/appointments/${appointmentId}/cancel`, {});
          }
        }
        for (const [member, assigned] of [
          [owner, ownerAssigned],
          [vet, vetAssigned],
        ] as const) {
          if (member === undefined || !assigned) continue;
          const restored = await request.put(`/api/memberships/${member.membershipId}/branches`, {
            data: { branchIds: [baselineBranch.id] },
          });
          expect(
            restored.ok(),
            `Restoring ${member.displayName}'s branches answered ${restored.status()}: ` +
              (await restored.text())
          ).toBe(true);
        }
        const deactivated = await bff<{ branch: Branch }>(
          request,
          "POST",
          `/api/branches/${branchId}/deactivate`,
          {}
        );
        expect(deactivated.branch.isActive).toBe(false);
      }
    }

    // The lane is back where it started: one active branch, one workplace.
    expect(
      (await listBranches(request)).filter((branch) => branch.isActive).map((branch) => branch.id)
    ).toEqual([baselineBranch.id]);
    expect(await workingBranchIds(request)).toEqual([baselineBranch.id]);
  });
});

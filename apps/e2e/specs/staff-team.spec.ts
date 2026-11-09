import { expect, test, type Locator, type Page } from "@playwright/test";
import { startMailWorker, type MailWorker } from "../support/mail-worker.js";
import { resetLinkIn } from "../support/smtp-sink.js";
import { runTag, signInAsStaff } from "../support/staff.js";

/**
 * The staff screen, end to end ([[ONB-001]]): "Recorrido completo en el carril de navegador" over
 * "lista, invitar, reenviar, cambiar rol, suspender y reactivar, con confirmación y estados de
 * carga, error y permiso".
 *
 * The owner invites a new person on «Personal»; the invitation leaves BY MAIL (the worker mints
 * the token at send time, so the lane is the mail server, as in `recovery.spec.ts`); the invitee
 * activates with that link and signs in. The owner then re-sends (while still pending), changes the
 * role, suspends and reactivates — each command behind its confirmation — and the spec checks what
 * each one does to the person's access.
 *
 * Every run invites a NEW address: a profile can never be erased once it has acted, and the
 * activation delivery is deduped per (profile, hour).
 */
const PASSWORD = "invited-by-the-lane-password";

function memberRow(page: Page, name: string): Locator {
  return page.getByTestId("team-member").filter({ hasText: name });
}

test.describe("the staff screen", () => {
  let mail: MailWorker;

  test.beforeAll(async () => {
    mail = await startMailWorker();
  });

  test.afterAll(async () => {
    await mail?.stop();
  });

  test("invite, activate by mail, re-send, change role, suspend and reactivate", async ({
    page,
    browser,
  }) => {
    const tag = runTag();
    const name = `Invitada ${tag}`;
    const email = `invitee+e2e-${tag}@demo.newsaas.test`;

    await signInAsStaff(page);
    // The directory is held until the loading state has been seen, then released.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/memberships/directory", async (route) => {
      await held;
      await route.continue();
    });
    await page.getByRole("link", { name: "Personal" }).click();
    await expect(page).toHaveURL(/\/app\/settings\/team$/);
    await expect(page.getByRole("heading", { name: "Personal", level: 1 })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Cargando personal…" })).toBeAttached();
    // Released, later directory reads pass straight through the same route.
    release();
    // The list renders rows from the API: the owner is there, active.
    await expect(memberRow(page, "Demo Owner")).toContainText("Activo");

    // Invite. An empty form is refused in the page, before anything is sent.
    await page.getByRole("button", { name: "Invitar persona" }).click();
    const form = page.getByRole("region", { name: "Invitar a una persona" });
    await form.getByRole("button", { name: "Enviar invitación" }).click();
    await expect(form.getByText("Escribí el nombre.")).toBeVisible();
    await expect(form.getByText("Escribí un email válido.")).toBeVisible();
    await form.getByLabel("Nombre").fill(name);
    await form.getByLabel("Email").fill(email);
    await form.getByLabel("Rol").selectOption({ label: "Recepción" });
    await form.getByRole("button", { name: "Enviar invitación" }).click();
    await expect(page.getByTestId("team-notice")).toHaveText(
      `Invitación enviada a ${email}. Tiene 72 horas para activar su cuenta.`
    );
    const row = memberRow(page, name);
    await expect(row).toContainText("Invitación pendiente");
    await expect(row).toContainText(email);
    await expect(row.getByLabel(`Rol de ${name}`)).toHaveValue("RECEPTIONIST");

    // The activation link leaves by mail.
    const invitation = await mail.nextMessageTo(email);
    const link = resetLinkIn(invitation, "/reset-password");
    expect(link).toContain("activate=1");

    // Inviting the same address again is refused, with the API's reason, and nothing changes.
    await page.getByRole("button", { name: "Invitar persona" }).click();
    await form.getByLabel("Nombre").fill(name);
    await form.getByLabel("Email").fill(email);
    await form.getByRole("button", { name: "Enviar invitación" }).click();
    await expect(form.getByRole("alert")).toHaveText("Esa persona ya forma parte de esta clínica.");
    await page
      .getByTestId("team-surface")
      .getByRole("button", { name: "Cerrar", exact: true })
      .click();
    await expect(page.getByTestId("team-member").filter({ hasText: email })).toHaveCount(1);

    // Re-send while the invitation is pending.
    await row.getByRole("button", { name: "Reenviar invitación" }).click();
    await expect(page.getByTestId("team-notice")).toHaveText(
      `Se envió una nueva invitación a ${email}.`
    );

    // Change the role — behind a confirmation that can be backed out of.
    const role = row.getByLabel(`Rol de ${name}`);
    await role.selectOption({ label: "Caja" });
    const roleDialog = page.getByRole("dialog", { name: `¿Cambiar el rol de ${name}?` });
    await expect(roleDialog).toContainText("Pasa de Recepción a Caja.");
    await roleDialog.getByRole("button", { name: "Volver" }).click();
    await expect(roleDialog).toBeHidden();
    await expect(role).toHaveValue("RECEPTIONIST");
    await role.selectOption({ label: "Caja" });
    await roleDialog.getByRole("button", { name: "Cambiar rol" }).click();
    await expect(page.getByTestId("team-notice")).toHaveText(`${name} ahora tiene el rol Caja.`);
    await expect(role).toHaveValue("CASHIER");

    // The invitee activates with the link and signs in.
    const invitee = await browser.newContext();
    const inviteePage = await invitee.newPage();
    await inviteePage.goto(link);
    await expect(inviteePage.getByRole("heading", { name: "Activá tu cuenta" })).toBeVisible();
    await inviteePage.fill("#reset-password", PASSWORD);
    await inviteePage.fill("#reset-confirmation", PASSWORD);
    await inviteePage.getByRole("button", { name: "Activar cuenta" }).click();
    await expect(inviteePage.getByTestId("reset-done")).toContainText(
      "Ya podés ingresar con tu email y la contraseña que elegiste."
    );
    await signInAsStaff(inviteePage, email, PASSWORD);
    await expect(inviteePage.getByTestId("nav-sidebar")).toBeVisible();
    expect((await inviteePage.request.get("/api/cash/registers")).status()).toBe(200);
    await inviteePage.goto("/app/cash");
    await expect(inviteePage.getByText("Cajas", { exact: true })).toBeVisible();
    await expect(inviteePage.getByTestId("registers-loading")).toHaveCount(0);
    await expect(inviteePage.getByTestId("registers-error")).toHaveCount(0);
    // As «Caja» the person holds no staff-management permission: the screen says so, and the
    // backend is what refused.
    await inviteePage.goto("/app/settings/team");
    await expect(inviteePage.getByText("No tenés permiso para ver el personal")).toBeVisible();
    await expect(inviteePage.getByRole("button", { name: "Invitar persona" })).toHaveCount(0);
    expect((await inviteePage.request.get("/api/memberships/directory")).status()).toBe(403);

    // On the owner's screen the person is now active, with nothing left to re-send.
    await page.reload();
    await expect(row).toContainText("Activo");
    await expect(row.getByRole("button", { name: "Reenviar invitación" })).toHaveCount(0);

    // The API refuses suspending one's own access; the dialog stays open with the reason.
    await memberRow(page, "Demo Owner").getByRole("button", { name: "Suspender" }).click();
    const selfDialog = page.getByRole("dialog", { name: "¿Suspender a Demo Owner?" });
    await selfDialog.getByRole("button", { name: "Suspender acceso" }).click();
    await expect(selfDialog).toContainText("No podés suspender tu propio acceso.");
    await selfDialog.getByRole("button", { name: "Volver" }).click();
    await expect(selfDialog).toBeHidden();
    await expect(memberRow(page, "Demo Owner")).toContainText("Activo");

    // Suspend, confirmed.
    await row.getByRole("button", { name: "Suspender" }).click();
    const suspendDialog = page.getByRole("dialog", { name: `¿Suspender a ${name}?` });
    await expect(suspendDialog).toContainText("No va a poder ingresar a esta clínica");
    await suspendDialog.getByRole("button", { name: "Suspender acceso" }).click();
    await expect(page.getByTestId("team-notice")).toHaveText(
      `${name} ya no puede ingresar a esta clínica.`
    );
    await expect(row).toContainText("Suspendido");
    await expect(role).toBeDisabled();

    // What suspension means in this product: the credential still authenticates, but the clinic is
    // closed to the person. Every clinic request answers 403 ("An active tenant membership is
    // required."), for a fresh sign-in and for the session that was already open, and instead of a
    // workspace full of permission errors the person sees one explanation and a way out.
    const suspended = await browser.newContext();
    const suspendedPage = await suspended.newPage();
    await signInAsStaff(suspendedPage, email, PASSWORD);
    await suspendedPage.goto("/app/cash");
    await expect(
      suspendedPage.getByRole("heading", { name: "Tu acceso no está activo" })
    ).toBeVisible();
    await expect(suspendedPage.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    await expect(suspendedPage.getByTestId("nav-sidebar")).toHaveCount(0);
    await expect(suspendedPage.getByTestId("registers-error")).toHaveCount(0);
    expect((await suspendedPage.request.get("/api/cash/registers")).status()).toBe(403);
    expect((await inviteePage.request.get("/api/cash/registers")).status()).toBe(403);

    // Reactivate, confirmed.
    await row.getByRole("button", { name: "Reactivar" }).click();
    const reactivateDialog = page.getByRole("dialog", { name: `¿Reactivar a ${name}?` });
    await reactivateDialog.getByRole("button", { name: "Reactivar acceso" }).click();
    await expect(page.getByTestId("team-notice")).toHaveText(`${name} puede volver a ingresar.`);
    await expect(row).toContainText("Activo");
    await expect(role).toBeEnabled();
    await expect(role).toHaveValue("CASHIER");

    // Reactivated, the person is back in the clinic with the role they had.
    expect((await inviteePage.request.get("/api/cash/registers")).status()).toBe(200);
    await suspendedPage.reload();
    await expect(suspendedPage.getByText("Cajas", { exact: true })).toBeVisible();
    await expect(suspendedPage.getByTestId("registers-loading")).toHaveCount(0);
    await expect(suspendedPage.getByTestId("registers-error")).toHaveCount(0);

    await invitee.close();
    await suspended.close();
  });
});

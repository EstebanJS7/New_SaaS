import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { signInAsStaff } from "../support/staff.js";

/**
 * «Configuración › General» ([[CFG-001]]), driven through the built apps.
 *
 * The demo tenant's settings are SHARED with every other spec: the sales flows read
 * `requireCustomerForInvoice`, the agenda and the branch flow book appointments under
 * `conflictPolicy`, `availability` and `blocks`, the portal reads `bookingRequiresApproval` and the
 * worker reads the reminder policy. So the spec reads all four namespaces through the BFF BEFORE it
 * changes anything and, in a `finally`, writes each one back WHOLE (the API replaces arrays) and
 * asserts the read equals what it found. The API has no DELETE for a namespace, so a tenant that
 * had no stored row ends with one holding exactly the values it was already served.
 *
 * Values that can vary do so per run (lead hours, weekday, times, block date), so a run that
 * reads an earlier run's leftovers fails instead of passing on them.
 */

type Settings = Record<string, unknown>;
const NAMESPACES = ["sales", "portal", "notifications", "scheduling"] as const;
type Namespace = (typeof NAMESPACES)[number];

async function readSettings(request: APIRequestContext, namespace: Namespace): Promise<Settings> {
  const response = await request.get(`/api/settings/${namespace}`);
  if (!response.ok()) {
    throw new Error(`GET ${namespace} answered ${response.status()}: ${await response.text()}`);
  }
  return ((await response.json()) as { settings: Settings }).settings;
}

async function writeSettings(
  request: APIRequestContext,
  namespace: Namespace,
  settings: Settings
): Promise<void> {
  const response = await request.put(`/api/settings/${namespace}`, { data: settings });
  if (!response.ok()) {
    throw new Error(`PUT ${namespace} answered ${response.status()}: ${await response.text()}`);
  }
}

function section(page: Page, namespace: Namespace): Locator {
  return page.getByTestId(`settings-section-${namespace}`);
}

/** Clicks the section's own «Guardar» and waits for its success message. */
async function saveSection(page: Page, namespace: Namespace, button = "Guardar"): Promise<void> {
  const target = section(page, namespace);
  await target.getByRole("button", { name: button, exact: true }).click();
  await expect(
    target.getByRole("status").filter({ hasText: "Se guardaron los cambios." })
  ).toBeVisible();
}

async function reloadSettings(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
}

/** The first real option of a picker (index 0 is the «Elegí…» placeholder). */
async function firstOption(select: Locator): Promise<{ value: string; label: string }> {
  const option = select.locator("option").nth(1);
  await expect(option).toBeAttached();
  return {
    value: (await option.getAttribute("value")) ?? "",
    label: ((await option.textContent()) ?? "").trim(),
  };
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

const pad2 = (value: number): string => String(value).padStart(2, "0");
const hhmm = (minute: number): string => `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
const WEEKDAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

test.describe("tenant settings screen", () => {
  // A browser far from the clinic: the agenda's minutes and the block instants must follow the
  // clinic's zone (America/Asuncion), never the browser's.
  test.use({ timezoneId: "America/Los_Angeles" });

  test("the owner edits sales, portal, notifications and scheduling settings", async ({ page }) => {
    test.setTimeout(150_000);
    await signInAsStaff(page);
    const request = page.request;

    const originals = new Map<Namespace, Settings>();
    try {
      for (const namespace of NAMESPACES) {
        originals.set(namespace, await readSettings(request, namespace));
      }
      const original = (namespace: Namespace): Settings => originals.get(namespace) ?? {};

      // The link lives in «Configuración».
      await page.getByRole("link", { name: "General", exact: true }).first().click();
      await expect(page).toHaveURL(/\/app\/settings\/general$/);
      await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();

      // 1. Ventas: the invoice-requires-customer toggle persists; the currency is read-only.
      const sales = section(page, "sales");
      const requireCustomer = sales.getByLabel("La factura exige cliente");
      const wasRequired = original("sales").requireCustomerForInvoice === true;
      await expect(requireCustomer).toBeChecked({ checked: wasRequired });
      const currency = sales.getByLabel("Moneda");
      await expect(currency).toHaveValue(String(original("sales").defaultCurrency));
      await expect(currency).toHaveAttribute("readonly", "");
      await requireCustomer.setChecked(!wasRequired);
      await saveSection(page, "sales");
      await reloadSettings(page);
      await expect(section(page, "sales").getByLabel("La factura exige cliente")).toBeChecked({
        checked: !wasRequired,
      });
      expect(await readSettings(request, "sales")).toEqual({
        ...original("sales"),
        requireCustomerForInvoice: !wasRequired,
      });

      // 2. Portal: the booking-approval toggle persists.
      const approval = section(page, "portal").getByLabel("Las reservas necesitan aprobación");
      const neededApproval = original("portal").bookingRequiresApproval === true;
      await expect(approval).toBeChecked({ checked: neededApproval });
      await approval.setChecked(!neededApproval);
      await saveSection(page, "portal");
      await reloadSettings(page);
      await expect(
        section(page, "portal").getByLabel("Las reservas necesitan aprobación")
      ).toBeChecked({ checked: !neededApproval });
      expect(await readSettings(request, "portal")).toEqual({
        bookingRequiresApproval: !neededApproval,
      });

      // 3. Notificaciones: out of range is refused in the page, with no request; a valid lead
      //    time and a changed channel set persist.
      const notifications = section(page, "notifications");
      const hours = notifications.getByLabel("Horas de anticipación del recordatorio");
      await expect(hours).toHaveValue(
        String(original("notifications").appointmentReminderLeadHours)
      );
      let settingsPuts = 0;
      page.on("request", (sent) => {
        if (sent.method() === "PUT" && sent.url().includes("/api/settings/")) settingsPuts += 1;
      });
      await hours.fill("169");
      await notifications.getByRole("button", { name: "Guardar", exact: true }).click();
      await expect(
        notifications.getByText("Elegí un número entero de horas entre 1 y 168.")
      ).toBeVisible();
      await expect(hours).toHaveAttribute("aria-invalid", "true");
      expect(settingsPuts).toBe(0);

      const originalHours = Number(original("notifications").appointmentReminderLeadHours);
      let leadHours = randomInt(2, 167);
      if (leadHours === originalHours) leadHours += 1;
      const originalChannels = original("notifications").appointmentReminderChannels as string[];
      // Flip WhatsApp, keeping e-mail on so the set is never empty.
      const whatsappOn = originalChannels.includes("WHATSAPP");
      const expectedChannels = whatsappOn ? ["EMAIL"] : ["EMAIL", "WHATSAPP"];
      await hours.fill(String(leadHours));
      await notifications.getByLabel("Correo electrónico").setChecked(true);
      await notifications.getByLabel("WhatsApp").setChecked(!whatsappOn);
      await saveSection(page, "notifications");
      expect(settingsPuts).toBe(1);
      await reloadSettings(page);
      const reloadedNotifications = section(page, "notifications");
      await expect(
        reloadedNotifications.getByLabel("Horas de anticipación del recordatorio")
      ).toHaveValue(String(leadHours));
      await expect(reloadedNotifications.getByLabel("Correo electrónico")).toBeChecked();
      await expect(reloadedNotifications.getByLabel("WhatsApp")).toBeChecked({
        checked: !whatsappOn,
      });
      expect(await readSettings(request, "notifications")).toEqual({
        appointmentReminderLeadHours: leadHours,
        appointmentReminderChannels: expectedChannels,
      });

      // 4a. Agenda: the conflict policy persists and never carries the lists.
      const scheduling = section(page, "scheduling");
      const wasAllow = original("scheduling").conflictPolicy === "ALLOW";
      const targetPolicy = wasAllow ? "REJECT" : "ALLOW";
      await scheduling
        .getByRole("radio", { name: wasAllow ? /^No permitir turnos/ : /^Permitir turnos/ })
        .check();
      await saveSection(page, "scheduling");
      await reloadSettings(page);
      await expect(
        section(page, "scheduling").getByRole("radio", {
          name: wasAllow ? /^No permitir turnos/ : /^Permitir turnos/,
        })
      ).toBeChecked();
      expect(await readSettings(request, "scheduling")).toEqual({
        ...original("scheduling"),
        conflictPolicy: targetPolicy,
      });

      // 4b. A window and a block, entered in clinic time from the pickers.
      const agenda = section(page, "scheduling");
      const newWindow = agenda.getByRole("group", { name: "Nuevo horario" });
      const professional = await firstOption(newWindow.getByLabel("Profesional"));
      const branch = await firstOption(newWindow.getByLabel("Sucursal"));
      const weekday = randomInt(0, 6);
      const startMinute = randomInt(6 * 4, 10 * 4) * 15; // 06:00-10:00, quarter hours
      const endMinute = startMinute + 4 * 60;
      await newWindow.getByLabel("Profesional").selectOption(professional.value);
      await newWindow.getByLabel("Sucursal").selectOption(branch.value);
      await newWindow.getByLabel("Día").selectOption(String(weekday));
      await newWindow.getByLabel("Desde").fill(hhmm(startMinute));
      await newWindow.getByLabel("Hasta").fill(hhmm(endMinute));
      await newWindow.getByRole("button", { name: "Agregar horario" }).click();

      // December: Paraguay is at UTC-03 under both the old and the current tz rules.
      const year = 2030 + randomInt(0, 9);
      const day = randomInt(1, 27);
      const blockHour = randomInt(8, 15);
      const blockMinute = randomInt(0, 3) * 15;
      const date = `${year}-12-${pad2(day)}`;
      const localFrom = `${date}T${pad2(blockHour)}:${pad2(blockMinute)}`;
      const localTo = `${date}T${pad2(blockHour + 2)}:${pad2(blockMinute)}`;
      const newBlock = agenda.getByRole("group", { name: "Nuevo bloqueo" });
      await newBlock.getByLabel("Profesional").selectOption(professional.value);
      await newBlock.getByLabel("Sucursal").selectOption(branch.value);
      await newBlock.getByLabel("Desde").fill(localFrom);
      await newBlock.getByLabel("Hasta").fill(localTo);
      await newBlock.getByRole("button", { name: "Agregar bloqueo" }).click();
      await saveSection(page, "scheduling", "Guardar horarios y bloqueos");

      await reloadSettings(page);
      const windowLabel = (end: number): string =>
        `el horario de ${professional.label}, ${WEEKDAY_LABELS[weekday]} de ${hhmm(
          startMinute
        )} a ${hhmm(end)}`;
      const shownDate = `${pad2(day)}/12/${year}`;
      const blockLabel = `el bloqueo de ${professional.label} desde ${shownDate} ${pad2(
        blockHour
      )}:${pad2(blockMinute)} hasta ${shownDate} ${pad2(blockHour + 2)}:${pad2(blockMinute)}`;
      const reloadedAgenda = section(page, "scheduling");
      await expect(
        reloadedAgenda.getByRole("button", { name: `Editar ${windowLabel(endMinute)}` })
      ).toBeVisible();
      await expect(
        reloadedAgenda.getByRole("button", { name: `Editar ${blockLabel}` })
      ).toBeVisible();

      const savedWindow = {
        membershipId: professional.value,
        branchId: branch.value,
        weekday,
        startMinute,
        endMinute,
      };
      const isoUtc = (hour: number): string =>
        `${date}T${pad2(hour + 3)}:${pad2(blockMinute)}:00.000Z`;
      const savedBlock = {
        membershipId: professional.value,
        branchId: branch.value,
        startsAt: isoUtc(blockHour),
        endsAt: isoUtc(blockHour + 2),
      };
      const originalAvailability = original("scheduling").availability as unknown[];
      const originalBlocks = original("scheduling").blocks as unknown[];
      expect(await readSettings(request, "scheduling")).toEqual({
        conflictPolicy: targetPolicy,
        availability: [...originalAvailability, savedWindow],
        blocks: [...originalBlocks, savedBlock],
      });

      // 4c. Edit the window's end, remove the block, save once.
      const editedEnd = endMinute + 60;
      await reloadedAgenda
        .getByRole("button", { name: `Editar ${windowLabel(endMinute)}` })
        .click();
      const editWindow = reloadedAgenda.getByRole("group", { name: "Editar horario" });
      await expect(editWindow.getByLabel("Desde")).toHaveValue(hhmm(startMinute));
      await editWindow.getByLabel("Hasta").fill(hhmm(editedEnd));
      await editWindow.getByRole("button", { name: "Actualizar horario" }).click();
      await reloadedAgenda.getByRole("button", { name: `Quitar ${blockLabel}` }).click();
      await saveSection(page, "scheduling", "Guardar horarios y bloqueos");

      await reloadSettings(page);
      const finalAgenda = section(page, "scheduling");
      await expect(
        finalAgenda.getByRole("button", { name: `Editar ${windowLabel(editedEnd)}` })
      ).toBeVisible();
      await expect(finalAgenda.getByRole("button", { name: `Editar ${blockLabel}` })).toHaveCount(
        0
      );
      expect(await readSettings(request, "scheduling")).toEqual({
        conflictPolicy: targetPolicy,
        availability: [...originalAvailability, { ...savedWindow, endMinute: editedEnd }],
        blocks: originalBlocks,
      });
    } finally {
      // Every namespace back to what this run found, whole, and read back to prove it.
      for (const [namespace, settings] of originals) {
        await writeSettings(request, namespace, settings);
      }
      for (const [namespace, settings] of originals) {
        expect(await readSettings(request, namespace)).toEqual(settings);
      }
    }
  });
});

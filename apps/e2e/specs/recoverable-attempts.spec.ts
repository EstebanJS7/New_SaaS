import { expect, test, type Page, type Route } from "@playwright/test";
import {
  bff,
  closeSession,
  createCatalogItem,
  openSessions,
  runTag,
  salesOf,
  signInAsStaff,
  type CashSession,
} from "../support/staff.js";

/**
 * Lost answers in the browser ([[UX-035]]): "que una venta, una apertura de caja o un movimiento
 * cuya respuesta se perdió se puedan identificar con certeza, incluso tras recargar la página, sin
 * reenviar a ciegas ni comparar valores."
 *
 * The answer is lost for real: `page.route` lets the command reach the API — which commits it —
 * and then drops the connection before the page sees the response. The spec then does what a person
 * would (reload, or stay and ask), and counts through the API that exactly one record exists, both
 * after the lookup and after a retry with the attempt's own key.
 */

/** Lets the request reach the server, keeps its key and receipt, and drops the answer. */
async function commitThenDrop(
  route: Route,
  seen: { key?: string; body?: unknown; id?: string }
): Promise<void> {
  const request = route.request();
  seen.key = request.headers()["idempotency-key"];
  seen.body = request.postDataJSON();
  const response = await route.fetch();
  expect(response.status()).toBe(201);
  seen.id = ((await response.json()) as { id: string }).id;
  await route.abort("connectionreset");
}

async function addItemAndCheckout(page: Page, itemName: string): Promise<void> {
  await page.goto("/app/sales");
  await page.getByLabel("Nombre del artículo", { exact: true }).fill(itemName);
  await page.getByRole("button", { name: "Agregar a la venta", exact: true }).click();
  await page.getByRole("button", { name: "Continuar al pago", exact: true }).click();
}

const UNCERTAIN_SALE = "No pudimos confirmar si se creó la venta.";

test.describe("recoverable attempts", () => {
  test("a sale whose answer was lost is found by its key after a reload, and a retry replays it", async ({
    page,
  }) => {
    await signInAsStaff(page);
    const item = await createCatalogItem(page.request, {
      name: `Vacuna intento ${runTag()}`,
      kind: "SERVICE",
      price: "75000.00",
    });

    const seen: { key?: string; body?: unknown; id?: string } = {};
    await page.route("**/api/sales", (route) =>
      route.request().method() === "POST" ? commitThenDrop(route, seen) : route.continue()
    );
    await addItemAndCheckout(page, item.name);
    await expect(page.getByTestId("create-error")).toContainText(UNCERTAIN_SALE);
    await expect(page.getByRole("button", { name: "Consultar si se creó" })).toBeVisible();
    expect(seen.key).toMatch(/^[0-9a-f-]{36}$/);

    // The server did create it — once.
    let sales = await salesOf(page.request, item.id);
    expect(sales.map((sale) => [sale.id, sale.status])).toEqual([[seen.id, "DRAFT"]]);

    // Reload: the page's copy is gone; the tab remembers only the attempt's key.
    await page.unroute("**/api/sales");
    await page.reload();
    const panel = page.getByTestId("pending-sale-attempts");
    await expect(panel).toContainText("Hay ventas de un intento anterior sin confirmar");
    const lookup = page.waitForResponse((response) =>
      response.url().endsWith(`/api/sales/attempts/${seen.key ?? ""}`)
    );
    await panel.getByRole("button", { name: "Consultar", exact: true }).click();
    expect((await lookup).status()).toBe(200);
    const found = panel.getByRole("link", { name: "Se creó: abrir la venta" });
    await expect(found).toHaveAttribute("href", `/app/sales/${seen.id ?? ""}`);
    await found.click();
    await expect(page).toHaveURL(new RegExp(`/app/sales/${seen.id ?? ""}$`));
    await expect(page.getByText("Venta borrador.", { exact: false })).toBeVisible();

    // The lookup sent nothing new, and once answered the attempt is forgotten.
    sales = await salesOf(page.request, item.id);
    expect(sales.map((sale) => sale.id)).toEqual([seen.id]);
    await page.goto("/app/sales");
    await expect(page.getByRole("heading", { name: "Punto de venta" })).toBeVisible();
    await expect(page.getByTestId("pending-sale-attempts")).toHaveCount(0);

    // A retry of that attempt — same key, same body — replays the same draft instead of a second one.
    const replay = await page.request.post("/api/sales", {
      data: seen.body,
      headers: { "idempotency-key": seen.key ?? "" },
    });
    expect(replay.status()).toBe(200);
    expect(((await replay.json()) as { id: string }).id).toBe(seen.id);
    sales = await salesOf(page.request, item.id);
    expect(sales.map((sale) => sale.id)).toEqual([seen.id]);
  });

  test("a sale request lost before the server is reported absent, and the retry reuses its key", async ({
    page,
  }) => {
    await signInAsStaff(page);
    const item = await createCatalogItem(page.request, {
      name: `Baño intento ${runTag()}`,
      kind: "SERVICE",
      price: "30000.00",
    });

    const keys: string[] = [];
    let dropped = false;
    await page.route("**/api/sales", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().headers()["idempotency-key"] ?? "");
      if (!dropped) {
        dropped = true;
        return route.abort("connectionreset");
      }
      return route.continue();
    });
    await addItemAndCheckout(page, item.name);
    await expect(page.getByTestId("create-error")).toContainText(UNCERTAIN_SALE);
    expect(await salesOf(page.request, item.id)).toHaveLength(0);

    await page.getByRole("button", { name: "Consultar si se creó" }).click();
    await expect(page.getByTestId("attempt-absent")).toContainText(
      "El servidor no registró ese intento."
    );
    await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Revisar venta", exact: true })).toBeVisible();

    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
    const sales = await salesOf(page.request, item.id);
    expect(sales.map((sale) => sale.status)).toEqual(["DRAFT"]);
  });

  test("a cash opening whose answer was lost is found by its key after a reload", async ({
    page,
  }) => {
    await signInAsStaff(page);
    const request = page.request;
    // One open session per branch is what a cash sale needs; this test leaves exactly the one it
    // opens, so it starts by closing the others.
    for (const session of await openSessions(request)) await closeSession(request, session.id);
    const registerName = `Caja intento ${runTag()}`;
    const register = await bff<{ id: string }>(request, "POST", "/api/cash/registers", {
      name: registerName,
    });

    const seen: { key?: string; body?: unknown; id?: string } = {};
    await page.route("**/api/cash/sessions", (route) =>
      route.request().method() === "POST" ? commitThenDrop(route, seen) : route.continue()
    );
    await page.goto("/app/cash");
    await page.locator("#cash-session-register").selectOption({ label: registerName });
    await page.locator("#cash-session-opening-amount").fill("50.000");
    await page.getByRole("button", { name: "Abrir sesión", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Revisar apertura" })
      .getByRole("button", { name: "Confirmar apertura", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Consultar si se abrió" })).toBeVisible();
    expect(seen.key).toMatch(/^[0-9a-f-]{36}$/);

    const openedFor = async (): Promise<CashSession[]> =>
      (await openSessions(request)).filter((session) => session.registerId === register.id);
    expect((await openedFor()).map((session) => session.id)).toEqual([seen.id]);

    await page.unroute("**/api/cash/sessions");
    await page.reload();
    const panel = page.getByTestId("pending-cash-attempts");
    await expect(panel).toContainText(
      "Hay operaciones de Caja de un intento anterior sin confirmar"
    );
    await expect(panel).toContainText("Apertura de sesión de las");
    const lookup = page.waitForResponse((response) =>
      response.url().endsWith(`/api/cash/sessions/attempts/${seen.key ?? ""}`)
    );
    await panel.getByRole("button", { name: "Consultar", exact: true }).click();
    expect((await lookup).status()).toBe(200);
    await expect(panel).toContainText("Se abrió: la sesión quedó seleccionada.");
    await expect(page.getByRole("button", { name: "Seleccionada", exact: true })).toHaveCount(1);

    // A retry with the attempt's key replays the same session; nothing was opened twice.
    const replay = await request.post("/api/cash/sessions", {
      data: seen.body,
      headers: { "idempotency-key": seen.key ?? "" },
    });
    expect(replay.status()).toBe(200);
    expect(((await replay.json()) as { id: string }).id).toBe(seen.id);
    expect((await openedFor()).map((session) => session.id)).toEqual([seen.id]);
    expect(await openSessions(request)).toHaveLength(1);
  });
});

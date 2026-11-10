import { expect, test } from "@playwright/test";
import {
  configureElectronicIssuance,
  createFiscalServiceItem,
  sellAndApprove,
} from "../support/fiscal-issuance.js";
import { FISCAL_WORKER_ENV } from "../support/fiscal-worker.js";
import { startMailWorker, type MailWorker } from "../support/mail-worker.js";
import { mimeAttachments } from "../support/mime.js";
import { bff, runTag, signInAsStaff } from "../support/staff.js";

/**
 * The KuDE, from the worker's signature to the staff's tab and the customer's inbox ([[FISC-021]],
 * [[DEC-098]]), driven end to end through the built apps.
 *
 * ONE worker runs the fiscal pipeline (fake SIFEN provider, TEST environment, signed DE) AND sends
 * mail through the real `nodemailer` adapter to the lane's SMTP sink. It has to be one process:
 * `FiscalApproved` is dispatched in-process, so the approval notice is scheduled by whichever worker
 * approved the document, and two consumers of the fiscal queue would race for it.
 *
 * 1. «Configuración fiscal» converged through the screen (the shared fiscal setup).
 * 2. A customer with an EMAIL contact — the fiscal notice is addressed to the invoice's customer and
 *    resolved to its active email contact at send time — and an item.
 * 3. A cash sale, its invoice confirmed and issued; the worker signs it, stores the KuDE and the
 *    document reaches APPROVED.
 * 4. The fiscal surface's detail offers «Ver KuDE» as a new-tab link to the BFF route.
 * 5. The route, through the page's own session, serves the stored HTML with the CDC and the QR as
 *    an image; the link opens it in a new tab.
 * 6. The approval notice arrives with the same bytes attached as `kude-<serie>-<número>.html`.
 *
 * Names and the recipient carry a per-run tag, so documents and messages earlier runs left behind
 * never stand in for this run's.
 */

let worker: MailWorker | undefined;

test.beforeAll(async () => {
  worker = await startMailWorker(FISCAL_WORKER_ENV);
});

test.afterAll(async () => {
  await worker?.stop();
});

/** The CDC as the KuDE prints it: groups of four digits (`groupKudeCdc`). */
function groupedCdc(cdc: string): string {
  return (cdc.match(/.{1,4}/g) ?? []).join(" ");
}

test.describe("KuDE delivery", () => {
  test("an approved factura electrónica's KuDE opens from the fiscal detail and rides the approval email", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signInAsStaff(page);
    const request = page.request;
    const workerOutput = (): string => worker?.output() ?? "(not started)";

    // 1. Fiscal settings, all through the screen.
    await configureElectronicIssuance(page);

    // 2. A receptor the notice can reach, and the item.
    const tag = runTag();
    const recipient = `kude+e2e-${tag}@demo.newsaas.test`;
    const customer = await bff<{ id: string }>(request, "POST", "/api/customers", {
      kind: "INDIVIDUAL",
      displayName: `Cliente KuDE ${tag}`,
      firstName: "Cliente",
      lastName: `KuDE ${tag}`,
      documentNumber: String(1_000_000 + (Date.now() % 8_000_000)),
      fiscalOperationType: "B2C",
    });
    await bff(request, "POST", `/api/customers/${customer.id}/contacts`, {
      kind: "EMAIL",
      value: recipient,
      isPrimary: true,
    });
    const item = await createFiscalServiceItem(request, `Consulta KuDE ${tag}`);

    // 3. Sold, invoiced, issued and approved by the worker, which stored the KuDE when it signed.
    const { approved } = await sellAndApprove(page, {
      customerId: customer.id,
      itemId: item.id,
      workerOutput,
    });
    const cdc = approved.cdc ?? "";
    expect(approved.hasKude).toBe(true);
    const kudeHref = `/api/fiscal/fiscal-documents/${approved.id}/kude`;

    // 4. The staff's fiscal detail offers the KuDE as a new-tab link.
    await page.goto("/app/fiscal");
    const row = page
      .getByTestId("fiscal-list-item")
      .filter({ hasText: `Documento fiscal #${approved.id.slice(0, 8)}` });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "Seleccionar documento", exact: true }).click();
    await expect(page.getByTestId("fiscal-cdc")).toHaveText(cdc);
    const link = page.getByTestId("fiscal-kude-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveText("Ver KuDE");
    await expect(link).toHaveAttribute("href", kudeHref);
    await expect(link).toHaveAttribute("target", "_blank");

    // 5. The route serves the stored KuDE through the page's own session.
    const response = await request.get(kudeHref);
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["content-disposition"]).toMatch(/^inline; filename="kude-[A-Za-z0-9-]+\.html"$/);
    const served = await response.body();
    const html = served.toString("utf8");
    expect(html).toContain(`CDC: ${groupedCdc(cdc)}`);
    const qr =
      /<img class="qr" alt="QR" src="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)" \/>/.exec(html);
    expect(qr).not.toBeNull();
    // The QR is an SVG drawing, not the text placeholder a KuDE without an image prints.
    const svg = Buffer.from(qr?.[1] ?? "", "base64").toString("utf8");
    expect(svg).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    expect(html).not.toContain('class="qr-content"');

    // ...and the link opens it in a tab of its own.
    const [tab] = await Promise.all([page.context().waitForEvent("page"), link.click()]);
    await tab.waitForLoadState();
    expect(new URL(tab.url()).pathname).toBe(kudeHref);
    await expect(tab).toHaveTitle(/^KuDE de Factura Electrónica /);
    await expect(tab.getByText(`CDC: ${groupedCdc(cdc)}`, { exact: true })).toBeVisible();
    await expect(tab.getByRole("img", { name: "QR" })).toBeVisible();
    await tab.close();

    // 6. The approval notice carries the same bytes as its one attachment.
    if (worker === undefined) throw new Error("The worker was not started.");
    const raw = await worker.nextMessageTo(recipient, 60_000);
    const attachments = mimeAttachments(raw);
    expect(attachments).toHaveLength(1);
    const [kude] = attachments;
    expect(kude?.contentType).toMatch(/^text\/html; charset=utf-8(;|$)/i);
    expect(kude?.filename).toMatch(/^kude-[A-Za-z0-9-]+\.html$/);
    expect(kude?.content.equals(served)).toBe(true);
  });
});

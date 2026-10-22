import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { DEMO } from "./fixtures.js";

/** The repository root, so the worker is spawned from a path, not from a shell. */
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * The staff imports surface ([[IMP-005]]), driven by a real browser: sign in, open
 * Imports, upload a CSV written by this spec, watch the preview land, read the row
 * table, commit, and read the summary — including the row that FAILED and the
 * reason it failed.
 *
 * **THE FULL FLOW NEEDS SHARED OBJECT STORAGE, AND THE LANE NOW HAS IT** ([[TD-060]]
 * closed by [[DEC-077]] / [[HARD-003]]). The API writes the uploaded CSV through
 * `StorageModule`, which wires S3 only when `STORAGE_S3_BUCKET` is present and otherwise
 * falls back to a per-process in-memory driver. With the fallback the API stores the file
 * in its own memory and the worker — a different process — finds nothing, so the preview
 * fails on an artefact it cannot read.
 *
 * CI now starts MinIO and sets the storage variables, and `globalSetup` creates the
 * bucket; so the full-flow test below RUNS there rather than skipping. The guard is
 * kept, deliberately: a lane started without object storage genuinely cannot run this
 * flow, and it should say so with the variable's name instead of failing on a preview
 * that reads an artefact from another process' memory. The second test still proves the
 * half a storage-less lane can reach, which is everything up to the artefact read.
 *
 * **THE WORKER IS THIS SPEC'S OWN RESPONSIBILITY.** Importing is asynchronous
 * ([[DEC-072]]): the API enqueues and a BullMQ consumer does the work. The lane's
 * `webServer` starts only the API and the web app, and its `globalSetup` migrates and
 * seeds — neither starts a consumer, so without one the import sits in `UPLOADED`
 * forever and this spec could never pass. It therefore spawns the worker itself, the
 * way `recovery.spec.ts` already does for the notification queue, and kills it in
 * `afterAll` so a worker cannot outlive the spec and consume the next flow's jobs.
 *
 * **WHY A BROWSER.** Every hop below is one no component test can prove:
 *
 * - the session cookie is set by the API and relayed by the BFF;
 * - the upload crosses as MULTIPART — the browser writes a boundary, the BFF parses
 *   the form and lets `fetch` write a second one, and the API's artefact pipe
 *   accepts the result. A jsdom test stubs the transport and proves none of that;
 * - the preview and the commit are QUEUED jobs, so the state the screen shows is
 *   written by a worker in another process, and the only reason the surface learns
 *   it is the poll. That round trip is the thing this spec exists for
 *   ([[DEC-072]]: every import is asynchronous);
 * - the summary survives a page RELOAD because it is read from the stored row
 *   outcomes, which this spec checks by reloading the detail page.
 *
 * **THE FILE IS WRITTEN BY THIS SPEC.** A CSV of two rows is most of the point: its
 * values carry this run's clock so the records it creates are findable, and its
 * SECOND row carries an invalid e-mail so the import has exactly one row the server
 * refuses. That row is what proves the surface reports a failure rather than only a
 * happy path — and the message it prints is compared against the API's own summary
 * read through the browser's session, never against a sentence copied into this
 * file.
 */

/** A JSON object narrowed field by field; never a cast to a DTO. */
type JsonObject = Readonly<Record<string, unknown>>;

function requireString(source: JsonObject, key: string): string {
  const value = source[key];
  if (typeof value !== "string") {
    throw new Error(`Expected "${key}" to be a string, received ${typeof value}.`);
  }
  return value;
}

function requireNumber(source: JsonObject, key: string): number {
  const value = source[key];
  if (typeof value !== "number") {
    throw new Error(`Expected "${key}" to be a number, received ${typeof value}.`);
  }
  return value;
}

/**
 * One JSON object, read through the session the page holds.
 *
 * `page.request` shares the browser context's cookies, so these reads are the same
 * authenticated caller the screen is — which is what makes the comparison below an
 * assertion about provenance rather than about a fixture.
 */
async function readJson(request: APIRequestContext, path: string): Promise<JsonObject> {
  const response = await request.get(path);
  expect(response.ok(), `GET ${path} answered ${String(response.status())}`).toBe(true);
  const raw: unknown = await response.json();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`GET ${path} did not answer a JSON object.`);
  }
  return raw as JsonObject;
}

/** The summary's `rows` array, narrowed one entry at a time. */
function summaryRows(source: JsonObject): readonly JsonObject[] {
  const rows = source.rows;
  if (!Array.isArray(rows)) {
    throw new Error(`Expected "rows" to be an array.`);
  }
  return rows.map((row: unknown) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error(`Expected every summary row to be a JSON object.`);
    }
    return row as JsonObject;
  });
}

/**
 * How long to wait for a QUEUED phase to be claimed and finished.
 *
 * The default expect timeout is five seconds, which is a component test's budget.
 * This window covers a queue round trip plus the worker's own work — the lane's
 * `timeout` is a minute per test (see `playwright.config.ts`), so two of these in
 * one flow still fits, and a genuinely stuck worker still fails with a diagnostic
 * rather than hanging.
 */
const PHASE_TIMEOUT_MS = 30_000;

/**
 * The second row's e-mail cell. Deliberately not an address at all: the row must be
 * REFUSED by the server, and the summary must have a failure to report. Everything
 * else about the file is valid.
 */
/**
 * The value that makes the SECOND row fail, and it has to be one the API actually
 * refuses.
 *
 * A malformed e-mail would NOT fail: `createCustomerContactBody.value` is
 * `min(1).max(255)` — length only, with no format check anywhere in the product
 * ([[TD-059]]). A spec that assumed otherwise would pass review and fail on its
 * first real run, which is exactly what happened to `clinical-records.spec.ts`.
 * A blank `display_name` is refused by `createCustomerBody` itself, so the failure
 * is real and the reason comes from the shared schema.
 */
const OMITTED_DISPLAY_NAME = "";

test.describe("the staff imports surface", () => {
  /**
   * Whether this environment can run an import end to end.
   *
   * `STORAGE_S3_BUCKET` is what makes `StorageModule` choose the S3 driver, which is the
   * only way the worker can see a file the API wrote. Without it the driver is
   * per-process and the preview fails on a file that exists only in the API's memory.
   *
   * Since [[HARD-003]] CI and `docker compose up` both configure it, so this is false only
   * in an environment that deliberately has no object storage. `globalSetup` refuses to
   * fall back when the variable is set but the store is unreachable — this guard covers
   * the opposite case, where it is not set at all.
   */
  const canShareArtefact = (process.env.STORAGE_S3_BUCKET ?? "") !== "";
  let worker: ReturnType<typeof spawn> | undefined;
  let workerOutput = "";

  test.beforeAll(() => {
    // `node` directly, not `pnpm start`: the wrapper is not the process that consumes,
    // and killing it would leave the worker alive to take a later spec's jobs.
    worker = spawn(process.execPath, [join(REPO_ROOT, "apps/worker/dist/main.js")], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    for (const stream of [worker.stdout, worker.stderr]) {
      stream?.on("data", (chunk: Buffer) => {
        workerOutput += chunk.toString();
      });
    }
  });

  test.afterAll(() => {
    worker?.kill("SIGTERM");
  });

  test("uploads a CSV, previews it, commits it and reads the summary's failed row", async ({
    page,
  }, testInfo) => {
    test.skip(
      !canShareArtefact,
      "Needs shared object storage: the API and the worker run in different processes, and " +
        "STORAGE_S3_BUCKET is unset, so the worker cannot read the file the API uploaded. " +
        "CI and `docker compose up` both provide it (DEC-077 / HARD-003)."
    );

    // The customer records this run creates must be findable and never collide with
    // another run's, so the name carries the clock — the same discipline the
    // clinical lane uses for a vaccine it records.
    const runId = Date.now();
    const firstName = `Lane Import A ${String(runId)}`;
    /**
     * The accepted row's address is run-unique for the same reason its name is: the
     * lane never cleans up after itself, so a FIXED address would be a suspected
     * duplicate on the second run and the assertion that no row is flagged would
     * start depending on how many times the lane had run.
     */
    const validEmail = `lane-import-valid-${String(runId)}@example.test`;

    // Written by the SPEC, into the test's own output directory. `display_name` is
    // the only required column of a CUSTOMERS file, so the second row omits it and
    // the server refuses exactly one row — through `createCustomerBody`, not through
    // a validation rule this surface invented.
    const csvPath = testInfo.outputPath(`lane-import-${String(runId)}.csv`);
    await writeFile(
      csvPath,
      [
        "display_name,email",
        `${firstName},${validEmail}`,
        `${OMITTED_DISPLAY_NAME},${validEmail}`,
        "",
      ].join("\n"),
      "utf8"
    );

    await page.goto("/login");
    await page.fill("#login-email", DEMO.staffEmail);
    await page.fill("#login-password", DEMO.staffPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    // Reached the way staff reach it: the nav. Imports carries no feature gate
    // ([[DEC-072]]), so the link is there for every tenant.
    await page.getByRole("link", { name: "Imports" }).click();
    await expect(page).toHaveURL(/\/app\/imports$/);
    await expect(page.getByTestId("imports-index")).toBeVisible();

    // ---- upload -------------------------------------------------------------

    await page.getByLabel("Import entity").selectOption("CUSTOMER");
    await page.getByTestId("import-file").setInputFiles(csvPath);
    await page.getByRole("button", { name: "Upload" }).click();

    // The accepted notice is a live status region, and it states the phase the API
    // answered with rather than a summary the request cannot have yet.
    await expect(page.getByTestId("imports-upload-accepted")).toBeVisible();
    await expect(page.getByTestId("imports-upload-accepted")).toContainText("UPLOADED");

    // The history lists the import that was just accepted, with the command its
    // state allows. The row is what an operator sees without reloading.
    const historyRow = page.getByTestId("imports-row").first();
    await expect(historyRow.getByTestId("imports-row-state")).toHaveText("UPLOADED");
    await expect(historyRow.getByTestId("imports-row-action")).toHaveText("Preview");

    await page.getByTestId("imports-upload-accepted-link").click();
    await expect(page).toHaveURL(/\/app\/imports\/[0-9a-f-]{36}$/);
    const importId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    expect(importId).toMatch(/^[0-9a-f-]{36}$/);

    // ---- preview ------------------------------------------------------------

    await expect(page.getByTestId("imports-state")).toHaveText("UPLOADED");
    // Nothing is stored before the preview runs, and the screen says that rather
    // than rendering an empty table.
    await expect(page.getByTestId("imports-summary-empty")).toBeVisible();

    await page.getByTestId("imports-preview").click();

    // The polling notice is the live region of the watch: it appears as soon as the
    // API accepts the command, because the accepted phase is seeded from the
    // response, and it disappears at every state that is not in flight.
    await expect(page.getByTestId("imports-polling")).toBeVisible();
    await expect(page.getByTestId("imports-polling")).toContainText("Previewing the file");

    // The state is written by the WORKER, so this is the round trip no component
    // test can produce: the browser learns it by polling.
    await expect(page.getByTestId("imports-state")).toHaveText("PREVIEWED", {
      timeout: PHASE_TIMEOUT_MS,
    });
    // The watch is over: the notice is gone, which is the STOP half of the polling
    // contract stated in the product itself.
    await expect(page.getByTestId("imports-polling")).toHaveCount(0);

    // The preview's counts, from the import row the worker settled. One row is
    // accepted, one is refused, and no duplicate warning is possible for either.
    await expect(page.getByTestId("imports-created")).toHaveText("1");
    await expect(page.getByTestId("imports-failed")).toHaveText("1");
    await expect(page.getByTestId("imports-suspected")).toHaveText("0");

    // ---- the row table ------------------------------------------------------

    // Bounded and ordered: two stored outcomes, in the file's own order, so the
    // second row is the refused one.
    const outcomes = page.getByTestId("imports-outcome-row");
    await expect(outcomes).toHaveCount(2);
    await expect(outcomes.nth(0).getByTestId("imports-outcome-status")).toHaveText("CREATE");
    const failedRow = outcomes.nth(1);
    await expect(failedRow.getByTestId("imports-outcome-status")).toHaveText("FAILED");

    // The reason the surface prints is the API's own, compared against the summary
    // read through this session: no sentence about a row is copied into this file,
    // so a re-worded reason cannot make the spec pass while the screen is wrong.
    const previewSummary = await readJson(
      page.request,
      `/api/imports/${importId}/summary?limit=100&offset=0`
    );
    const storedFailure = summaryRows(previewSummary).find((row) => row.status === "FAILED");
    if (storedFailure === undefined) {
      // The worker's own output rides on the failure: "no FAILED row" is what a
      // consumer that never booted looks like, and the reason it did not is in
      // those lines rather than in this assertion.
      throw new Error(
        `The API's own summary reported no FAILED row for this import.\n\nWorker output:\n${workerOutput || "(nothing)"}`
      );
    }
    await expect(failedRow.getByTestId("imports-outcome-reason")).toHaveText(
      requireString(storedFailure, "reasonCode")
    );
    await expect(failedRow.getByTestId("imports-outcome-message")).toHaveText(
      requireString(storedFailure, "message")
    );
    // An error and a suspected-duplicate WARNING are different facts, and this row
    // carries only the first — in text, not only in colour.
    await expect(failedRow).not.toContainText("Suspected duplicate");

    // ---- commit -------------------------------------------------------------

    await page.getByTestId("imports-commit").click();

    await expect(page.getByTestId("imports-state")).toHaveText("COMMITTED", {
      timeout: PHASE_TIMEOUT_MS,
    });
    await expect(page.getByTestId("imports-polling")).toHaveCount(0);

    // The accepted row became a record; the refused one still did not.
    await expect(page.getByTestId("imports-created")).toHaveText("1");
    await expect(page.getByTestId("imports-failed")).toHaveText("1");
    // A terminal import offers no further command: re-running is a new upload.
    await expect(page.getByTestId("imports-preview")).toHaveCount(0);
    await expect(page.getByTestId("imports-commit")).toHaveCount(0);

    // ---- the summary survives a reload ---------------------------------------

    await page.reload();

    // Everything below was re-read from the stored outcomes: the reload kept no
    // component state, and the artefact behind the import is gone by now.
    await expect(page.getByTestId("imports-state")).toHaveText("COMMITTED");
    await expect(page.getByTestId("imports-outcome-row")).toHaveCount(2);
    const reloadedFailure = page.getByTestId("imports-outcome-row").nth(1);
    await expect(reloadedFailure.getByTestId("imports-outcome-status")).toHaveText("FAILED");
    await expect(reloadedFailure.getByTestId("imports-outcome-reason")).toHaveText(
      requireString(storedFailure, "reasonCode")
    );
    await expect(reloadedFailure.getByTestId("imports-outcome-message")).toHaveText(
      requireString(storedFailure, "message")
    );

    // The committed import is the tenant's, and the counters the summary reports are
    // the ones the commit wrote — read from the API to prove the screen's provenance.
    const committed = await readJson(page.request, `/api/imports/${importId}`);
    expect(requireString(committed, "state")).toBe("COMMITTED");
    await expect(page.getByTestId("imports-created")).toHaveText(
      String(requireNumber(committed, "createdCount"))
    );
    await expect(page.getByTestId("imports-failed")).toHaveText(
      String(requireNumber(committed, "failedCount"))
    );
  });

  test("uploads a CSV through the BFF and the worker claims the preview", async ({
    page,
  }, testInfo) => {
    // Everything up to the artefact read. It matters even where the full flow DOES run,
    // because it is the only assertion that the work is asynchronous at all: it proves
    // the browser-facing half — the multipart proxy, the surface, the queue — and it
    // proves the consumer is alive, because a job nobody claims never leaves UPLOADED.
    // The full-flow test above proves the artefact read; this one proves the claim.
    const runId = Date.now();
    const csvPath = testInfo.outputPath(`lane-import-upload-${String(runId)}.csv`);
    await writeFile(
      csvPath,
      [
        "display_name,email",
        `Lane Upload ${String(runId)},lane-upload-${String(runId)}@example.test`,
        "",
      ].join("\n"),
      "utf8"
    );

    await page.goto("/login");
    await page.fill("#login-email", DEMO.staffEmail);
    await page.fill("#login-password", DEMO.staffPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    await page.getByRole("link", { name: "Imports" }).click();
    await expect(page.getByTestId("imports-index")).toBeVisible();

    await page.getByLabel("Import entity").selectOption("CUSTOMER");
    await page.getByTestId("import-file").setInputFiles(csvPath);
    await page.getByRole("button", { name: "Upload" }).click();

    await expect(page.getByTestId("imports-upload-accepted")).toContainText("UPLOADED");
    const historyRow = page.getByTestId("imports-row").first();
    await expect(historyRow.getByTestId("imports-row-state")).toHaveText("UPLOADED");

    await page.getByTestId("imports-upload-accepted-link").click();
    // The navigation is awaited BEFORE the id is read: a click resolves as soon as the
    // event is dispatched, and reading the URL first captures the index page's.
    await expect(page).toHaveURL(/\/app\/imports\/[0-9a-f-]{36}$/);
    const importId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    expect(importId).toMatch(/^[0-9a-f-]{36}$/);

    await page.getByTestId("imports-preview").click();
    await expect(page.getByTestId("imports-polling")).toContainText("Previewing the file");

    // The assertion that matters here: the state LEAVES UPLOADED. Only a consumer
    // takes the row out of it, so this is the queue, the claim and the worker's boot
    // proven from the browser. Whether the phase afterwards is PREVIEWED or FAILED is
    // the full-flow test above owns that half.
    await expect(page.getByTestId("imports-state")).not.toHaveText("UPLOADED", {
      timeout: PHASE_TIMEOUT_MS,
    });
  });
});

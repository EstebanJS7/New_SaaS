/**
 * FISC-008 WU-B — the official DNIT schema set and its preparation.
 *
 * The Story's validation strategy says a dedicated CI job fetches the official
 * schemas, asserts each fetch, and runs the schema-validation suite with the
 * skip disabled, so a green run can never be the product of having validated
 * nothing. This module is that fetch and that assertion.
 *
 * **Two facts make the naive version of this job wrong, and both were verified
 * against the published artifacts rather than assumed:**
 *
 * 1. **It is not three schemas, it is seven** — plus, since [[FISC-016]] WU-B,
 *    the event chain's four. `DE_v150.xsd` `xs:include`s `Paises_v100.xsd`,
 *    `Departamentos_v141.xsd`, `Monedas_v150.xsd`, `Unidades_Medida_v141.xsd`
 *    and `DE_Types_v150.xsd`, and `WS_SiRecepEvento_v150.xsd` `xs:include`s
 *    `protProcesEventos_v141.xsd` and `Evento_v150.xsd`, which in turn includes
 *    `Evento_Types_v150.xsd`, `Paises_v100.xsd`, `Departamentos_v141.xsd` and
 *    `DE_Types_v150.xsd`. Without those companions the schema does not compile.
 *    Fetching only the files named in the Story leaves a directory that cannot
 *    validate anything. `siRecepEvento_v150.xsd` is deliberately **not** in
 *    either chain: fetching it would assert bytes nothing reads.
 * 2. **Co-locating them is not enough, because many of those includes are
 *    absolute HTTPS URLs.** A validator therefore ignores the local copies and
 *    fetches from DNIT at validation time: with the network blocked,
 *    compilation fails with `global component '{...}tCDC' not found`. So every
 *    fetched artifact is **rewritten** in the job-local directory to reference
 *    its siblings by file name, which is what makes the gate hermetic and what
 *    makes the byte assertions above cover every artifact. Every artifact is
 *    rewritten rather than only the entries because the chain has intermediate
 *    carriers: `Evento_v150.xsd` is reached through
 *    `WS_SiRecepEvento_v150.xsd` and itself carries four absolute includes, so
 *    rewriting the entries alone would leave the network in the loop an event
 *    validation depends on.
 *
 * Neither transformation invents a constraint: every length, pattern, facet and
 * enumeration still comes from DNIT's bytes.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

export const DTE_XSD_BASE_URL = "https://ekuatia.set.gov.py/sifen/xsd";
export const SIFEN_XSD_NAMESPACE = "http://ekuatia.set.gov.py/sifen/xsd";
export const XMLDSIG_XSD_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";

export interface DteXsdArtifact {
  readonly fileName: string;
  /** Asserted floor. Well below the retrieved size, to survive a DNIT update. */
  readonly minimumBytes: number;
  /**
   * The size retrieved from DNIT — 2026-10-04 for the DE's seven, 2026-10-11 for
   * the event chain's four — recorded so the floor is auditable.
   */
  readonly retrievedBytes: number;
  readonly expectedNamespace: string;
}

/**
 * The seven artifacts a full DE validation needs. The four companion tables and
 * `DE_Types_v150.xsd` are `xs:include`d by `DE_v150.xsd`; `xmldsig-core-schema.xsd`
 * is a relative `xs:import`.
 */
export const DTE_XSD_ARTIFACTS: readonly DteXsdArtifact[] = [
  {
    fileName: "DE_v150.xsd",
    minimumBytes: 32_000,
    retrievedBytes: 66_190,
    expectedNamespace: SIFEN_XSD_NAMESPACE,
  },
  {
    fileName: "DE_Types_v150.xsd",
    minimumBytes: 32_000,
    retrievedBytes: 66_452,
    expectedNamespace: SIFEN_XSD_NAMESPACE,
  },
  {
    fileName: "xmldsig-core-schema.xsd",
    minimumBytes: 5_000,
    retrievedBytes: 10_339,
    expectedNamespace: XMLDSIG_XSD_NAMESPACE,
  },
  {
    fileName: "Paises_v100.xsd",
    minimumBytes: 24_000,
    retrievedBytes: 53_266,
    expectedNamespace: SIFEN_XSD_NAMESPACE,
  },
  {
    fileName: "Departamentos_v141.xsd",
    minimumBytes: 3_000,
    retrievedBytes: 6_198,
    expectedNamespace: SIFEN_XSD_NAMESPACE,
  },
  {
    fileName: "Monedas_v150.xsd",
    minimumBytes: 24_000,
    retrievedBytes: 57_236,
    expectedNamespace: SIFEN_XSD_NAMESPACE,
  },
  {
    fileName: "Unidades_Medida_v141.xsd",
    minimumBytes: 12_000,
    retrievedBytes: 27_240,
    expectedNamespace: SIFEN_XSD_NAMESPACE,
  },
];

export const DTE_XSD_FILE_NAMES: readonly string[] = DTE_XSD_ARTIFACTS.map(
  (artifact) => artifact.fileName
);

/**
 * [[FISC-016]] WU-B — the four artifacts the event chain adds, retrieved
 * 2026-10-11 from the same index. The event's entry is
 * `WS_SiRecepEvento_v150.xsd`; through `Evento_v150.xsd` it reaches
 * `Evento_Types_v150.xsd`, `Paises_v100.xsd`, `Departamentos_v141.xsd` and
 * `DE_Types_v150.xsd`, four of which the DE's set already carries.
 */
export const DTE_EVENT_XSD_ARTIFACTS: readonly DteXsdArtifact[] = [
  {
    fileName: "WS_SiRecepEvento_v150.xsd",
    minimumBytes: 1_200,
    retrievedBytes: 2_618,
    expectedNamespace: SIFEN_XSD_NAMESPACE,
  },
  {
    fileName: "protProcesEventos_v141.xsd",
    minimumBytes: 1_800,
    retrievedBytes: 3_660,
    expectedNamespace: SIFEN_XSD_NAMESPACE,
  },
  {
    fileName: "Evento_v150.xsd",
    minimumBytes: 10_000,
    retrievedBytes: 23_255,
    expectedNamespace: SIFEN_XSD_NAMESPACE,
  },
  {
    fileName: "Evento_Types_v150.xsd",
    minimumBytes: 10_000,
    retrievedBytes: 23_320,
    expectedNamespace: SIFEN_XSD_NAMESPACE,
  },
];

/**
 * Everything a prepared directory holds: the DE's seven and the event chain's
 * four. One directory serves both families, because the four shared artifacts
 * (`DE_Types_v150.xsd`, `xmldsig-core-schema.xsd`, `Paises_v100.xsd`,
 * `Departamentos_v141.xsd`) are in both chains and a second copy would be a
 * second set of bytes to assert.
 */
export const DTE_XSD_PREPARED_ARTIFACTS: readonly DteXsdArtifact[] = [
  ...DTE_XSD_ARTIFACTS,
  ...DTE_EVENT_XSD_ARTIFACTS,
];

export const DTE_XSD_PREPARED_FILE_NAMES: readonly string[] = DTE_XSD_PREPARED_ARTIFACTS.map(
  (artifact) => artifact.fileName
);

/**
 * Where the prepared schemas live when nothing says otherwise. Inside the OS
 * temp directory on purpose: the artifacts are copyrighted, are never
 * committed, and are never cached across runs.
 */
export function defaultDteSchemaDirectory(): string {
  return process.env.DTE_XSD_DIR ?? join(tmpdir(), "newsaas-dte-xsd");
}

/**
 * The DE's entry artifact: the document the DE validator compiles from. Its
 * absolute `schemaLocation`s are rewritten to file names, as are every other
 * artifact's.
 */
export const DTE_XSD_ENTRY_ARTIFACT = "DE_v150.xsd";

/**
 * [[FISC-016]] WU-B — the event lot's entry artifact. Unlike `DE_v150.xsd` it
 * declares `rEnviEventoDe` itself, which is why the event entry needs no
 * generated wrapper element.
 */
export const DTE_EVENT_XSD_ENTRY_ARTIFACT = "WS_SiRecepEvento_v150.xsd";

export type DteSchemaFailure =
  | "ARTIFACT_MISSING"
  | "ARTIFACT_TOO_SMALL"
  | "DIRECTORY_UNUSABLE"
  | "FETCH_FAILED"
  | "HTTP_STATUS"
  | "INCLUDES_NOT_REWRITTEN"
  | "NOT_A_SCHEMA"
  | "SCHEMA_UNUSABLE";

export class DteSchemaError extends Error {
  readonly failure: DteSchemaFailure;
  readonly fileName: string | undefined;

  constructor(failure: DteSchemaFailure, message: string, fileName?: string) {
    super(message);
    this.name = "DteSchemaError";
    this.failure = failure;
    this.fileName = fileName;
  }
}

export interface DteSchemaDirectoryInspection {
  /** True when every artifact is present, large enough and rewritten. */
  readonly usable: boolean;
  readonly directory: string;
  readonly missing: readonly string[];
  readonly tooSmall: readonly string[];
  /**
   * The artifacts that still resolve a `schemaLocation` over HTTP. **Every**
   * artifact is inspected, not only the entry one: a nested absolute include
   * inside a companion schema would reach the network just as surely, and the
   * entry-only version of this check could not see it.
   */
  readonly unrewrittenIncludes: readonly string[];
}

export interface PreparedDteSchemas {
  readonly directory: string;
  readonly artifacts: readonly {
    readonly fileName: string;
    readonly bytes: number;
    readonly byteSource: "fetched" | "local";
  }[];
  readonly rewrittenIncludes: readonly string[];
}

export type FetchLike = (url: string) => Promise<{
  readonly status: number;
  readonly ok: boolean;
  text(): Promise<string>;
}>;

/**
 * Per-attempt timeout. Without it a hung connection holds the CI job until the
 * runner's own limit, which is a failure mode with no useful error message.
 */
export const DTE_XSD_FETCH_TIMEOUT_MS = 20_000;

/**
 * Total attempts per artifact. One retry, because a single network blip should
 * not fail a gate whose whole point is that a red result means something.
 */
export const DTE_XSD_FETCH_ATTEMPTS = 2;

export interface PrepareDteSchemasOptions {
  readonly targetDir: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
  /** Used by the tests' local mode; the CI job fetches. */
  readonly localDir?: string;
  readonly readFileImpl?: (path: string) => Promise<string>;
  readonly writeFileImpl?: (path: string, contents: string) => Promise<void>;
}

export function defaultFetch(timeoutMs = DTE_XSD_FETCH_TIMEOUT_MS): FetchLike {
  return (url) => fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * Fetches one artifact, retrying only what is worth retrying: a transport
 * failure (including the timeout above) or a 5xx. A 4xx is an answer -- a 404
 * means the artifact is not there -- and is returned for the caller's assertion
 * to reject, and a 200 with the wrong bytes is not retried either, because
 * retrying an assertion failure is how a wrong artifact gets papered over.
 */
async function fetchArtifactWithRetry(
  fetchImpl: FetchLike,
  url: string,
  attempts = DTE_XSD_FETCH_ATTEMPTS
): Promise<{ readonly status: number; readonly ok: boolean; readonly body: string }> {
  const totalAttempts = Math.max(1, attempts);
  let lastError: unknown;
  let sawAResponse = false;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      sawAResponse = true;
      if (response.status >= 500 && attempt < totalAttempts) {
        // Drain the body before retrying. A discarded response whose stream is
        // never read holds its socket until the collector gets to it, which is
        // the wrong thing to leave behind in a loop that runs seven times.
        await response.text().catch(() => undefined);
        continue;
      }
      return { status: response.status, ok: response.ok, body: await response.text() };
    } catch (error) {
      lastError = error;
      if (attempt === totalAttempts) {
        break;
      }
    }
  }
  // A 5xx on the final attempt returns above; this path is reached only after a
  // transport failure, so `lastError` is set -- but the message does not depend
  // on that, because "no attempt produced a response" is also a real outcome.
  const cause = describeRejection(lastError);
  const retryNote = sawAResponse ? " after a retried 5xx" : "";
  throw new DteSchemaError(
    "FETCH_FAILED",
    `${url} failed after ${totalAttempts} attempt(s)${retryNote}: ${cause}`
  );
}

/** A rejection's message, without ever stringifying an arbitrary object. */
function describeRejection(error: unknown): string {
  if (error === undefined) {
    return "no attempt produced a response";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "a non-Error rejection";
}

/**
 * Proves one artifact is a real schema before it is accepted: the HTTP status,
 * the floor, and a shape check. The floor alone would not catch a captive
 * portal's HTML error page, which is a 200 with the wrong bytes; the shape check
 * is what does.
 */
export function assertArtifact(artifact: DteXsdArtifact, contents: string, status = 200): void {
  if (status !== 200) {
    throw new DteSchemaError(
      "HTTP_STATUS",
      `${artifact.fileName}: expected HTTP 200, received ${status}.`,
      artifact.fileName
    );
  }
  const bytes = Buffer.byteLength(contents, "utf8");
  if (bytes < artifact.minimumBytes) {
    throw new DteSchemaError(
      "ARTIFACT_TOO_SMALL",
      `${artifact.fileName}: ${bytes} bytes is below the ${artifact.minimumBytes}-byte floor.`,
      artifact.fileName
    );
  }
  if (!isSchemaDocument(contents, artifact.expectedNamespace)) {
    throw new DteSchemaError(
      "NOT_A_SCHEMA",
      `${artifact.fileName}: not an XML schema for ${artifact.expectedNamespace}.`,
      artifact.fileName
    );
  }
}

/**
 * The two shapes the official set uses: the SIFEN schemas declare `<xs:schema>`,
 * while the W3C `xmldsig-core-schema.xsd` is the 2002 original and puts the XML
 * Schema namespace on the default prefix, so its root element is `<schema>`.
 * Both must carry their `targetNamespace`.
 */
function isSchemaDocument(contents: string, expectedNamespace: string): boolean {
  const declaresSchemaRoot =
    contents.includes("<xs:schema") ||
    contents.includes("<schema ") ||
    contents.includes("<schema>");
  return declaresSchemaRoot && contents.includes(`targetNamespace="${expectedNamespace}"`);
}

/**
 * Rewrites every absolute `schemaLocation` under `baseUrl` to a file name.
 *
 * **The attribute is matched with optional whitespace around `=`**, because DNIT
 * ships both spellings in the same chain: `DE_v150.xsd` writes
 * `schemaLocation="https://…"` while `WS_SiRecepEvento_v150.xsd` and
 * `Evento_v150.xsd` write `schemaLocation= "https://…"`. A rewrite that only
 * matched the tight form would silently leave the event chain reaching DNIT, and
 * the assertion below would not see it either -- both read the same attribute.
 */
export function rewriteAbsoluteSchemaLocations(
  entryXsd: string,
  baseUrl: string
): { readonly contents: string; readonly rewritten: readonly string[] } {
  const rewritten: string[] = [];
  const prefix = `${baseUrl}/`;
  const contents = entryXsd.replace(
    /schemaLocation\s*=\s*"([^"]+)"/g,
    (match: string, location: string) => {
      if (!location.startsWith(prefix)) {
        return match;
      }
      const fileName = location.slice(prefix.length);
      rewritten.push(fileName);
      return `schemaLocation="${fileName}"`;
    }
  );
  return { contents, rewritten };
}

/** Refuses a directory that would make the validator reach the network. */
export function assertNoAbsoluteSchemaLocations(entryXsd: string, fileName: string): void {
  const absolute = [...entryXsd.matchAll(/schemaLocation\s*=\s*"(https?:\/\/[^"]+)"/g)].map(
    (match) => match[1]
  );
  if (absolute.length > 0) {
    throw new DteSchemaError(
      "INCLUDES_NOT_REWRITTEN",
      `${fileName} still resolves ${absolute.length} schemaLocation(s) over HTTP: ${absolute.join(", ")}. ` +
        "Validation would depend on DNIT being reachable and would not assert those bytes.",
      fileName
    );
  }
}

/**
 * Fetches and asserts every artifact of both chains, rewrites their absolute
 * includes, and writes the prepared directory. A run that does not produce every
 * artifact throws rather than degrading to a skip.
 */
export async function prepareDteSchemas(
  options: PrepareDteSchemasOptions
): Promise<PreparedDteSchemas> {
  const baseUrl = options.baseUrl ?? DTE_XSD_BASE_URL;
  const fetchImpl = options.fetchImpl ?? defaultFetch();
  const writeFileImpl =
    options.writeFileImpl ??
    (async (path: string, contents: string) => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, contents, "utf8");
    });
  const readFileImpl =
    options.readFileImpl ??
    (async (path: string) => {
      const { readFile } = await import("node:fs/promises");
      return readFile(path, "utf8");
    });

  const artifacts: { fileName: string; bytes: number; byteSource: "fetched" | "local" }[] = [];
  const contentsByFile = new Map<string, string>();

  const { mkdir } = await import("node:fs/promises");
  await mkdir(options.targetDir, { recursive: true });

  for (const artifact of DTE_XSD_PREPARED_ARTIFACTS) {
    let contents: string;
    let status = 200;
    let byteSource: "fetched" | "local" = "fetched";
    if (options.localDir === undefined) {
      const response = await fetchArtifactWithRetry(fetchImpl, `${baseUrl}/${artifact.fileName}`);
      status = response.status;
      contents = response.body;
    } else {
      contents = await readFileImpl(`${options.localDir}/${artifact.fileName}`);
      byteSource = "local";
    }
    assertArtifact(artifact, contents, status);
    contentsByFile.set(artifact.fileName, contents);
    artifacts.push({
      fileName: artifact.fileName,
      bytes: Buffer.byteLength(contents, "utf8"),
      byteSource,
    });
  }

  // The validators compile from these two, so a prepared directory that did not
  // produce one of them would be silently unusable rather than empty.
  const rewrittenIncludes: string[] = [];
  for (const entryArtifact of [DTE_XSD_ENTRY_ARTIFACT, DTE_EVENT_XSD_ENTRY_ARTIFACT]) {
    if (!contentsByFile.has(entryArtifact)) {
      throw new DteSchemaError(
        "ARTIFACT_MISSING",
        `${entryArtifact} was not produced.`,
        entryArtifact
      );
    }
  }

  // Every artifact, not only the entries: the chain has intermediate carriers,
  // and `Evento_v150.xsd` -- reached through `WS_SiRecepEvento_v150.xsd` --
  // carries four absolute includes of its own. Rewriting the entries alone would
  // leave those reaching DNIT at validation time, which the assertion below
  // would then report while preparation is still the caller's context.
  for (const [fileName, contents] of [...contentsByFile]) {
    const result = rewriteAbsoluteSchemaLocations(contents, baseUrl);
    rewrittenIncludes.push(...result.rewritten);
    assertNoAbsoluteSchemaLocations(result.contents, fileName);
    contentsByFile.set(fileName, result.contents);
  }

  for (const [fileName, contents] of contentsByFile) {
    await writeFileImpl(`${options.targetDir}/${fileName}`, contents);
  }

  return { directory: options.targetDir, artifacts, rewrittenIncludes };
}

/** Reads a prepared directory without touching the network. */
export async function inspectDteSchemas(directory: string): Promise<DteSchemaDirectoryInspection> {
  const { readFile } = await import("node:fs/promises");
  const missing: string[] = [];
  const tooSmall: string[] = [];
  const unrewrittenIncludes: string[] = [];

  // The whole prepared set, both chains: one directory is prepared in one run,
  // so "usable" means the run produced everything either validator compiles
  // from. A DE-only directory now reports the event artifacts as missing rather
  // than reporting a green DE gate over a directory an event submission could
  // not use.
  for (const artifact of DTE_XSD_PREPARED_ARTIFACTS) {
    // An absent artifact must not throw: it is the ordinary "not prepared yet"
    // state that makes the suite skip. `contents` is therefore a `const` of a
    // never-throwing read, narrowed before any use, so no path can reach the
    // size check without a value.
    const contents: string | undefined = await readFile(
      `${directory}/${artifact.fileName}`,
      "utf8"
    ).catch(() => undefined);
    if (contents === undefined) {
      missing.push(artifact.fileName);
      continue;
    }
    if (Buffer.byteLength(contents, "utf8") < artifact.minimumBytes) {
      tooSmall.push(artifact.fileName);
    }
    if (/schemaLocation\s*=\s*"https?:\/\//.test(contents)) {
      unrewrittenIncludes.push(artifact.fileName);
    }
  }

  return {
    usable: missing.length === 0 && tooSmall.length === 0 && unrewrittenIncludes.length === 0,
    directory,
    missing,
    tooSmall,
    unrewrittenIncludes,
  };
}

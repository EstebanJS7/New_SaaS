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
 * 1. **It is not three schemas, it is seven.** `DE_v150.xsd` `xs:include`s
 *    `Paises_v100.xsd`, `Departamentos_v141.xsd`, `Monedas_v150.xsd`,
 *    `Unidades_Medida_v141.xsd` and `DE_Types_v150.xsd`. Without those five the
 *    schema does not compile. Fetching only the three named in the Story leaves
 *    a directory that cannot validate anything.
 * 2. **Co-locating them is not enough, because five of those includes are
 *    absolute HTTPS URLs.** A validator therefore ignores the local copies and
 *    fetches from DNIT at validation time: with the network blocked,
 *    compilation fails with `global component '{...}tCDC' not found`. So the
 *    fetched `DE_v150.xsd` is **rewritten** in the job-local directory to
 *    reference its siblings by file name, which is what makes the gate
 *    hermetic and what makes the byte assertions above cover every artifact.
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
  /** The size retrieved on 2026-10-04, recorded so the floor is auditable. */
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
 * Where the prepared schemas live when nothing says otherwise. Inside the OS
 * temp directory on purpose: the artifacts are copyrighted, are never
 * committed, and are never cached across runs.
 */
export function defaultDteSchemaDirectory(): string {
  return process.env.DTE_XSD_DIR ?? join(tmpdir(), "newsaas-dte-xsd");
}

/** The document whose absolute `schemaLocation`s are rewritten to file names. */
export const DTE_XSD_ENTRY_ARTIFACT = "DE_v150.xsd";

export type DteSchemaFailure =
  | "ARTIFACT_MISSING"
  | "ARTIFACT_TOO_SMALL"
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
  readonly unrewrittenIncludes: boolean;
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
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      if (response.status >= 500 && attempt < attempts) {
        continue;
      }
      return { status: response.status, ok: response.ok, body: await response.text() };
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
    }
  }
  throw new DteSchemaError(
    "FETCH_FAILED",
    `${url} failed after ${attempts} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
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

/** Rewrites every absolute `schemaLocation` under `baseUrl` to a file name. */
export function rewriteAbsoluteSchemaLocations(
  entryXsd: string,
  baseUrl: string
): { readonly contents: string; readonly rewritten: readonly string[] } {
  const rewritten: string[] = [];
  const prefix = `${baseUrl}/`;
  const contents = entryXsd.replace(
    /schemaLocation="([^"]+)"/g,
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
  const absolute = [...entryXsd.matchAll(/schemaLocation="(https?:\/\/[^"]+)"/g)].map(
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
 * Fetches all seven artifacts, asserts each, rewrites the entry schema's
 * absolute includes, and writes the prepared directory. A run that does not
 * produce every artifact throws rather than degrading to a skip.
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

  for (const artifact of DTE_XSD_ARTIFACTS) {
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

  const entry = contentsByFile.get(DTE_XSD_ENTRY_ARTIFACT);
  if (entry === undefined) {
    throw new DteSchemaError(
      "ARTIFACT_MISSING",
      `${DTE_XSD_ENTRY_ARTIFACT} was not produced.`,
      DTE_XSD_ENTRY_ARTIFACT
    );
  }
  const { contents: rewrittenEntry, rewritten } = rewriteAbsoluteSchemaLocations(entry, baseUrl);
  assertNoAbsoluteSchemaLocations(rewrittenEntry, DTE_XSD_ENTRY_ARTIFACT);
  contentsByFile.set(DTE_XSD_ENTRY_ARTIFACT, rewrittenEntry);

  for (const [fileName, contents] of contentsByFile) {
    await writeFileImpl(`${options.targetDir}/${fileName}`, contents);
  }

  return { directory: options.targetDir, artifacts, rewrittenIncludes: rewritten };
}

/** Reads a prepared directory without touching the network. */
export async function inspectDteSchemas(directory: string): Promise<DteSchemaDirectoryInspection> {
  const { readFile } = await import("node:fs/promises");
  const missing: string[] = [];
  const tooSmall: string[] = [];
  let unrewrittenIncludes = false;

  for (const artifact of DTE_XSD_ARTIFACTS) {
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
    if (
      artifact.fileName === DTE_XSD_ENTRY_ARTIFACT &&
      /schemaLocation="https?:\/\//.test(contents)
    ) {
      unrewrittenIncludes = true;
    }
  }

  return {
    usable: missing.length === 0 && tooSmall.length === 0 && !unrewrittenIncludes,
    directory,
    missing,
    tooSmall,
    unrewrittenIncludes,
  };
}

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertArtifact,
  assertNoAbsoluteSchemaLocations,
  defaultFetch,
  DTE_EVENT_XSD_ARTIFACTS,
  DTE_XSD_ARTIFACTS,
  DTE_XSD_BASE_URL,
  DTE_XSD_FETCH_TIMEOUT_MS,
  DTE_XSD_PREPARED_ARTIFACTS,
  DteSchemaError,
  inspectDteSchemas,
  prepareDteSchemas,
  rewriteAbsoluteSchemaLocations,
  SIFEN_XSD_NAMESPACE,
  XMLDSIG_XSD_NAMESPACE,
} from "./xsd-artifacts.js";

/**
 * These cases run without a network. They prove the assertion the validation
 * strategy depends on: a fetch that does not produce a real schema **fails**
 * rather than degrading to a skip or to an empty directory that "validates"
 * everything.
 */

function schemaBody(artifactName: string): string {
  const artifact = DTE_XSD_PREPARED_ARTIFACTS.find(
    (candidate) => candidate.fileName === artifactName
  );
  const namespace = artifact?.expectedNamespace ?? SIFEN_XSD_NAMESPACE;
  const minimum = artifact?.minimumBytes ?? 1_000;
  const header = `<?xml version="1.0" encoding="utf-8"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="${namespace}">\n`;
  const footer = "\n</xs:schema>\n";
  const padding = minimum - Buffer.byteLength(header + footer, "utf8") + 10;
  return `${header}<!--${"p".repeat(Math.max(padding, 1))}-->\n${artifactIncludes(artifactName)}${footer}`;
}

/**
 * The artifacts that carry absolute `schemaLocation`s in the real set, and what
 * they point at. FISC-016's chain added two carriers beyond `DE_v150.xsd`:
 * `WS_SiRecepEvento_v150.xsd` reaches its two companions, and `Evento_v150.xsd`
 * -- reached through that one -- carries four absolute includes of its own,
 * which is why the rewrite cannot stop at the entries.
 */
const ABSOLUTE_INCLUDES: Record<string, readonly string[]> = {
  "DE_v150.xsd": [
    "DE_Types_v150.xsd",
    "Paises_v100.xsd",
    "Departamentos_v141.xsd",
    "Monedas_v150.xsd",
    "Unidades_Medida_v141.xsd",
  ],
  "WS_SiRecepEvento_v150.xsd": ["protProcesEventos_v141.xsd", "Evento_v150.xsd"],
  "Evento_v150.xsd": [
    "Evento_Types_v150.xsd",
    "Paises_v100.xsd",
    "Departamentos_v141.xsd",
    "DE_Types_v150.xsd",
  ],
};

/**
 * The artifacts that write the attribute as `schemaLocation= "…"`, which is
 * what DNIT ships: `DE_v150.xsd` writes the tight form while
 * `WS_SiRecepEvento_v150.xsd` and `Evento_v150.xsd` both put a space after the
 * `=`. A rewrite that only matched the tight form would leave the event chain'
 * includes reaching DNIT, and the "still resolves a schemaLocation over HTTP"
 * assertion would not see them either.
 */
const SPACED_SCHEMA_LOCATIONS = new Set(["WS_SiRecepEvento_v150.xsd", "Evento_v150.xsd"]);

function artifactIncludes(fileName: string): string {
  const spaced = SPACED_SCHEMA_LOCATIONS.has(fileName);
  return (ABSOLUTE_INCLUDES[fileName] ?? [])
    .map((included) =>
      spaced
        ? `\t<xs:include schemaLocation= "${DTE_XSD_BASE_URL}/${included}"/>\n`
        : `\t<xs:include schemaLocation="${DTE_XSD_BASE_URL}/${included}"/>\n`
    )
    .join("");
}

/** Every absolute include the stub set carries, which is what the rewrite must remove. */
const PREPARED_REWRITES = Object.values(ABSOLUTE_INCLUDES).flat().length;

function stubFetch(files: Map<string, string>): (url: string) => Promise<{
  status: number;
  ok: boolean;
  text(): Promise<string>;
}> {
  return (url: string) => {
    const fileName = url.slice(url.lastIndexOf("/") + 1);
    const body = files.get(fileName);
    if (body === undefined) {
      return Promise.resolve({ status: 404, ok: false, text: () => Promise.resolve("not found") });
    }
    return Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve(body) });
  };
}

function allSchemas(): Map<string, string> {
  return new Map(
    DTE_XSD_PREPARED_ARTIFACTS.map((artifact) => [artifact.fileName, schemaBody(artifact.fileName)])
  );
}

describe("official schema artifacts", () => {
  it("names the seven artifacts a full DE validation needs, with their recorded sizes", () => {
    expect(DTE_XSD_ARTIFACTS.map((artifact) => artifact.fileName)).toEqual([
      "DE_v150.xsd",
      "DE_Types_v150.xsd",
      "xmldsig-core-schema.xsd",
      "Paises_v100.xsd",
      "Departamentos_v141.xsd",
      "Monedas_v150.xsd",
      "Unidades_Medida_v141.xsd",
    ]);
    expect(
      DTE_XSD_ARTIFACTS.every((artifact) => artifact.retrievedBytes > artifact.minimumBytes)
    ).toBe(true);
  });

  it("adds the event chain's four artifacts and keeps siRecepEvento out of both chains", () => {
    // The event's entry is WS_SiRecepEvento_v150.xsd; `siRecepEvento_v150.xsd` is
    // reachable from nothing the event schema includes, and fetching it would
    // assert bytes no validation reads.
    expect(DTE_EVENT_XSD_ARTIFACTS.map((artifact) => artifact.fileName)).toEqual([
      "WS_SiRecepEvento_v150.xsd",
      "protProcesEventos_v141.xsd",
      "Evento_v150.xsd",
      "Evento_Types_v150.xsd",
    ]);
    expect(
      DTE_EVENT_XSD_ARTIFACTS.every((artifact) => artifact.retrievedBytes > artifact.minimumBytes)
    ).toBe(true);

    // The union is what one preparation produces: the seven plus the four, with
    // the four shared artifacts appearing once.
    expect(DTE_XSD_PREPARED_ARTIFACTS).toHaveLength(11);
    expect(DTE_XSD_PREPARED_ARTIFACTS.map((artifact) => artifact.fileName)).toEqual([
      ...DTE_XSD_ARTIFACTS.map((artifact) => artifact.fileName),
      ...DTE_EVENT_XSD_ARTIFACTS.map((artifact) => artifact.fileName),
    ]);
    expect(DTE_XSD_PREPARED_ARTIFACTS.map((artifact) => artifact.fileName)).not.toContain(
      "siRecepEvento_v150.xsd"
    );
  });

  it("accepts a real schema body and rejects a captive-portal page", () => {
    const artifact = DTE_XSD_ARTIFACTS[0];
    expect(() => assertArtifact(artifact, schemaBody("DE_v150.xsd"))).not.toThrow();
    expect(() =>
      assertArtifact(artifact, "<html><body>Sign in to the network</body></html>")
    ).toThrow(DteSchemaError);
  });

  it("rejects a short body and a non-200 status", () => {
    const artifact = DTE_XSD_ARTIFACTS[0];
    expect(failureOf(() => assertArtifact(artifact, '<xs:schema xmlns="https://x">'))).toBe(
      "ARTIFACT_TOO_SMALL"
    );
    expect(failureOf(() => assertArtifact(artifact, schemaBody("DE_v150.xsd"), 404))).toBe(
      "HTTP_STATUS"
    );
  });

  it("rejects a schema of the wrong namespace", () => {
    const artifact = DTE_XSD_ARTIFACTS[0];
    const wrongNamespace = `<?xml version="1.0"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="${XMLDSIG_XSD_NAMESPACE}">\n<!--${"p".repeat(40_000)}-->\n</xs:schema>`;
    expect(failureOf(() => assertArtifact(artifact, wrongNamespace))).toBe("NOT_A_SCHEMA");
  });

  it("rewrites absolute includes and refuses a document that still has them", () => {
    const entry = `<xs:schema><xs:include schemaLocation="${DTE_XSD_BASE_URL}/DE_Types_v150.xsd"/><xs:import namespace="ds" schemaLocation="xmldsig-core-schema.xsd"/></xs:schema>`;
    const { contents, rewritten } = rewriteAbsoluteSchemaLocations(entry, DTE_XSD_BASE_URL);
    expect(rewritten).toEqual(["DE_Types_v150.xsd"]);
    expect(contents).toContain('schemaLocation="DE_Types_v150.xsd"');
    expect(contents).toContain('schemaLocation="xmldsig-core-schema.xsd"');
    expect(() => assertNoAbsoluteSchemaLocations(contents, "DE_v150.xsd")).not.toThrow();
    expect(failureOf(() => assertNoAbsoluteSchemaLocations(entry, "DE_v150.xsd"))).toBe(
      "INCLUDES_NOT_REWRITTEN"
    );
  });

  it("rewrites and refuses a schemaLocation written with a space after the equals sign", () => {
    // DNIT's own spelling in the event chain: `schemaLocation= "https://…"`.
    const spaced = `<xs:schema>\n\t<xs:include schemaLocation= "${DTE_XSD_BASE_URL}/Evento_Types_v150.xsd"/>\n</xs:schema>`;
    const { contents, rewritten } = rewriteAbsoluteSchemaLocations(spaced, DTE_XSD_BASE_URL);

    expect(rewritten).toEqual(["Evento_Types_v150.xsd"]);
    expect(contents).toContain('<xs:include schemaLocation="Evento_Types_v150.xsd"/>');
    expect(contents).not.toContain("https://");
    expect(
      failureOf(() => assertNoAbsoluteSchemaLocations(spaced, "WS_SiRecepEvento_v150.xsd"))
    ).toBe("INCLUDES_NOT_REWRITTEN");
  });

  it("prepares a complete directory, asserting every artifact of both chains", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "dte-schemas-test-"));
    const prepared = await prepareDteSchemas({ targetDir, fetchImpl: stubFetch(allSchemas()) });

    expect(prepared.artifacts).toHaveLength(11);
    expect(prepared.artifacts.every((artifact) => artifact.byteSource === "fetched")).toBe(true);
    // Every absolute include of every artifact, not only the entries': the event
    // chain's intermediate carrier is rewritten too.
    expect(prepared.rewrittenIncludes).toHaveLength(PREPARED_REWRITES);
    expect(prepared.rewrittenIncludes).toContain("Evento_v150.xsd");
    for (const artifact of DTE_XSD_PREPARED_ARTIFACTS) {
      const contents = await readFile(join(targetDir, artifact.fileName), "utf8");
      expect(contents, `${artifact.fileName} still resolves a schema over HTTP`).not.toContain(
        "https://"
      );
    }
    await expect(inspectDteSchemas(targetDir)).resolves.toMatchObject({
      usable: true,
      missing: [],
      tooSmall: [],
      unrewrittenIncludes: [],
    });
  });

  it("fails the whole preparation when one artifact is not produced", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "dte-schemas-test-"));
    const files = allSchemas();
    files.delete("Monedas_v150.xsd");

    await expect(prepareDteSchemas({ targetDir, fetchImpl: stubFetch(files) })).rejects.toThrow(
      DteSchemaError
    );
    // Nothing was written: a partial fetch must not leave a directory behind.
    const inspection = await inspectDteSchemas(targetDir);
    expect(inspection.usable).toBe(false);
  });

  it("retries a transport failure once, then succeeds", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "dte-schemas-test-"));
    const files = allSchemas();
    const flaky = stubFetch(files);
    const urls: string[] = [];
    const prepared = await prepareDteSchemas({
      targetDir,
      fetchImpl: (url) => {
        urls.push(url);
        // Fail the very first attempt at transport level, as a timeout does.
        if (urls.length === 1) {
          return Promise.reject(new Error("The operation was aborted due to timeout"));
        }
        return flaky(url);
      },
    });

    expect(prepared.artifacts).toHaveLength(11);
    // Exactly one retry, and it was the FIRST artifact's URL that was retried --
    // so the count and the identity are both asserted, not just "more than 11".
    expect(urls).toHaveLength(12);
    expect(urls[0]).toBe(urls[1]);
    expect(urls[0]).toContain(DTE_XSD_ARTIFACTS[0].fileName);
    expect(new Set(urls.slice(1)).size).toBe(11);
  });

  it("rewrites a companion's absolute include instead of reaching the network for it", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "dte-schemas-test-"));
    const files = allSchemas();

    const { rewrittenIncludes } = await prepareDteSchemas({
      targetDir,
      fetchImpl: stubFetch(files),
    });
    const evento = await readFile(join(targetDir, "Evento_v150.xsd"), "utf8");

    // `Evento_v150.xsd` is reached through `WS_SiRecepEvento_v150.xsd` and
    // carries four absolute includes of its own: an entry-only rewrite would
    // leave all four fetching from DNIT at validation time.
    expect(evento).toContain('schemaLocation="Evento_Types_v150.xsd"');
    expect(evento).not.toContain(DTE_XSD_BASE_URL);
    expect(rewrittenIncludes).toContain("Evento_Types_v150.xsd");
  });

  it("still refuses an absolute include the rewrite cannot resolve", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "dte-schemas-test-"));
    const files = allSchemas();
    // A companion that reaches a host outside the base URL survives the rewrite,
    // and must fail while preparation is still the caller's context.
    files.set(
      "Evento_Types_v150.xsd",
      schemaBody("Evento_Types_v150.xsd").replace(
        ">\n",
        '>\n\t<xs:include schemaLocation="https://example.test/Evento_Types_v150.xsd"/>\n'
      )
    );

    await expect(
      prepareDteSchemas({ targetDir, fetchImpl: stubFetch(files) })
    ).rejects.toMatchObject({ failure: "INCLUDES_NOT_REWRITTEN" });
  });

  it("fails with FETCH_FAILED when every attempt fails at transport level", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "dte-schemas-test-"));

    await expect(
      prepareDteSchemas({
        targetDir,
        fetchImpl: () => Promise.reject(new Error("socket hang up")),
      })
    ).rejects.toMatchObject({ failure: "FETCH_FAILED" });
  });

  it("retries a 5xx but never a 404", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "dte-schemas-test-"));
    const files = allSchemas();
    const flaky = stubFetch(files);
    let calls = 0;
    await prepareDteSchemas({
      targetDir,
      fetchImpl: (url) => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({ status: 503, ok: false, text: () => Promise.resolve("busy") });
        }
        return flaky(url);
      },
    });
    expect(calls).toBeGreaterThan(11);

    // A 404 is an answer, not a blip: it must be reported without a retry.
    const missingDir = await mkdtemp(join(tmpdir(), "dte-schemas-test-"));
    let notFoundCalls = 0;
    await expect(
      prepareDteSchemas({
        targetDir: missingDir,
        fetchImpl: () => {
          notFoundCalls += 1;
          return Promise.resolve({ status: 404, ok: false, text: () => Promise.resolve("nope") });
        },
      })
    ).rejects.toMatchObject({ failure: "HTTP_STATUS" });
    expect(notFoundCalls).toBe(1);
  });

  it("arms a per-attempt timeout on the real fetch", async () => {
    const originalFetch = globalThis.fetch;
    let seenSignal: unknown;
    globalThis.fetch = ((_url: string, init?: { signal?: unknown }) => {
      seenSignal = init?.signal;
      return Promise.resolve({
        status: 200,
        ok: true,
        text: () => Promise.resolve("<xs:schema/>"),
      });
    }) as unknown as typeof globalThis.fetch;

    try {
      expect(DTE_XSD_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
      await defaultFetch()("https://example.test/DE_v150.xsd");
      expect(seenSignal).toBeInstanceOf(AbortSignal);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports an unprepared directory as unusable, naming what is missing", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "dte-schemas-test-"));
    const inspection = await inspectDteSchemas(targetDir);

    expect(inspection.usable).toBe(false);
    // Both chains: a directory holding only the DE's seven is unusable, because
    // one preparation produces the union and a DE-only directory could not serve
    // an event submission.
    expect(inspection.missing).toEqual(
      DTE_XSD_PREPARED_ARTIFACTS.map((artifact) => artifact.fileName)
    );
  });

  it("keeps inspecting after an absent artifact instead of stopping at it", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "dte-schemas-test-"));
    const files = allSchemas();
    await prepareDteSchemas({ targetDir, fetchImpl: stubFetch(files) });
    // Remove one artifact and shrink another: a single absent file must not
    // stop the walk, or the report would name the first gap and hide the rest.
    await rm(join(targetDir, "Monedas_v150.xsd"));
    await writeFile(join(targetDir, "Paises_v100.xsd"), "<xs:schema/>", "utf8");

    await expect(inspectDteSchemas(targetDir)).resolves.toMatchObject({
      usable: false,
      missing: ["Monedas_v150.xsd"],
      tooSmall: ["Paises_v100.xsd"],
      unrewrittenIncludes: [],
    });
  });

  it("flags a directory whose event entry schema was never rewritten", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "dte-schemas-test-"));
    await prepareDteSchemas({ targetDir, fetchImpl: stubFetch(allSchemas()) });
    // The spaced spelling, which is the one DNIT ships in this artifact: an
    // inspection that only matched the tight form would report this directory as
    // usable while every event compilation reached the network.
    await writeFile(
      join(targetDir, "WS_SiRecepEvento_v150.xsd"),
      // The un-rewritten body: the space after `=`, and the absolute URL still in
      // place. This is what was silently reported as usable before the inspection
      // matched both spellings.
      schemaBody("WS_SiRecepEvento_v150.xsd"),
      "utf8"
    );

    await expect(inspectDteSchemas(targetDir)).resolves.toMatchObject({
      usable: false,
      unrewrittenIncludes: ["WS_SiRecepEvento_v150.xsd"],
      missing: [],
      tooSmall: [],
    });
  });

  it("flags a directory whose entry schema was never rewritten", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "dte-schemas-test-"));
    const files = allSchemas();
    await prepareDteSchemas({ targetDir, fetchImpl: stubFetch(files) });
    await writeFile(
      join(targetDir, "DE_v150.xsd"),
      schemaBody("DE_v150.xsd").replace(
        'schemaLocation="DE_Types_v150.xsd"',
        `schemaLocation="${DTE_XSD_BASE_URL}/DE_Types_v150.xsd"`
      ),
      "utf8"
    );

    await expect(inspectDteSchemas(targetDir)).resolves.toMatchObject({
      usable: false,
      unrewrittenIncludes: ["DE_v150.xsd"],
      // The walk must still have reported the other six as present and
      // correctly sized: naming the unrewritten file is only half the claim.
      missing: [],
      tooSmall: [],
    });
  });
});

function failureOf(callback: () => unknown): DteSchemaError["failure"] {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(DteSchemaError);
    return (error as DteSchemaError).failure;
  }
  throw new Error("expected a DteSchemaError");
}

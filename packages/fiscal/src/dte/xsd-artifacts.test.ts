import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertArtifact,
  assertNoAbsoluteSchemaLocations,
  defaultFetch,
  DTE_XSD_ARTIFACTS,
  DTE_XSD_BASE_URL,
  DTE_XSD_FETCH_TIMEOUT_MS,
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
  const artifact = DTE_XSD_ARTIFACTS.find((candidate) => candidate.fileName === artifactName);
  const namespace = artifact?.expectedNamespace ?? SIFEN_XSD_NAMESPACE;
  const minimum = artifact?.minimumBytes ?? 1_000;
  const header = `<?xml version="1.0" encoding="utf-8"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="${namespace}">\n`;
  const footer = "\n</xs:schema>\n";
  const padding = minimum - Buffer.byteLength(header + footer, "utf8") + 10;
  return `${header}<!--${"p".repeat(Math.max(padding, 1))}-->\n${artifactIncludes(artifactName)}${footer}`;
}

function artifactIncludes(fileName: string): string {
  if (fileName !== "DE_v150.xsd") {
    return "";
  }
  return DTE_XSD_ARTIFACTS.filter(
    (artifact) =>
      artifact.fileName !== "DE_v150.xsd" && artifact.fileName !== "xmldsig-core-schema.xsd"
  )
    .map(
      (artifact) => `\t<xs:include schemaLocation="${DTE_XSD_BASE_URL}/${artifact.fileName}"/>\n`
    )
    .join("");
}

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
    DTE_XSD_ARTIFACTS.map((artifact) => [artifact.fileName, schemaBody(artifact.fileName)])
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

  it("prepares a complete directory, asserting every artifact", async () => {
    const targetDir = await mkdtemp(join(tmpdir(), "dte-schemas-test-"));
    const prepared = await prepareDteSchemas({ targetDir, fetchImpl: stubFetch(allSchemas()) });

    expect(prepared.artifacts).toHaveLength(7);
    expect(prepared.artifacts.every((artifact) => artifact.byteSource === "fetched")).toBe(true);
    expect(prepared.rewrittenIncludes).toHaveLength(5);
    const entry = await readFile(join(targetDir, "DE_v150.xsd"), "utf8");
    expect(entry).not.toContain("https://");
    await expect(inspectDteSchemas(targetDir)).resolves.toMatchObject({
      usable: true,
      missing: [],
      tooSmall: [],
      unrewrittenIncludes: false,
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
    let calls = 0;
    const prepared = await prepareDteSchemas({
      targetDir,
      fetchImpl: (url) => {
        calls += 1;
        // Fail the very first attempt at transport level, as a timeout does.
        if (calls === 1) {
          return Promise.reject(new Error("The operation was aborted due to timeout"));
        }
        return flaky(url);
      },
    });

    expect(prepared.artifacts).toHaveLength(7);
    expect(calls).toBeGreaterThan(7);
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
    expect(calls).toBeGreaterThan(7);

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
    expect(inspection.missing).toEqual(DTE_XSD_ARTIFACTS.map((artifact) => artifact.fileName));
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
      unrewrittenIncludes: false,
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
      unrewrittenIncludes: true,
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

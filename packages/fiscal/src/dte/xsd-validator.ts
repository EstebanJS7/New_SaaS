/**
 * FISC-008 WU-B — validating a built DE, and [[FISC-016]] WU-B — validating a
 * built event lot, against the official DNIT schemas.
 *
 * **The entry artifact is a parameter, and for the DE it is the reason.** The
 * DE's `DE_v150.xsd` declares no top-level element at all — `rDE` is a
 * `complexType` (baseline §21's Shape records "49 `complexType`s and no
 * top-level element") — so a bare `<rDE>` document has no element declaration to
 * validate against. Rather than fetch DNIT's container protocol, this module
 * builds an entry schema that only declares `<xs:element name="rDE" type="rDE"/>`
 * and `xs:include`s the official `DE_v150.xsd`. Every length, pattern, facet and
 * enumeration still comes from DNIT's bytes.
 *
 * An event lot needs no such element: `WS_SiRecepEvento_v150.xsd` declares
 * `rEnviEventoDe` itself (baseline §25.1), so its entry schema is the same
 * generated wrapper **without** the extra declaration. Both are compiled the
 * same way, and that is why the entry is a parameter rather than a constant.
 *
 * The include is written as an absolute `file://` URL because the schema is
 * parsed from a string with no base URI; the nested includes inside the entry
 * artifact then resolve relative to it. A directory whose absolute
 * `schemaLocation`s were not rewritten is **refused** rather than validated, so
 * this can never silently depend on DNIT being reachable.
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseXml, type Document, type ValidationError } from "libxmljs2";
import {
  assertNoAbsoluteSchemaLocations,
  DTE_EVENT_XSD_ENTRY_ARTIFACT,
  DTE_XSD_ENTRY_ARTIFACT,
  DteSchemaError,
  inspectDteSchemas,
  SIFEN_XSD_NAMESPACE,
} from "./xsd-artifacts.js";

export interface DteXsdValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly schemaDirectory: string;
}

/**
 * One document family's compiled schema: which artifact the directory is
 * compiled from, and which element the generated wrapper declares.
 */
export interface DteXsdEntry {
  readonly entryArtifact: string;
  /**
   * The element the wrapper declares **in addition to** including the entry
   * artifact, as `<xs:element name="X" type="X">`, for an artifact that declares
   * no top-level element of its own. `DE_v150.xsd` needs it — it declares `rDE`
   * as a `complexType` only — while `WS_SiRecepEvento_v150.xsd` already declares
   * `rEnviEventoDe`, and declaring it twice would not compile.
   */
  readonly wrapperRootElement?: string;
}

/** `DE_v150.xsd` declares `rDE` as a `complexType`, so the wrapper supplies the element. */
export const DTE_SCHEMA_ENTRY: DteXsdEntry = {
  entryArtifact: DTE_XSD_ENTRY_ARTIFACT,
  wrapperRootElement: "rDE",
};

/** The event lot's root element is declared by the entry artifact itself. */
export const DTE_EVENT_SCHEMA_ENTRY: DteXsdEntry = {
  entryArtifact: DTE_EVENT_XSD_ENTRY_ARTIFACT,
};

/** Builds the wrapper schema that makes the entry artifact's root addressable. */
export function buildXsdEntrySchema(entry: DteXsdEntry, schemaDirectory: string): string {
  const include = pathToFileURL(join(schemaDirectory, entry.entryArtifact)).href;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"',
    `\txmlns="${SIFEN_XSD_NAMESPACE}"`,
    `\ttargetNamespace="${SIFEN_XSD_NAMESPACE}"`,
    '\telementFormDefault="qualified">',
    `\t<xs:include schemaLocation="${include}" />`,
    ...(entry.wrapperRootElement === undefined
      ? []
      : [`\t<xs:element name="${entry.wrapperRootElement}" type="${entry.wrapperRootElement}" />`]),
    "</xs:schema>",
    "",
  ].join("\n");
}

/** The DE's wrapper, unchanged for its callers. */
export function buildDteEntrySchema(schemaDirectory: string): string {
  return buildXsdEntrySchema(DTE_SCHEMA_ENTRY, schemaDirectory);
}

/**
 * The compiled-schema cache, keyed by the directory **and** the entry artifact
 * (ADR-010 §4).
 *
 * Compiling the official set is the expensive half of validation, so it happens
 * once per directory per process; a deployment that changes the directory
 * restarts the process. The entry artifact is part of the key because the
 * directory now serves two document families: a DE and an event lot compile
 * different entry schemas out of the same bytes, and a key of the directory
 * alone would hand one family the other's compiled schema.
 *
 * The directory inspection still runs on every call, on purpose: a directory
 * that became unusable after it was compiled must refuse the document rather
 * than validate against a stale compile. A failed compile is never stored — the
 * entry is dropped, so the next submission compiles again and refuses again
 * while the directory is broken. The map holds the in-flight promise too, so two
 * concurrent first submissions of the same pair share one compilation instead of
 * racing.
 */
const compiledSchemas = new Map<string, Promise<Document>>();

function cacheKey(entry: DteXsdEntry, schemaDirectory: string): string {
  return `${entry.entryArtifact}\u0000${schemaDirectory}`;
}

async function compiledSchema(entry: DteXsdEntry, schemaDirectory: string): Promise<Document> {
  const inspection = await inspectDteSchemas(schemaDirectory);
  if (!inspection.usable) {
    throw new DteSchemaError(
      "DIRECTORY_UNUSABLE",
      `Schema directory ${schemaDirectory} is not usable: ` +
        `missing [${inspection.missing.join(", ")}], too small [${inspection.tooSmall.join(", ")}], ` +
        `unrewritten includes [${inspection.unrewrittenIncludes.join(", ")}].`
    );
  }

  const key = cacheKey(entry, schemaDirectory);
  const cached = compiledSchemas.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const compiling = compileSchema(entry, schemaDirectory);
  compiledSchemas.set(key, compiling);
  try {
    return await compiling;
  } catch (error) {
    compiledSchemas.delete(key);
    throw error;
  }
}

async function compileSchema(entry: DteXsdEntry, schemaDirectory: string): Promise<Document> {
  const { readFile } = await import("node:fs/promises");
  const entryXsd = await readFile(join(schemaDirectory, entry.entryArtifact), "utf8");
  assertNoAbsoluteSchemaLocations(entryXsd, entry.entryArtifact);

  let schema: Document;
  try {
    schema = parseXml(buildXsdEntrySchema(entry, schemaDirectory));
  } catch {
    throw new DteSchemaError(
      "SCHEMA_UNUSABLE",
      `The official schemas in ${schemaDirectory} did not compile into a usable schema.`
    );
  }
  if (schema.errors.length > 0) {
    throw new DteSchemaError(
      "SCHEMA_UNUSABLE",
      `The official schemas in ${schemaDirectory} did not compile: ${schema.errors
        .map((error: ValidationError) => error.message)
        .join("; ")}.`
    );
  }
  return schema;
}

/**
 * Validates one document against the official schemas prepared in
 * `schemaDirectory`, compiled from `entry`. Throws {@link DteSchemaError} when
 * the directory is not usable, so an absence is never mistaken for a pass. The
 * compiled schema is reused for every later call with the same entry in this
 * process (ADR-010 §4).
 */
export async function validateAgainstOfficialXsd(
  xml: string,
  schemaDirectory: string,
  entry: DteXsdEntry
): Promise<DteXsdValidationResult> {
  const schema = await compiledSchema(entry, schemaDirectory);

  const document = parseXml(xml);
  let valid: boolean;
  try {
    valid = document.validate(schema);
  } catch {
    throw new DteSchemaError(
      "SCHEMA_UNUSABLE",
      `The official schemas in ${schemaDirectory} could not validate a document.`
    );
  }

  return {
    valid,
    errors: document.validationErrors.map((error: ValidationError) => error.message),
    schemaDirectory,
  };
}

/** Validates one built DE document; the signature's own module is FISC-009's. */
export function validateDeAgainstOfficialXsd(
  xml: string,
  schemaDirectory: string
): Promise<DteXsdValidationResult> {
  return validateAgainstOfficialXsd(xml, schemaDirectory, DTE_SCHEMA_ENTRY);
}

/** Validates one built event lot; the signature's own module is `dte.event-signing.ts`. */
export function validateEventAgainstOfficialXsd(
  xml: string,
  schemaDirectory: string
): Promise<DteXsdValidationResult> {
  return validateAgainstOfficialXsd(xml, schemaDirectory, DTE_EVENT_SCHEMA_ENTRY);
}

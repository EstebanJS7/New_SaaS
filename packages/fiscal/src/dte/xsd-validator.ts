/**
 * FISC-008 WU-B — validating a built DE against the official DNIT schemas.
 *
 * **The entry point is ours and it is five lines.** `DE_v150.xsd` declares no
 * top-level element at all — `rDE` is a `complexType` (baseline §21's Shape
 * records "49 `complexType`s and no top-level element") — so a bare `<rDE>`
 * document has no element declaration to validate against. Rather than fetch
 * DNIT's container protocol, this module builds an entry schema that only
 * declares `<xs:element name="rDE" type="rDE"/>` and `xs:include`s the official
 * `DE_v150.xsd`. Every length, pattern, facet and enumeration still comes from
 * DNIT's bytes.
 *
 * The include is written as an absolute `file://` URL because the schema is
 * parsed from a string with no base URI; the nested includes inside
 * `DE_v150.xsd` then resolve relative to it. A directory whose absolute
 * `schemaLocation`s were not rewritten is **refused** rather than validated, so
 * this can never silently depend on DNIT being reachable.
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseXml, type Document, type ValidationError } from "libxmljs2";
import {
  assertNoAbsoluteSchemaLocations,
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

/** Builds the five-line entry schema that makes `<rDE>` addressable. */
export function buildDteEntrySchema(schemaDirectory: string): string {
  const include = pathToFileURL(join(schemaDirectory, DTE_XSD_ENTRY_ARTIFACT)).href;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"',
    `\txmlns="${SIFEN_XSD_NAMESPACE}"`,
    `\ttargetNamespace="${SIFEN_XSD_NAMESPACE}"`,
    '\telementFormDefault="qualified">',
    `\t<xs:include schemaLocation="${include}" />`,
    '\t<xs:element name="rDE" type="rDE" />',
    "</xs:schema>",
    "",
  ].join("\n");
}

/**
 * Validates one document against the official schemas prepared in
 * `schemaDirectory`. Throws {@link DteSchemaError} when the directory is not
 * usable, so an absence is never mistaken for a pass.
 */
export async function validateDeAgainstOfficialXsd(
  xml: string,
  schemaDirectory: string
): Promise<DteXsdValidationResult> {
  const inspection = await inspectDteSchemas(schemaDirectory);
  if (!inspection.usable) {
    throw new DteSchemaError(
      "DIRECTORY_UNUSABLE",
      `Schema directory ${schemaDirectory} is not usable: ` +
        `missing [${inspection.missing.join(", ")}], too small [${inspection.tooSmall.join(", ")}], ` +
        `unrewritten includes [${inspection.unrewrittenIncludes.join(", ")}].`
    );
  }

  const { readFile } = await import("node:fs/promises");
  const entryXsd = await readFile(join(schemaDirectory, DTE_XSD_ENTRY_ARTIFACT), "utf8");
  assertNoAbsoluteSchemaLocations(entryXsd, DTE_XSD_ENTRY_ARTIFACT);

  let schema: Document;
  try {
    schema = parseXml(buildDteEntrySchema(schemaDirectory));
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

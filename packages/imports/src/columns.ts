/**
 * The CSV header contract machinery (EPIC-19 [[IMP-002]], shared by [[IMP-004]]).
 *
 * ONE RESOLVER, ONE SET OF REFUSALS, ONE NORMALIZATION RULE. Every imported entity
 * declares WHICH columns a file carries and this module decides whether a file's
 * headers match that declaration. The customer contract shipped it first
 * (`customer-columns.ts`); the patient contract added a second declaration and NOT
 * a second resolver, because two resolvers would be two chances for the same
 * duplicate, unknown and missing refusals to diverge — and an operator comparing a
 * customers file with a patients file would then get two different explanations of
 * the same mistake.
 *
 * STRICT ABOUT HEADERS, deliberately: an unknown column is a refusal, not a skip.
 * This repository is strict everywhere else for the same reason — a column that is
 * silently ignored is data the operator exported, believed was imported and never
 * sees again. A duplicate is a refusal for the mirror reason: two columns mapping
 * to one field has no defined winner, and picking the first is an invisible policy.
 *
 * HEADER NORMALIZATION: trim, collapse internal whitespace runs to `_`, and
 * lowercase. So `Display Name`, ` display  name ` and `DISPLAY_NAME` are the same
 * column. Order in the file is irrelevant — matching is by name, so a spreadsheet
 * that re-ordered the columns imports exactly the same.
 */

/**
 * One entity's declaration of its file.
 *
 * The CODES and the SUBJECT are part of the declaration because the refusals are
 * per-entity by design: a patient file must not be refused with a code that says
 * `CUSTOMER`, and its messages must say "which every imported patient needs".
 * Everything else — the order of the checks, the normalization, the shape of the
 * layout — is this module's and is identical for every entity.
 */
export interface ColumnContract<TDestination extends string, TCode extends string> {
  /** Normalized header → the field it fills. THE contract, in message order. */
  readonly columns: Readonly<Record<string, TDestination>>;
  /** The headers every file must carry, derived from `columns` by the caller. */
  readonly required: readonly string[];
  /** The noun a missing-column message names: "customer", "patient". */
  readonly requiredSubject: string;
  readonly codes: {
    /** A column is not part of the contract. */
    readonly unknown: TCode;
    /** Two columns normalize to the same header. */
    readonly duplicate: TCode;
    /** A required column is absent. */
    readonly missingRequired: TCode;
  };
}

/**
 * Where each contract field sits in one file.
 *
 * `index` carries a column position only for the fields the file actually carries,
 * which is what lets a row contract distinguish "absent column" from "empty cell":
 * both become `undefined`, but a missing optional column and an empty optional cell
 * are the same thing to the row, by design.
 */
export interface ColumnLayout<TDestination extends string> {
  /** The normalized header per file column, in file order. */
  readonly headers: string[];
  readonly index: Partial<Record<TDestination, number>>;
}

export interface ColumnsSuccess<TDestination extends string> {
  readonly ok: true;
  readonly layout: ColumnLayout<TDestination>;
}

export interface ColumnsFailure<TCode extends string> {
  readonly ok: false;
  readonly code: TCode;
  /** Bounded, human readable, and safe to surface to an operator. */
  readonly message: string;
}

export type ColumnsResult<TDestination extends string, TCode extends string> =
  ColumnsSuccess<TDestination> | ColumnsFailure<TCode>;

/** Trim, collapse internal whitespace runs to `_`, lowercase. */
export function normalizeHeader(header: string): string {
  return header.trim().replace(/\s+/g, "_").toLowerCase();
}

/**
 * Reads one cell by destination field.
 *
 * Returns `undefined` for an absent COLUMN and for a blank CELL alike: both mean
 * "the file did not carry this value", and the create contracts' optional fields
 * are `undefined` rather than empty in exactly that case. A blank cell is never
 * forwarded as `""` — `min(1)` would refuse it for some fields, and a strict create
 * schema would see a value where the operator wrote none.
 *
 * CELLS ARE TRIMMED. Leading and trailing whitespace in a CSV cell is an artefact of
 * the export in essentially every case, and `min(1)` would otherwise accept a name of
 * three spaces as a name.
 *
 * Shared because both row contracts read cells, and two readers would be two chances
 * for one entity to forward `""` where the other forwards `undefined`.
 */
export function readColumnCell<TDestination extends string>(
  cells: readonly string[],
  layout: ColumnLayout<TDestination>,
  destination: TDestination
): string | undefined {
  const column = layout.index[destination];
  if (column === undefined) {
    return undefined;
  }
  const cell = cells[column];
  if (cell === undefined) {
    return undefined;
  }
  const trimmed = cell.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Resolves one file's headers against one declaration.
 *
 * Duplicate first, then unknown, then missing: a duplicated required column is
 * reported as a duplicate (the actionable fact), and an unknown column is reported
 * before a missing one because removing the stray column is what an operator does
 * first — the missing required column is usually the same mistake.
 */
export function resolveColumns<TDestination extends string, TCode extends string>(
  headers: readonly string[],
  contract: ColumnContract<TDestination, TCode>
): ColumnsResult<TDestination, TCode> {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const header of headers) {
    const key = normalizeHeader(header);
    if (seen.has(key)) {
      return {
        ok: false,
        code: contract.codes.duplicate,
        message: `The file has two columns that normalize to "${key}". Keep one of them.`,
      };
    }
    seen.add(key);
    normalized.push(key);
  }

  const index: Partial<Record<TDestination, number>> = {};

  for (const [column, key] of normalized.entries()) {
    const destination: TDestination | undefined = Object.hasOwn(contract.columns, key)
      ? contract.columns[key]
      : undefined;
    if (destination === undefined) {
      return {
        ok: false,
        code: contract.codes.unknown,
        message: `The file has a column this import does not understand: "${key}". Accepted columns are: ${Object.keys(contract.columns).join(", ")}.`,
      };
    }
    index[destination] = column;
  }

  for (const required of contract.required) {
    if (!seen.has(required)) {
      return {
        ok: false,
        code: contract.codes.missingRequired,
        message: `The file has no "${required}" column, which every imported ${contract.requiredSubject} needs.`,
      };
    }
  }

  return { ok: true, layout: { headers: normalized, index } };
}

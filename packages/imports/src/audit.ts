/**
 * The import lifecycle's audit vocabulary (EPIC-19 [[IMP-001]]/[[IMP-002]]).
 *
 * WHY IT LIVES IN THE PACKAGE. Every transition of the import machine is audited,
 * and the transitions are written by TWO deployables: the API's service issues
 * them as commands, and the worker's preview runner issues the preview ones
 * (`UPLOADED → PREVIEWING`, `→ PREVIEWED`, `→ FAILED`) because that is where the
 * work happens. Two copies of the same strings would be two copies that can
 * drift, and a drifted audit code is an audit trail that cannot be searched for a
 * transition that certainly happened.
 *
 * The `targetType` is here for the same reason: it names the table the row was
 * written for, and both writers must name the same one.
 */

/**
 * One code per transition, in the established `<domain>.<past_verb>` shape.
 *
 * There are SEVEN and not the five the Story names (`uploaded`, `previewed`,
 * `committed`, `failed`, `expired`) because the machine has two further
 * transitions that enter a work phase (`UPLOADED → PREVIEWING`,
 * `PREVIEWED → COMMITTING`), and the five do not cover them: recording `previewed`
 * before the preview ran would be a lie, and recording nothing would leave a crash
 * inside a phase with no trace.
 *
 * Reads are never audited.
 */
export const IMPORT_AUDIT_ACTION = {
  uploaded: "import.uploaded",
  previewing: "import.previewing",
  previewed: "import.previewed",
  committing: "import.committing",
  committed: "import.committed",
  failed: "import.failed",
  expired: "import.expired",
} as const;

/** `targetType` recorded on every import audit row. */
export const IMPORT_AUDIT_TARGET_TYPE = "import_job";

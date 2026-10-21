import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "@newsaas/database";
import { DomainError } from "@newsaas/shared";
import { RequestContextService } from "../context/request-context.service.js";

/**
 * Persistence boundary for the import aggregate (EPIC-19 IMP-001).
 *
 * Two properties are this file's whole job, and both are stated as types rather
 * than as conventions:
 *
 * 1. **Every query carries the tenant predicate implicitly.** `tenantId` comes
 *    from `requestContext.requireTenantId()` and from nowhere else, so call sites
 *    cannot forget it and a caller argument cannot re-scope a read or a write.
 *    Zero matching rows is `DomainError("NOT_FOUND")` with ONE shared message, so
 *    a foreign import is indistinguishable from a missing one (a byte-equivalent
 *    `404`).
 * 2. **The lifecycle is a closed state machine.** There is no `updateStatus`, no
 *    `PATCH`, and no `create` that accepts a state other than the schema default.
 *    Each transition is its own method, and each is a CONDITIONAL `updateMany`
 *    whose `where` pins the state it starts from — the `cash.repository.close`
 *    pattern. A replayed or lost-race transition therefore matches ZERO rows,
 *    returns `false`, and the service maps that to the stable `409`. The
 *    database backs the same property up (see the IMP-001 migration), so a
 *    state cannot be reached by a direct write either.
 */

/**
 * What an import file contains, pinned by schema enum `import_entity` and kept as
 * a local literal tuple so this boundary stays decoupled from the generated
 * client namespace (structural compatibility only).
 *
 * The list lives HERE, with the persistence vocabulary, and the request contract
 * imports it: the `entity` field of an upload is only valid if the database can
 * store it, so there is one list instead of two that could drift.
 */
export const IMPORT_ENTITY_VALUES = ["CUSTOMER", "PATIENT"] as const;

export type ImportEntityValue = (typeof IMPORT_ENTITY_VALUES)[number];

/**
 * Every value of schema enum `import_job_state`, in lifecycle order.
 *
 * ```text
 * UPLOADED   → PREVIEWING → PREVIEWED → COMMITTING → COMMITTED
 *                    ↓                       ↓
 *                  FAILED                 FAILED
 * any non-terminal → EXPIRED
 * ```
 */
export const IMPORT_JOB_STATES = [
  "UPLOADED",
  "PREVIEWING",
  "PREVIEWED",
  "COMMITTING",
  "COMMITTED",
  "FAILED",
  "EXPIRED",
] as const;

export type ImportJobStateValue = (typeof IMPORT_JOB_STATES)[number];

/**
 * The TERMINAL states: `COMMITTED`, `FAILED`, `EXPIRED`. A terminal import has no
 * exit — an import that ran is history, and running again is a new job with a new
 * artefact. `isTerminal` is the single predicate every caller reads, so the set
 * has one definition instead of a literal repeated at each check.
 */
export const IMPORT_JOB_TERMINAL_STATES = [
  "COMMITTED",
  "FAILED",
  "EXPIRED",
] as const satisfies readonly ImportJobStateValue[];

export type ImportJobTerminalState = (typeof IMPORT_JOB_TERMINAL_STATES)[number];

/** True when `state` is terminal: no transition leaves it, ever. */
export function isTerminal(state: ImportJobStateValue): state is ImportJobTerminalState {
  return (IMPORT_JOB_TERMINAL_STATES as readonly ImportJobStateValue[]).includes(state);
}

/**
 * The states `expire` may leave from, DERIVED from the terminal set so the two
 * can never drift: adding a state to the lifecycle automatically makes it
 * expirable, and marking one terminal automatically stops it.
 */
export const IMPORT_JOB_NON_TERMINAL_STATES: readonly ImportJobStateValue[] =
  IMPORT_JOB_STATES.filter((state) => !isTerminal(state));

/**
 * The per-row verdict values, pinned by schema enum `import_row_status`. Two
 * values because [[DEC-071]] made a commit partial: a row produced a record or it
 * did not.
 */
export const IMPORT_ROW_STATUS_VALUES = ["CREATE", "FAILED"] as const;

export type ImportRowStatusValue = (typeof IMPORT_ROW_STATUS_VALUES)[number];

/**
 * How long an uploaded artefact is kept: 72 hours, stamped on the row at upload
 * (`artefactExpiresAt = now + this`).
 *
 * Generous ON PURPOSE. An operator may upload a file of a customer list, preview
 * what it would do, leave for the day and come back to commit it; a TTL short
 * enough to expire under a working session would turn an ordinary business flow
 * into a support ticket — and a shorter window buys nothing, because the artefact
 * is deleted the moment the job reaches a terminal state, which is the usual
 * case. The TTL only governs the import that never finishes ([[DEC-072]]).
 */
export const IMPORT_ARTEFACT_TTL_HOURS = 72;

/** {@link IMPORT_ARTEFACT_TTL_HOURS} in milliseconds, for the upload write. */
export const IMPORT_ARTEFACT_TTL_MS = IMPORT_ARTEFACT_TTL_HOURS * 60 * 60 * 1000;

/**
 * Persistence row for one import job as the read boundary sees it.
 *
 * `storageKey` is present here and NOWHERE else in the request path: the service
 * uses it to read and to delete the object, and no response DTO declares it
 * ([[DEC-072]]). `artefactExpiresAt` is non-nullable because the object exists
 * from the moment this row does; `artefactDeletedAt` is nullable because it is an
 * event, not a state.
 */
export interface ImportJobRow {
  id: string;
  tenantId: string;
  entity: ImportEntityValue;
  state: ImportJobStateValue;
  storageKey: string;
  contentType: string;
  byteSize: number;
  createdByMembershipId: string;
  createdCount: number;
  failedCount: number;
  suspectedDuplicateCount: number;
  previewedAt: Date | null;
  committedAt: Date | null;
  failedAt: Date | null;
  artefactExpiresAt: Date;
  artefactDeletedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Persistence row for one row's verdict. This shape IS the no-personal-data
 * promise in type form: there is no field for a name, a phone, an e-mail, a
 * document number, a species or a birth date, and no link to the customer or
 * patient the row produced ([[DEC-071]]).
 */
export interface ImportRowOutcomeRow {
  id: string;
  tenantId: string;
  importId: string;
  rowNumber: number;
  status: ImportRowStatusValue;
  reasonCode: string | null;
  message: string | null;
  suspectedDuplicate: boolean;
  createdAt: Date;
}

/**
 * Write payload for {@link ImportRepository.create}. There is deliberately NO
 * `tenantId` (resolved from the request context), NO `state` (a new job takes the
 * schema default `UPLOADED`), NO counters (they describe a finished commit) and
 * NO timestamps (the row owns its own `createdAt`). The membership is the
 * server-resolved caller, never caller input; the key is the server-generated
 * opaque one.
 */
export interface ImportJobCreateData {
  readonly entity: ImportEntityValue;
  readonly storageKey: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly createdByMembershipId: string;
  readonly artefactExpiresAt: Date;
}

/**
 * The counters one finished commit writes ([[DEC-071]]). They describe ONE
 * commit, so they are written once, in the same statement that enters
 * `COMMITTED`.
 */
export interface ImportCommitCounters {
  readonly createdCount: number;
  readonly failedCount: number;
  readonly suspectedDuplicateCount: number;
}

/** Predicate fields the tenant-scoped import queries are allowed to build. */
export interface ImportJobWhere {
  id?: string;
  tenantId?: string;
  /** A single state, or the closed set a transition may start from. */
  state?: ImportJobStateValue | { in: readonly ImportJobStateValue[] };
  /** `null` means "not deleted yet" — the artefact-deletion stamp's CAS. */
  artefactDeletedAt?: Date | null;
  /** TTL sweep predicate: rows whose deadline is strictly before this instant. */
  artefactExpiresAt?: { lt: Date };
}

/** Deterministic ordering clauses accepted by the import list delegate. */
export interface ImportOrderBy {
  createdAt?: "asc" | "desc";
  id?: "asc" | "desc";
  /** The TTL sweep drains in deadline order, oldest first. */
  artefactExpiresAt?: "asc" | "desc";
}

/**
 * Fields a transition may write. This is the ONLY mutation surface the delegate
 * exposes — never a caller-supplied state object — and `state` appears here
 * because a transition IS a state change; the repository methods decide its
 * value, not the caller.
 */
export interface ImportJobUpdateData {
  state?: ImportJobStateValue;
  previewedAt?: Date | null;
  committedAt?: Date | null;
  failedAt?: Date | null;
  artefactDeletedAt?: Date | null;
  failureReason?: string | null;
  createdCount?: number;
  failedCount?: number;
  suspectedDuplicateCount?: number;
}

/**
 * Structural contract for the job delegate. The generated client and the
 * in-memory test fake both satisfy it. There is deliberately NO delete and NO
 * `update`: a job is read, created once, and moved by conditional `updateMany`
 * writes whose `where` pins the state they leave.
 */
export interface ImportJobDelegate {
  findFirst: (args: { where: ImportJobWhere }) => Promise<ImportJobRow | null>;
  findMany: (args: {
    where: ImportJobWhere;
    orderBy?: readonly ImportOrderBy[];
    take?: number;
  }) => Promise<ImportJobRow[]>;
  create: (args: { data: ImportJobCreateData & { tenantId: string } }) => Promise<ImportJobRow>;
  updateMany: (args: {
    where: ImportJobWhere;
    data: ImportJobUpdateData;
  }) => Promise<{ count: number }>;
}

/**
 * Structural contract for the row-outcome delegate. IMP-001 ships the table and
 * the projection, not the writer: [[IMP-003]] appends the verdicts. The
 * `create`/`findMany` pair exists here because the in-memory boundary and the
 * aggregate's own tests need it, and because the schema promises the shape.
 */
export interface ImportRowOutcomeDelegate {
  findMany: (args: {
    where: { tenantId: string; importId: string };
    orderBy?: readonly { rowNumber?: "asc" | "desc" }[];
  }) => Promise<ImportRowOutcomeRow[]>;
  create: (args: {
    data: Omit<ImportRowOutcomeRow, "id" | "createdAt"> & { createdAt?: Date };
  }) => Promise<ImportRowOutcomeRow>;
}

/**
 * Structural contract for resolving the CALLER'S OWN membership. Only the id is
 * needed: the row stores the reference the database's composite `RESTRICT`
 * foreign key guarantees belongs to the same tenant (the `cash.repository`
 * seam).
 */
export interface ImportMembershipLookup {
  findFirst: (args: {
    where: { tenantId: string; userProfileId: string; status: "ACTIVE" };
    orderBy?: readonly { createdAt?: "asc" | "desc"; id?: "asc" | "desc" }[];
  }) => Promise<{ id: string } | null>;
}

/**
 * The delegate set this repository touches. Doubles as the optional transaction
 * seam: the audited service passes its open transaction handle here so the state
 * change and its audit row co-commit.
 */
export interface ImportTx {
  importJob: ImportJobDelegate;
  importRowOutcome: ImportRowOutcomeDelegate;
  tenantMembership: ImportMembershipLookup;
}

/** Single stable message behind every import 404 (byte-equivalence by construction). */
export const IMPORT_NOT_FOUND_MESSAGE = "Import was not found.";

/**
 * Single stable `409 CONFLICT` for EVERY refused transition — a replay, an
 * out-of-order command and a command against a terminal state are the same
 * answer, because the caller's mistake is the same one: the import is not in a
 * state that allows this. One message also means the refusal is no oracle for
 * which state the row is actually in.
 */
export const IMPORT_TRANSITION_CONFLICT_MESSAGE =
  "The import is not in a state that allows this transition.";

/**
 * Stable `403 FORBIDDEN` when the caller's own ACTIVE membership cannot be
 * resolved for the active tenant. The uploader is server-owned identity, so a
 * missing membership is an authorization failure rather than a `404` about an
 * addressed resource (the `cash.repository` rule).
 */
export const IMPORT_MEMBERSHIP_NOT_RESOLVED_MESSAGE =
  "The caller's active tenant membership could not be resolved.";

/**
 * Tenant-safe data access for the import aggregate, and the ONE owner of its
 * lifecycle (EPIC-19 IMP-001).
 *
 * Contract, in the order a reader should check it:
 *
 * - every query carries the tenant predicate IMPLICITLY, from
 *   `requestContext.requireTenantId()`; a foreign id falls through to the shared
 *   `NOT_FOUND`;
 * - the ONLY status writer is a conditional `updateMany` whose `where` pins the
 *   state the transition leaves, so a replay or a lost race matches zero rows;
 * - the terminal set has no exit, and `expire` derives its source set from that
 *   same terminal set;
 * - there is no delete and no unconditional update anywhere on this repository.
 *
 * The transitions return `boolean` rather than throwing, because "zero rows
 * matched" is a NORMAL outcome (a lost race is a business answer, not an
 * exception) and the service is the layer that turns it into the stable `409`.
 */
@Injectable()
export class ImportRepository {
  constructor(
    // Explicit @Inject token keeps DI resolution token-based while the PARAM
    // type stays the narrow delegate set this boundary actually needs.
    @Inject(PrismaService) private readonly prisma: ImportTx,
    @Inject(RequestContextService) private readonly requestContext: RequestContextService
  ) {}

  /**
   * Creates one import job in the CALLER'S active tenant, in `UPLOADED`.
   *
   * `tenantId` is resolved from the request context and placed LAST in the
   * payload, so even a rogue property on `data` cannot re-scope the insert.
   * `state` is left to the schema default: this method cannot create a job in any
   * other state, which is what makes `UPLOADED` the single entry point of the
   * machine.
   */
  async create(data: ImportJobCreateData, tx?: ImportTx): Promise<ImportJobRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.importJob.create({
      data: {
        entity: data.entity,
        storageKey: data.storageKey,
        contentType: data.contentType,
        byteSize: data.byteSize,
        createdByMembershipId: data.createdByMembershipId,
        artefactExpiresAt: data.artefactExpiresAt,
        tenantId,
      },
    });
  }

  /**
   * One import of the CALLER'S active tenant by id.
   *
   * The tenant predicate rides along in the SAME WHERE clause, so a foreign id
   * falls through to the shared `NOT_FOUND` instead of leaking existence. This is
   * also the `404`/`409` separator for the commands: a command reads first, so an
   * unknown or foreign import is `404` while a wrong-state import is `409`.
   */
  async findById(id: string, tx?: ImportTx): Promise<ImportJobRow> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const row = await client.importJob.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new DomainError("NOT_FOUND", IMPORT_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /**
   * The caller tenant's imports, NEWEST FIRST, with `id` ascending as the
   * tiebreaker for rows created in the same millisecond.
   *
   * The page is bounded at the request contract ([[TD-026]]), not here: `take` is
   * the already-validated limit, so this method never invents a default that
   * could disagree with the DTO's.
   */
  async list(limit: number, tx?: ImportTx): Promise<ImportJobRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.importJob.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: limit,
    });
  }

  /**
   * The caller tenant's imports whose artefact has outlived its TTL and still
   * exists: `artefact_expires_at < now` and not yet deleted. Oldest deadline first,
   * so a backlog drains in the order it accumulated.
   *
   * The STATE is deliberately not filtered, and that is the point of the read: a row
   * is due because its OBJECT is due, whichever state its job is in. That covers the
   * import that never finished (the sweep expires it) and the finished import whose
   * deletion failed earlier (the sweep only retries the delete). Filtering on
   * non-terminal states here would leave the second case's artefact in storage for
   * ever, because nothing else would ever revisit it.
   *
   * This is the read the TTL sweep drives; it is TENANT-scoped like every other
   * query here, so a platform-wide sweep iterates tenants (or runs from the
   * worker's own boundary) instead of asking this layer to forget its tenant.
   */
  async findOverdue(now: Date, limit: number, tx?: ImportTx): Promise<ImportJobRow[]> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    return client.importJob.findMany({
      where: {
        tenantId,
        artefactExpiresAt: { lt: now },
        artefactDeletedAt: null,
      },
      orderBy: [{ artefactExpiresAt: "asc" }, { id: "asc" }],
      take: limit,
    });
  }

  /**
   * `UPLOADED` → `PREVIEWING`. The first command of the machine: a preview has
   * started reading the artefact.
   */
  async startPreview(id: string, tx?: ImportTx): Promise<boolean> {
    return this.transition(id, ["UPLOADED"], { state: "PREVIEWING" }, tx);
  }

  /**
   * `PREVIEWING` → `PREVIEWED`, stamping the instant the preview finished. The
   * instant is written in the SAME statement as the state, so a `PREVIEWED` job
   * always knows when it got there and a replayed transition can never rewrite it.
   */
  async completePreview(id: string, tx?: ImportTx): Promise<boolean> {
    return this.transition(id, ["PREVIEWING"], { state: "PREVIEWED", previewedAt: new Date() }, tx);
  }

  /** `PREVIEWED` → `COMMITTING`. The commit has started writing records. */
  async startCommit(id: string, tx?: ImportTx): Promise<boolean> {
    return this.transition(id, ["PREVIEWED"], { state: "COMMITTING" }, tx);
  }

  /**
   * `COMMITTING` → `COMMITTED`, writing the three counters and the commit instant
   * in the SAME statement.
   *
   * This is the row that makes [[DEC-071]]'s summary durable: the counts are
   * written once, by the one transition that produced them, and the `where` pins
   * `COMMITTING` so a replayed or concurrent commit matches zero rows and cannot
   * rewrite the counts or the instant.
   */
  async completeCommit(
    id: string,
    counters: ImportCommitCounters,
    tx?: ImportTx
  ): Promise<boolean> {
    return this.transition(
      id,
      ["COMMITTING"],
      {
        state: "COMMITTED",
        committedAt: new Date(),
        createdCount: counters.createdCount,
        failedCount: counters.failedCount,
        suspectedDuplicateCount: counters.suspectedDuplicateCount,
      },
      tx
    );
  }

  /**
   * → `FAILED` from either work phase (`PREVIEWING` or `COMMITTING`), stamping
   * the failure instant and the bounded reason.
   *
   * The two sources share one command because the target and the payload are
   * identical — one phase failing is the same fact as the other phase failing, and
   * the state it came FROM is already recorded by the audit row that preceded it.
   * The source set is pinned explicitly, so a failure can never be recorded from a
   * state that is not a work phase (notably not from a terminal one).
   */
  async fail(id: string, failureReason: string, tx?: ImportTx): Promise<boolean> {
    return this.transition(
      id,
      ["PREVIEWING", "COMMITTING"],
      { state: "FAILED", failedAt: new Date(), failureReason },
      tx
    );
  }

  /**
   * → `EXPIRED` from ANY non-terminal state, for the TTL sweep.
   *
   * The source set is derived from the terminal set (see
   * {@link IMPORT_JOB_NON_TERMINAL_STATES}) rather than written out, so "expire
   * anything that has not finished" stays true when the lifecycle grows.
   */
  async expire(id: string, tx?: ImportTx): Promise<boolean> {
    return this.transition(id, IMPORT_JOB_NON_TERMINAL_STATES, { state: "EXPIRED" }, tx);
  }

  /**
   * Stamps `artefactDeletedAt`, conditional on it still being `NULL`.
   *
   * The CAS is what makes artefact deletion idempotent at the DATABASE level: the
   * object delete itself is idempotent (the port says so), so two callers racing
   * here both succeed harmlessly and exactly one records that it happened. Returns
   * `false` when the stamp already existed, which is the "nothing left to do"
   * answer the service reports.
   */
  async markArtefactDeleted(id: string, tx?: ImportTx): Promise<boolean> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const result = await client.importJob.updateMany({
      where: { id, tenantId, artefactDeletedAt: null },
      data: { artefactDeletedAt: new Date() },
    });
    return result.count > 0;
  }

  /**
   * Resolves the CALLER'S OWN active-tenant membership id for
   * `created_by_membership_id`. Both the tenant and the profile come from the
   * request context — never from the body — and the lookup requires the
   * membership to be `ACTIVE` and scoped to the active tenant, so the composite
   * `RESTRICT` foreign key's same-tenant guarantee is satisfied by an identity the
   * caller could not choose.
   *
   * The ordering mirrors `TenantActiveGuard`'s ACTIVE-membership resolution
   * `(createdAt, id)`, so with more than one ACTIVE membership the same
   * deterministic row the guard adopted is the one recorded.
   */
  async resolveActiveMembershipId(tx?: ImportTx): Promise<string> {
    const tenantId = this.requestContext.requireTenantId();
    const userProfileId = this.requestContext.requireUserProfileId();
    const client = tx ?? this.prisma;
    const membership = await client.tenantMembership.findFirst({
      where: { tenantId, userProfileId, status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!membership) {
      throw new DomainError("FORBIDDEN", IMPORT_MEMBERSHIP_NOT_RESOLVED_MESSAGE);
    }
    return membership.id;
  }

  /**
   * The ONE conditional write every transition is built from.
   *
   * `states` is the set the row must currently be IN; `data` is the single state
   * it moves to. The tenant predicate rides along, so a transition can never
   * cross a tenant boundary. `count === 0` means the row was not in one of the
   * required states — a replay, a lost race, or a command against a terminal
   * import — and the caller maps that to the stable `409`.
   */
  private async transition(
    id: string,
    states: readonly ImportJobStateValue[],
    data: ImportJobUpdateData,
    tx?: ImportTx
  ): Promise<boolean> {
    const tenantId = this.requestContext.requireTenantId();
    const client = tx ?? this.prisma;
    const result = await client.importJob.updateMany({
      where: { id, tenantId, state: { in: states } },
      data,
    });
    return result.count > 0;
  }
}

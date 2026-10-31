import type { ClinicalRecordCopy, ClinicalRecordRecovery } from "./clinical-record-recovery";
import { isoToLocalInput } from "../../agenda/agenda-time";

export interface DurableDraftRef {
  id: string;
  version: number;
  submitVersion: number;
}
interface FrozenCommand {
  idempotencyKey?: string;
  expectedVersion?: number;
  correctionReason?: string;
  description?: string;
  context?: string | null;
  administeredAt?: string;
  studyType?: string;
  result?: string;
  performedAt?: string;
  quantity?: string;
  unit?: "KG";
  measuredAt?: string;
}
export interface ServerClinicalDraft {
  id: string;
  version: number;
  state: "ACTIVE" | "PENDING" | "COMPLETED" | "DISCARDED";
  copy: ClinicalRecordCopy;
  command: FrozenCommand | null;
  confirmedId: string | null;
  updatedAt: string;
}
function invalid(): never {
  throw new ClinicalDraftError(0, "INVALID_RESPONSE");
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 10000): string {
  if (typeof value !== "string" || value.length > max) return invalid();
  return value;
}
function uuid(value: unknown): string {
  const s = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return invalid();
  return s;
}
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2147483647)
    return invalid();
  return value;
}
function instant(value: unknown): string {
  const s = text(value, 40);
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(s) || !Number.isFinite(Date.parse(s)))
    return invalid();
  return s;
}
function command(value: unknown): FrozenCommand {
  const row = object(value),
    out: FrozenCommand = {};
  for (const key of [
    "description",
    "context",
    "studyType",
    "result",
    "quantity",
    "correctionReason",
  ] as const)
    if (row[key] !== undefined) {
      if (key === "context") out.context = row.context === null ? null : text(row.context);
      else out[key] = text(row[key]);
    }
  for (const key of ["administeredAt", "performedAt", "measuredAt"] as const)
    if (row[key] !== undefined) out[key] = instant(row[key]);
  if (row.idempotencyKey !== undefined) out.idempotencyKey = uuid(row.idempotencyKey);
  if (row.expectedVersion !== undefined) out.expectedVersion = version(row.expectedVersion);
  if (row.unit !== undefined) {
    if (row.unit !== "KG") return invalid();
    out.unit = "KG";
  }
  if (
    Object.keys(row).some(
      (key) =>
        ![
          "description",
          "context",
          "studyType",
          "result",
          "quantity",
          "correctionReason",
          "administeredAt",
          "performedAt",
          "measuredAt",
          "idempotencyKey",
          "expectedVersion",
          "unit",
        ].includes(key)
    )
  )
    return invalid();
  return out;
}
function parseCopy(value: unknown): ClinicalRecordCopy {
  const row = object(value),
    f = object(row.fields),
    i = row.initial === undefined ? undefined : object(row.initial);
  const initial = i ? { id: uuid(i.id), version: version(i.version) } : undefined;
  let creation: { key: string; command?: FrozenCommand } | undefined;
  if (f.creation !== undefined) {
    const c = object(f.creation);
    creation = {
      key: uuid(c.key),
      ...(c.command !== undefined && { command: command(c.command) }),
    };
  }
  const common = {
    date: text(f.date, 40),
    ...(f.correctionReason !== undefined && { correctionReason: text(f.correctionReason, 2000) }),
    ...(creation && { creation }),
  };
  if (row.kind === "treatment")
    return {
      kind: "treatment",
      ...(i &&
        initial && {
          initial: {
            ...initial,
            description: text(i.description, 2000),
            context: i.context === null ? null : text(i.context),
            administeredAt: instant(i.administeredAt),
          },
        }),
      fields: { ...common, description: text(f.description, 2000), context: text(f.context) },
    };
  if (row.kind === "study")
    return {
      kind: "study",
      ...(i &&
        initial && {
          initial: {
            ...initial,
            studyType: text(i.studyType, 2000),
            result: text(i.result),
            performedAt: instant(i.performedAt),
          },
        }),
      fields: { ...common, studyType: text(f.studyType, 2000), result: text(f.result) },
    };
  if (row.kind !== "weight" || typeof f.confirmedKg !== "boolean") return invalid();
  if (i && i.unit !== null && i.unit !== "KG") return invalid();
  return {
    kind: "weight",
    ...(i &&
      initial && {
        initial: {
          ...initial,
          quantity: text(i.quantity, 20),
          unit: i.unit === null ? null : "KG",
          measuredAt: instant(i.measuredAt),
        },
      }),
    fields: { ...common, quantity: text(f.quantity, 40), confirmedKg: f.confirmedKg },
  };
}
function parseDraft(value: unknown): ServerClinicalDraft {
  const row = object(value);
  if (
    row.state !== "ACTIVE" &&
    row.state !== "PENDING" &&
    row.state !== "COMPLETED" &&
    row.state !== "DISCARDED"
  )
    return invalid();
  const copy = parseCopy(row.copy),
    cmd = row.command === null ? null : command(row.command);
  if (row.state === "ACTIVE" ? cmd !== null : row.state !== "DISCARDED" && cmd === null)
    return invalid();
  if (!copy.initial && !copy.fields.creation) return invalid();
  if (
    row.state === "PENDING" &&
    (copy.initial
      ? cmd?.expectedVersion !== copy.initial.version
      : cmd?.idempotencyKey !== copy.fields.creation?.key)
  )
    return invalid();
  return {
    id: uuid(row.id),
    version: version(row.version),
    state: row.state,
    copy,
    command: cmd,
    confirmedId: row.confirmedId === null ? null : uuid(row.confirmedId),
    updatedAt: instant(row.updatedAt),
  };
}
export class ClinicalDraftError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}
async function request(
  patientId: string,
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: unknown
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/clinical/${encodeURIComponent(patientId)}/drafts/${path}`, {
      method,
      cache: "no-store",
      ...(body !== undefined && {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
  } catch {
    throw new ClinicalDraftError(0, "NETWORK");
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ClinicalDraftError(response.status, "REQUEST_FAILED");
  return payload;
}
export function draftMessage(error: unknown) {
  return error instanceof ClinicalDraftError && error.status === 409
    ? "El borrador cambió en otra pestaña o ya fue enviado. Volvé a consultar los borradores guardados."
    : error instanceof ClinicalDraftError && [401, 403, 404].includes(error.status)
      ? "No tenés acceso a este borrador. Volvé a comprobar tu sesión y permisos."
      : "No pudimos confirmar el borrador. Tus cambios siguen en este formulario; podés consultar los borradores guardados antes de repetir.";
}
export async function readServerDraft(patient: string, id: string) {
  const item = parseDraft(await request(patient, encodeURIComponent(id), "GET"));
  if (item.id !== id) return invalid();
  return item;
}
export async function searchServerDrafts(
  patient: string,
  kind: ClinicalRecordCopy["kind"],
  before?: string
) {
  const row = object(await request(patient, "search", "POST", { kind, ...(before && { before }) }));
  if (!Array.isArray(row.items) || row.items.length > 20) return invalid();
  const items: ServerClinicalDraft[] = row.items.map((value: unknown) => parseDraft(value));
  if (items.some((item) => item.copy.kind !== kind || !["ACTIVE", "PENDING"].includes(item.state)))
    return invalid();
  return { items, nextCursor: row.nextCursor === null ? null : uuid(row.nextCursor) };
}
export async function saveServerDraft(
  patient: string,
  id: string,
  version: number,
  copy: ClinicalRecordCopy
) {
  const { durable: _durable, ...fields } = copy.fields;
  const item = parseDraft(
    await request(patient, encodeURIComponent(id), "PUT", { version, copy: { ...copy, fields } })
  );
  if (item.id !== id || item.state !== "ACTIVE") throw new ClinicalDraftError(409, "CONFLICT");
  return item;
}
export async function discardServerDraft(patient: string, ref: DurableDraftRef) {
  await request(patient, `${encodeURIComponent(ref.id)}/discard`, "POST", { version: ref.version });
}
/** A failed acknowledgement does not turn a confirmed clinical write into a new creation. */
export async function acknowledgeServerDraft(patient: string, ref: DurableDraftRef | undefined) {
  if (!ref) return;
  try {
    await request(patient, `${encodeURIComponent(ref.id)}/complete`, "POST", {
      version: ref.submitVersion + 1,
    });
  } catch {
    /* The retained pending copy remains conservative and explicitly discardable. */
  }
}
export function draftReference(item: ServerClinicalDraft): DurableDraftRef {
  return {
    id: item.id,
    version: item.version,
    submitVersion:
      item.state === "ACTIVE"
        ? item.version
        : item.state === "PENDING"
          ? item.version - 1
          : item.version - 2,
  };
}
export function serverDraftRecovery(item: ServerClinicalDraft): ClinicalRecordRecovery {
  let copy = { ...item.copy, fields: { ...item.copy.fields } } as ClinicalRecordCopy;
  const c = item.command;
  if (item.state === "PENDING" && c) {
    const { idempotencyKey: _key, expectedVersion: _version, ...content } = c;
    if (copy.kind === "treatment")
      copy = {
        ...copy,
        fields: {
          ...copy.fields,
          ...(c.description !== undefined && { description: c.description }),
          ...(c.context !== undefined && { context: c.context ?? "" }),
          ...(c.administeredAt && { date: isoToLocalInput(c.administeredAt) }),
        },
      };
    else if (copy.kind === "study")
      copy = {
        ...copy,
        fields: {
          ...copy.fields,
          ...(c.studyType !== undefined && { studyType: c.studyType }),
          ...(c.result !== undefined && { result: c.result }),
          ...(c.performedAt && { date: isoToLocalInput(c.performedAt) }),
        },
      };
    else
      copy = {
        ...copy,
        fields: {
          ...copy.fields,
          ...(c.quantity !== undefined && { quantity: c.quantity }),
          ...(c.unit === "KG" && { confirmedKg: true }),
          ...(c.measuredAt && { date: isoToLocalInput(c.measuredAt) }),
        },
      };
    if (c.correctionReason !== undefined) copy.fields.correctionReason = c.correctionReason;
    if (!copy.initial && copy.fields.creation)
      copy.fields.creation = {
        ...copy.fields.creation,
        command: content,
        ...(item.confirmedId && { savedId: item.confirmedId }),
      };
  }
  copy.fields.durable = draftReference(item);
  return {
    ...copy,
    token: item.id,
    status: item.state === "ACTIVE" ? "draft" : "uncertain",
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
}

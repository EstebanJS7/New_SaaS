import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@newsaas/database";
import { PrismaService } from "@newsaas/database";

/**
 * The one place that creates a delivery intent from a dedupe key.
 *
 * It exists because **three** callers now need the same idempotent creation — the
 * reminder scheduler (EPIC-17), the fiscal notice scheduler (in the worker, which
 * still carries its own copy) and staff password recovery (DAT-007) — and the
 * second copy was already one too many. The `ensure` shape is what makes a
 * caller's enqueue both idempotent and self-healing: a first attempt whose enqueue
 * failed leaves a `SCHEDULED` row with no job, and every later attempt must be
 * able to re-enqueue rather than take a conflict branch and give up.
 */
export interface NotificationIntentArgs {
  readonly tenantId: string;
  readonly channel: "EMAIL" | "WHATSAPP";
  readonly sourceType: "APPOINTMENT" | "FISCAL_DOCUMENT" | "STAFF_ACCOUNT";
  readonly sourceId: string;
  readonly recipientType: "CUSTOMER" | "STAFF";
  readonly recipientId: string;
  readonly scheduledAt: Date;
  readonly dedupeKey: string;
}

/**
 * The narrow client, declared with Prisma's OWN arg types so the real client fits
 * by construction and a suite can pass a stub.
 */
export interface NotificationIntentPrisma {
  notificationDelivery: {
    create(args: Prisma.NotificationDeliveryCreateArgs): Promise<{ id: string }>;
    findFirst(args: Prisma.NotificationDeliveryFindFirstArgs): Promise<{ id: string } | null>;
  };
}

@Injectable()
export class NotificationIntentService {
  constructor(@Inject(PrismaService) private readonly prisma: NotificationIntentPrisma) {}

  /**
   * The intent's id: the one it just created, or the PENDING one that already
   * holds the key.
   *
   * `null` means the key is held by a delivery that is no longer pending — a
   * cancelled one, whose key the partial index releases — so whoever cancelled it
   * owns the intent and the caller has nothing to schedule.
   */
  async ensureIntent(args: NotificationIntentArgs): Promise<string | null> {
    try {
      const created = await this.prisma.notificationDelivery.create({
        data: {
          tenantId: args.tenantId,
          channel: args.channel,
          status: "SCHEDULED",
          dedupeKey: args.dedupeKey,
          sourceType: args.sourceType,
          sourceId: args.sourceId,
          recipientType: args.recipientType,
          recipientId: args.recipientId,
          scheduledAt: args.scheduledAt,
        },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (!isDedupeKeyConflict(error)) throw error;
      const existing = await this.prisma.notificationDelivery.findFirst({
        where: {
          tenantId: args.tenantId,
          dedupeKey: args.dedupeKey,
          status: { in: ["SCHEDULED", "QUEUED"] },
        },
        select: { id: true },
      });
      return existing?.id ?? null;
    }
  }
}

/**
 * True only for a `P2002` raised by the `(tenant_id, dedupe_key)` unique — never
 * for an unrelated one such as the tenant-ownership key, which must propagate
 * untouched (`sales.service.ts`'s matcher, which documents both shapes Prisma
 * reports: the violated INDEX NAME, or the violated COLUMNS).
 */
/** The unique key's index name, as PostgreSQL reports it. */
const DEDUPE_KEY_CONSTRAINT = "notification_delivery_tenant_id_dedupe_key_key";

/** The unique key's columns, normalized once for shape-agnostic matching. */
const DEDUPE_KEY_FIELDS: readonly string[] = ["tenantid", "dedupekey"];

/**
 * True only for a `P2002` raised by the `(tenant_id, dedupe_key)` unique — never
 * for an unrelated one such as the tenant-ownership key, which must propagate
 * untouched (`sales.service.ts`'s matcher, which documents both shapes Prisma
 * reports: the violated INDEX NAME, or the violated COLUMNS).
 *
 * This matcher is kept EXACTLY as the reminder scheduler had it, normalizing both
 * shapes, rather than simplified while moving it: a version that only compared
 * bare column names would miss the index-name shape and turn a handled conflict
 * into a thrown error — which is the kind of regression an extraction is most
 * likely to introduce, and the reason this one is a move and not a rewrite.
 */
export function isDedupeKeyConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;

  const normalize = (token: string): string => token.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = candidate.meta?.target;
  const expectedConstraint = normalize(DEDUPE_KEY_CONSTRAINT);
  if (typeof target === "string") {
    return normalize(target) === expectedConstraint;
  }
  if (!Array.isArray(target)) return false;

  const tokens = target.filter((entry): entry is string => typeof entry === "string");
  if (tokens.length === 0) return false;
  if (tokens.length === 1 && normalize(tokens[0] ?? "") === expectedConstraint) return true;

  const normalized = tokens.map(normalize);
  return (
    normalized.length === DEDUPE_KEY_FIELDS.length &&
    DEDUPE_KEY_FIELDS.every((field) => normalized.includes(field))
  );
}

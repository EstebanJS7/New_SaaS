-- IMP-001 (EPIC-19, DEC-071 and DEC-072). The import aggregate, its artefact
-- reference and its per-row outcome.
--
-- WHY THESE TWO TABLES EXIST. Nothing about importing existed. A bulk import is
-- not a request: an operator uploads a file of unknown size, previews what it
-- would do, and then commits it — and the thing an operator keeps afterwards is
-- the RESULT, not the response that produced it. DEC-071 made that result
-- durable, so it needs somewhere durable to live: one row for the job, one row
-- per data row the job touched.
--
-- WHY THE FILE IS NOT IN POSTGRES (DEC-072). The bytes can be megabytes of a
-- tenant's customer list, and the system of record for the aggregate is not the
-- system of record for blobs. `import_job.storage_key` therefore holds only an
-- OPAQUE, server-generated key into the object store. Two properties follow from
-- that and both are the point of this migration rather than of the code above it:
--
--   * the key never leaves the server — no response of any kind carries it. The
--     worker reads it from this row, exactly as the fiscal handler reads its own
--     document, so it crosses a boundary between two deployables and never a
--     network boundary to a browser. There is deliberately NO public or signed URL
--     for the object: DEC-072 says the surface never downloads the artefact back,
--     and having no route for it is what keeps that true;
--   * the object outlives the request that wrote it, so its lifetime is stated on
--     the row: `artefact_expires_at` is NOT NULL (the upload command writes
--     `now + 72 hours`, deliberately generous because an operator may preview,
--     leave and come back) and `artefact_deleted_at` records the deletion that a
--     terminal state or the TTL sweep performed. TD-058 records that there is no
--     approved retention policy to be consistent with yet; the deletion rule
--     above is the honest interim.
--
-- `import_row_outcome` CARRIES NO PERSONAL DATA, DELIBERATELY. No name, no phone,
-- no e-mail, no document number, no species, no birth date, and no reference to
-- the customer or patient the row produced. The row it describes was already
-- written into the record the import created, so a copy here would duplicate
-- personal data for no gain and would put a second copy of a tenant's customer
-- list in a table with no retention story (DEC-071). What IS stored is a verdict:
-- the 1-based DATA row number, the status, a stable reason code, a bounded
-- message and a suspicion flag. The message names the condition, never the value.
--
-- Strictly additive: three new enum types, two new tables, their indexes and
-- constraints. No existing table, column, type, row or constraint is altered.
--
-- WHAT THE DATABASE ENFORCES, rather than trusting the application layer for:
--   * tenant ownership on BOTH dimensions — the uploader must be a membership of
--     the job's own tenant, and a row outcome must belong to a job of its own
--     tenant, both as COMPOSITE foreign keys (the `cash_session` precedent);
--   * the three counters are never negative and a DATA row number is never below
--     1, because both are arithmetic an operator reads back;
--   * `committed_at` is present exactly when the job is `COMMITTED`, and
--     `failed_at` exactly when it is `FAILED` — the durable result of a commit is
--     dated, so "when did this import run" is answerable from the row itself;
--   * a row outcome dies with its job (CASCADE), while the job's tenant and its
--     uploader refuse deletion (RESTRICT): history is not removable, and a
--     verdict without its import is meaningless.

-- CreateEnum
CREATE TYPE "import_entity" AS ENUM ('CUSTOMER', 'PATIENT');

-- CreateEnum
CREATE TYPE "import_job_state" AS ENUM ('UPLOADED', 'PREVIEWING', 'PREVIEWED', 'COMMITTING', 'COMMITTED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "import_row_status" AS ENUM ('CREATE', 'FAILED');

-- CreateTable
CREATE TABLE "import_job" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "entity" "import_entity" NOT NULL,
    "state" "import_job_state" NOT NULL DEFAULT 'UPLOADED',
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "created_by_membership_id" UUID NOT NULL,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "suspected_duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "previewed_at" TIMESTAMPTZ(3),
    "committed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "artefact_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "artefact_deleted_at" TIMESTAMPTZ(3),
    "failure_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id"),

    -- Counters an operator reads back, so they are arithmetic and never negative:
    -- a negative created or failed count is a bug rendered as a summary.
    CONSTRAINT "import_job_counters_non_negative"
      CHECK ("created_count" >= 0 AND "failed_count" >= 0 AND "suspected_duplicate_count" >= 0),

    -- The durable result of a commit is DATED: a `COMMITTED` job always knows when
    -- it committed, and a job that is not `COMMITTED` cannot claim it did.
    CONSTRAINT "import_job_committed_at_check"
      CHECK (("state" = 'COMMITTED') = ("committed_at" IS NOT NULL)),

    -- Same biconditional for the failure instant: `FAILED` is dated, and nothing
    -- else may carry a failure instant. `EXPIRED` is deliberately excluded — an
    -- expiry is a TTL event, and the row already carries its expiry deadline.
    CONSTRAINT "import_job_failed_at_check"
      CHECK (("state" = 'FAILED') = ("failed_at" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "import_row_outcome" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "import_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "status" "import_row_status" NOT NULL,
    "reason_code" TEXT,
    "message" VARCHAR(500),
    "suspected_duplicate" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_row_outcome_pkey" PRIMARY KEY ("id"),

    -- 1-based over DATA rows, header excluded, so an operator can open the file at
    -- exactly the row a failure names. Row 0 does not exist.
    CONSTRAINT "import_row_outcome_row_number_positive"
      CHECK ("row_number" >= 1)
);

-- CreateIndex
CREATE UNIQUE INDEX "import_job_tenant_id_id_key" ON "import_job"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "import_job_tenant_id_created_at_idx" ON "import_job"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_row_outcome_tenant_id_import_id_row_number_key" ON "import_row_outcome"("tenant_id", "import_id", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "import_row_outcome_tenant_id_id_key" ON "import_row_outcome"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_tenant_id_created_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "created_by_membership_id") REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "import_row_outcome" ADD CONSTRAINT "import_row_outcome_tenant_id_import_id_fkey" FOREIGN KEY ("tenant_id", "import_id") REFERENCES "import_job"("tenant_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

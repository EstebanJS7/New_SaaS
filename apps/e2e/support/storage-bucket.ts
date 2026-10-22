import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

/**
 * Object storage is part of the environment contract, and the lane is where that
 * contract is enforced ([[DEC-077]] / [[HARD-003]]).
 *
 * ## Why the lane has to create the bucket itself
 *
 * `packages/storage` wires the S3 driver only when `STORAGE_S3_BUCKET` is present
 * and otherwise falls back to a **per-process** in-memory driver. That fallback is
 * correct for unit tests and actively wrong for an asynchronous flow: the API
 * writes the uploaded artefact into its own memory, the worker boots in another
 * process, and the artefact is not there. That was [[TD-060]], and it is why the
 * import spec used to skip with the reason named.
 *
 * A bucket that exists but must be created by hand is the same problem one layer
 * down: the lane would fail for an environment reason with a product-shaped
 * symptom. So this runs in `globalSetup`, beside the migrate and seed steps it
 * resembles — everything that is not an HTTP server belongs there, because a
 * `webServer` entry needs a URL to poll and object storage has none.
 *
 * ## The rules
 *
 * - **No bucket configured ⇒ no-op, and say so.** A single-process run legitimately
 *   uses the in-memory driver; the import spec notices the same variable and skips
 *   with its reason. This function must not invent a requirement the lane did not
 *   ask for.
 * - **Configured but unreachable ⇒ throw.** The opposite failure is the dangerous
 *   one: a lane that silently fell back to memory would report green while proving
 *   the half it could reach, which is exactly the state [[TD-060]] recorded.
 * - **Already present ⇒ nothing to do.** The bucket outlives a run.
 */

export interface StorageBucketConfig {
  readonly bucket: string;
  readonly endpoint?: string;
  readonly region?: string;
}

/** Reads the same variables `StorageModule.resolveS3Config()` reads. */
export function readStorageBucketConfig(
  env: NodeJS.ProcessEnv = process.env
): StorageBucketConfig | undefined {
  const bucket = env.STORAGE_S3_BUCKET;
  if (bucket === undefined || bucket.length === 0) {
    return undefined;
  }
  return {
    bucket,
    ...(env.STORAGE_S3_ENDPOINT !== undefined && { endpoint: env.STORAGE_S3_ENDPOINT }),
    ...(env.STORAGE_S3_REGION !== undefined && { region: env.STORAGE_S3_REGION }),
  };
}

/** Builds the client the same way `S3StorageDriver` does, so the lane and the app agree. */
export function createBucketClient(config: StorageBucketConfig): S3Client {
  return new S3Client({
    region: config.region ?? "us-east-1",
    // Path-style is what MinIO serves against a bare host:port.
    ...(config.endpoint !== undefined ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });
}

export type EnsureBucketOutcome = "absent" | "created" | "existing";

/**
 * Ensures `bucket` exists, creating it when it does not.
 *
 * `HeadBucket` returning 404 (or `NotFound`) is the only "create" signal; every
 * other failure — bad credentials, wrong region, an endpoint that is not there —
 * propagates. Conflating them would turn a misconfiguration into "created the
 * bucket", which is the class of bug an environment check exists to prevent.
 */
export async function ensureBucket(client: S3Client, bucket: string): Promise<EnsureBucketOutcome> {
  if (await bucketExists(client, bucket)) {
    return "existing";
  }
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  return "created";
}

async function bucketExists(client: S3Client, bucket: string): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  if (error instanceof S3ServiceException) {
    return (
      error.$metadata.httpStatusCode === 404 ||
      error.name === "NotFound" ||
      error.name === "NoSuchBucket"
    );
  }
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
    ?.httpStatusCode;
  return status === 404;
}

/**
 * The `globalSetup` entry point: reports what it did, and fails loudly.
 *
 * It returns a description rather than logging so the caller decides how the lane
 * narrates its own setup.
 */
export async function ensureStorageBucket(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const config = readStorageBucketConfig(env);
  if (config === undefined) {
    return "object storage not configured (STORAGE_S3_BUCKET unset); the lane will use the per-process in-memory driver and the full import flow will skip";
  }

  try {
    const outcome = await ensureBucket(createBucketClient(config), config.bucket);
    return `object storage ready: bucket "${config.bucket}" ${outcome === "created" ? "created" : "already present"} at ${config.endpoint ?? "the default AWS endpoint"}`;
  } catch (error: unknown) {
    throw new Error(
      `STORAGE_S3_BUCKET is set to "${config.bucket}" but the bucket could not be reached or created at ` +
        `${config.endpoint ?? "the default AWS endpoint"}. The lane refuses to fall back to the ` +
        `per-process in-memory driver, because that would report green while the worker could not read ` +
        `what the API wrote (TD-060). Cause: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { expect } from "vitest";
import supertest from "supertest";
import { REQUEST_ID_HEADER } from "../../src/common/errors/request-id.js";

export interface CrossTenant404ProbeOptions {
  app: NestFastifyApplication;
  /** Cookie header of the PROBING tenant (the one that must NOT see through). */
  cookie: string;
  /** URL addressing a resource that does not exist at all. */
  nonexistentUrl: string;
  /** URL addressing an existing FOREIGN-tenant resource. */
  foreignUrl: string;
  /**
   * Foreign identifiers (uuids, slugs, emails...) that must appear NOWHERE in
   * either response body — the anti-leak fence.
   */
  forbiddenIdentifiers?: readonly string[];
}

/**
 * Reusable cross-tenant denial assertion (design D5, spec: tenancy-core /
 * Cross-tenant access returns 404 + Nonexistent versus foreign
 * indistinguishable).
 *
 * Proves over REAL HTTP that:
 * 1. both the foreign and the nonexistent reference return 404;
 * 2. both carry the NOT_FOUND envelope code;
 * 3. the raw response BODIES are byte-equivalent (`response.text` equality —
 *    not just shape equality);
 * 4. no foreign identifier leaks into any body.
 *
 * Byte-equivalence mechanics: each probe pins THE SAME valid inbound
 * `X-Request-Id` (design D7 adoption), so both envelopes carry one identical
 * requestId — otherwise per-request generated ids would make two otherwise
 * identical rejections differ textually. The echoed header is asserted too,
 * pinning the D7 echo contract while we are here.
 */
export async function expectCrossTenant404(options: CrossTenant404ProbeOptions): Promise<void> {
  const { app, cookie, nonexistentUrl, foreignUrl, forbiddenIdentifiers = [] } = options;

  // Printable ASCII ≤128 chars: passes resolveRequestId validation, so the
  // server adopts it instead of minting fresh ids per request.
  const sharedRequestId = randomUUID();
  const server = app.getHttpServer();

  const [nonexistentResponse, foreignResponse] = await Promise.all([
    supertest(server)
      .get(nonexistentUrl)
      .set("Cookie", cookie)
      .set(REQUEST_ID_HEADER, sharedRequestId),
    supertest(server).get(foreignUrl).set("Cookie", cookie).set(REQUEST_ID_HEADER, sharedRequestId),
  ]);

  expect(nonexistentResponse.status, "nonexistent reference must be masked as 404").toBe(404);
  expect(foreignResponse.status, "FOREIGN resource must be masked as 404, never 403").toBe(404);

  expect(nonexistentResponse.headers[REQUEST_ID_HEADER]).toBe(sharedRequestId);
  expect(foreignResponse.headers[REQUEST_ID_HEADER]).toBe(sharedRequestId);

  const nonexistentBody = nonexistentResponse.body as {
    error?: { code?: string };
  };
  const foreignBody = foreignResponse.body as { error?: { code?: string } };
  expect(nonexistentBody.error?.code).toBe("NOT_FOUND");
  expect(foreignBody.error?.code).toBe("NOT_FOUND");

  // Byte-equivalence: same status line AND identical raw payload text.
  expect(nonexistentResponse.text).toBe(foreignResponse.text);

  const serialized = `${nonexistentResponse.text}${foreignResponse.text}`;
  for (const identifier of forbiddenIdentifiers) {
    expect(serialized, `cross-tenant identifier leaked into a 404 body`).not.toContain(identifier);
  }
}

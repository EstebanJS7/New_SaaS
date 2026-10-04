import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import { buildTestPkcs12, TEST_PKCS12_PASSWORD } from "@newsaas/fiscal/testing";
import { bootTestApp, type BootedTestApp } from "../../../test/support/boot-test-app.js";
import { seedRbacActor, seedRoleWithKeys } from "../../../test/support/rbac-fixture.js";
import { FISCAL_PERMISSIONS } from "../fiscal.permissions.js";

const API = "/fiscal/signing-material";
const MAX_CONTAINER_BYTES = 65_536;
interface SigningDto {
  id: string;
  environment: string;
  status: string;
}
interface SigningList {
  items: SigningDto[];
}
interface ErrorBody {
  error: { code: string; message: string };
}
const dto = (response: { body: unknown }): SigningDto => response.body as SigningDto;
const listDto = (response: { body: unknown }): SigningList => response.body as SigningList;
const errorDto = (response: { body: unknown }): ErrorBody => response.body as ErrorBody;

describe("Fiscal signing material HTTP boundary", () => {
  let booted: BootedTestApp;
  let permitted: { cookie: string; tenantId: string };
  let foreign: { cookie: string; tenantId: string };
  let forbidden: { cookie: string; tenantId: string };
  let container: Buffer;

  beforeAll(async () => {
    booted = await bootTestApp();
    const seed = (label: string, allowed: boolean) => {
      const suffix = randomUUID().slice(0, 8);
      const tenant = booted.db.prisma.tenant.create({
        data: { slug: `signing-${label}-${suffix}`, name: label },
      });
      const role = seedRoleWithKeys(
        booted.db,
        `SIGNING_${label}_${suffix}`,
        label,
        allowed ? [FISCAL_PERMISSIONS.signingMaterialManage] : []
      );
      const actor = seedRbacActor(booted.db, {
        email: `signing-${label}-${suffix}@isolation.test`,
        tenantId: tenant.id,
        roleId: role.role.id,
      });
      const feature = booted.db.prisma.featureCode.create({ data: { code: "fiscal" } });
      booted.db.prisma.tenantEntitlement.create({
        data: { tenantId: tenant.id, featureCodeId: feature.id },
      });
      return { cookie: actor.cookie, tenantId: tenant.id };
    };
    permitted = seed("allowed", true);
    foreign = seed("foreign", true);
    forbidden = seed("forbidden", false);
    container = await buildTestPkcs12({ password: TEST_PKCS12_PASSWORD });
  });

  afterAll(async () => booted.close());

  const upload = (cookie: string, password = TEST_PKCS12_PASSWORD) =>
    supertest(booted.app.getHttpServer())
      .post(API)
      .set("Cookie", cookie)
      .field("password", password)
      .field("environment", "TEST")
      .attach("file", container, { filename: "signing.p12", contentType: "application/x-pkcs12" });

  it("uploads metadata only and lists it, without secret fields in serialized responses", async () => {
    const created = await upload(permitted.cookie).expect(201);
    const createdDto = dto(created);
    expect(createdDto.environment).toBe("TEST");
    expect(Object.keys(created.body as object).sort()).toEqual(
      [
        "id",
        "environment",
        "status",
        "certificateSubject",
        "certificateSerial",
        "certificateFingerprintSha256",
        "keyAlgorithm",
        "notBefore",
        "notAfter",
        "createdAt",
        "retiredAt",
      ].sort()
    );
    expect(created.text).not.toMatch(/PRIVATE KEY|certificatePem|credentialRef/i);
    const listed = await supertest(booted.app.getHttpServer())
      .get(API)
      .set("Cookie", permitted.cookie)
      .expect(200);
    expect(listDto(listed).items.map((item) => item.id)).toContain(createdDto.id);
    expect(listed.text).not.toMatch(/PRIVATE KEY|certificatePem|credentialRef/i);
  });

  it("rotates the active material and retires it exactly once", async () => {
    const first = dto(await upload(permitted.cookie).expect(201));
    const second = dto(await upload(permitted.cookie).expect(201));
    const list = await supertest(booted.app.getHttpServer())
      .get(API)
      .set("Cookie", permitted.cookie)
      .expect(200);
    const sameEnvironment = listDto(list).items.filter((item) => item.environment === "TEST");
    expect(sameEnvironment.filter((item) => item.status === "ACTIVE")).toHaveLength(1);
    expect(sameEnvironment.find((item) => item.id === first.id)?.status).toBe("RETIRED");
    const retired = await supertest(booted.app.getHttpServer())
      .post(`${API}/${second.id}/retire`)
      .set("Cookie", permitted.cookie)
      .send({ reason: "operator retirement" })
      .expect(200);
    expect(dto(retired).status).toBe("RETIRED");
    await supertest(booted.app.getHttpServer())
      .post(`${API}/${second.id}/retire`)
      .set("Cookie", permitted.cookie)
      .send({ reason: "again" })
      .expect(409);
  });

  it("masks unknown and foreign ids as 404 and rejects unauthorized callers", async () => {
    const own = dto(await upload(permitted.cookie).expect(201));
    const other = dto(await upload(foreign.cookie).expect(201));
    const urlFor = (id: string) => `${API}/${id}/retire`;
    await supertest(booted.app.getHttpServer())
      .post(urlFor(randomUUID()))
      .set("Cookie", permitted.cookie)
      .send({ reason: "test" })
      .expect(404);
    await supertest(booted.app.getHttpServer())
      .post(urlFor(other.id))
      .set("Cookie", permitted.cookie)
      .send({ reason: "test" })
      .expect(404);
    expect(own.id).not.toBe(other.id);
    const denied = await supertest(booted.app.getHttpServer())
      .get(API)
      .set("Cookie", forbidden.cookie)
      .expect(403);
    expect(errorDto(denied).error).toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps invalid passwords, missing fields, oversized files and malformed retire bodies", async () => {
    const wrongPassword = await upload(permitted.cookie, "wrong-password").expect(400);
    expect(errorDto(wrongPassword).error.message).toBe("The PKCS#12 password is incorrect.");
    await supertest(booted.app.getHttpServer())
      .post(`${API}/${randomUUID()}/retire`)
      .set("Cookie", permitted.cookie)
      .send({})
      .expect(400);
    await supertest(booted.app.getHttpServer())
      .post(API)
      .set("Cookie", permitted.cookie)
      .field("password", TEST_PKCS12_PASSWORD)
      .field("environment", "TEST")
      .expect(400);
    // Above the per-route cap, refused by the pipe's own check.
    const oversized = Buffer.alloc(MAX_CONTAINER_BYTES + 1);
    await supertest(booted.app.getHttpServer())
      .post(API)
      .set("Cookie", permitted.cookie)
      .field("password", TEST_PKCS12_PASSWORD)
      .field("environment", "TEST")
      .attach("file", oversized, { filename: "large.p12", contentType: "application/x-pkcs12" })
      .expect(413);
  });

  it("maps the global multipart ceiling to 413 rather than 500", async () => {
    // Above the global Fastify ceiling (2 MiB, the largest branding asset), so
    // @fastify/multipart itself raises FST_REQ_FILE_TOO_LARGE. This is the path
    // that a code-prefix check missed, turning a size refusal into a 500.
    const aboveGlobalCeiling = Buffer.alloc(2 * 1024 * 1024 + 1);

    const refused = await supertest(booted.app.getHttpServer())
      .post(API)
      .set("Cookie", permitted.cookie)
      .field("password", TEST_PKCS12_PASSWORD)
      .field("environment", "TEST")
      .attach("file", aboveGlobalCeiling, {
        filename: "huge.p12",
        contentType: "application/x-pkcs12",
      })
      .expect(413);

    // The status alone does not prove the pipe mapped it: an unmapped Fastify
    // 413 would also arrive as 413. The MESSAGE is what distinguishes the two
    // paths, because the pipe's own refusal carries the domain's wording while
    // a propagated framework error carries "request file too large".
    expect(errorDto(refused).error).toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: "Signing container exceeds the maximum allowed upload size.",
    });
  });
});

// Must load before any NestJS DI resolution so emitted design:paramtypes
// metadata exists; otherwise injected class tokens get auto-instantiated as
// fresh instances instead of resolving the global singleton.
import "reflect-metadata";
import { Injectable, Module } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrismaModule } from "./prisma.module.js";
import { PrismaService } from "./prisma.service.js";

/**
 * Consumer module that does NOT import PrismaModule — proves the module is
 * global and that injection yields the single shared instance (spec:
 * persistence / Client lifecycle / Single shared instance).
 */
@Injectable()
class ConsumerService {
  constructor(readonly prisma: PrismaService) {}
}

@Module({ providers: [ConsumerService] })
class ConsumerModule {}

describe("PrismaService lifecycle", () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    // Closing without ever connecting keeps $disconnect a harmless no-op.
    await moduleRef?.close();
  });

  async function createModule(): Promise<TestingModule> {
    return Test.createTestingModule({
      imports: [PrismaModule, ConsumerModule],
    }).compile();
  }

  it("exposes exactly one client instance across consumers", async () => {
    moduleRef = await createModule();

    const direct = moduleRef.get(PrismaService);
    const viaConsumer = moduleRef.get(ConsumerService).prisma;

    // Identity is the actual spec guarantee (single shared instance).
    expect(viaConsumer).toBe(direct);
    // Prisma 6 returns a Proxy from the generated constructor, so
    // `instanceof PrismaService` is false even for valid instances;
    // assert the client contract instead of the class chain.
    expect(typeof direct.$connect).toBe("function");
    expect(typeof direct.$disconnect).toBe("function");
  });

  it("connects during module initialization", async () => {
    moduleRef = await createModule();

    const service = moduleRef.get(PrismaService);
    const connect = vi.spyOn(service, "$connect").mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("disconnects on graceful application shutdown", async () => {
    moduleRef = await createModule();

    const service = moduleRef.get(PrismaService);
    const disconnect = vi.spyOn(service, "$disconnect").mockResolvedValue(undefined);

    await service.onApplicationShutdown("SIGTERM");

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

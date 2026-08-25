import { Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "./generated/index.js";

/**
 * Application-wide Prisma client.
 *
 * Exactly one instance exists per process: the class is provided globally by
 * {@link PrismaModule}, so every consumer injects the same client and shares a
 * single connection pool. Modules must never construct their own instances.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onApplicationShutdown(_signal?: string): Promise<void> {
    await this.$disconnect();
  }
}

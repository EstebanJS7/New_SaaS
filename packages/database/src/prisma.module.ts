import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

/**
 * Global database module.
 *
 * Registered once on the root `AppModule`; because it is `@Global`, every
 * module can inject {@link PrismaService} without re-importing this module.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

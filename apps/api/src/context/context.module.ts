import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { RequestContextMiddleware } from "./request-context.middleware.js";
import { RequestContextService } from "./request-context.service.js";

/**
 * Request-context plumbing (design D3): the ALS-entering middleware is
 * applied to every Nest route so guards and handlers always execute inside
 * the request scope. The service is exported for guard/controller injection
 * and for isolated unit testing.
 */
@Module({
  providers: [RequestContextService, RequestContextMiddleware],
  exports: [RequestContextService],
})
export class ContextModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}

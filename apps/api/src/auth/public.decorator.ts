import { SetMetadata } from "@nestjs/common";

/** Metadata key marking routes the global AuthGuard must skip (design D3). */
export const IS_PUBLIC_ROUTE_KEY = "ns:is-public-route";

/**
 * Opts a route (or whole controller) out of the global AuthGuard. Reserved
 * for genuinely anonymous surfaces: `/health*` and `/auth/login` (design D3).
 * Everything else defaults to authenticated.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_ROUTE_KEY, true);

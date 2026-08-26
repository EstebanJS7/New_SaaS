import { RequestMethod } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ModuleRef } from "@nestjs/core";
import { IS_PUBLIC_ROUTE_KEY } from "../auth/public.decorator.js";
import { REQUIRE_PERMISSIONS_KEY } from "./require-permissions.decorator.js";

/**
 * Dependency-free route inventory for the deny-by-default contract
 * (EPIC-02 design D1, task 1.6).
 *
 * ACCESSOR DECISION (task 1.1 spike, recorded per tasks.md): DI-container
 * traversal WINS over `printRoutes()` parsing.
 * - `printRoutes({ commonPrefix: false })` returns an ASCII glyph tree
 *   (`└──`, indentation nesting) with auto-added HEAD siblings — text parsing
 *   would silently mis-bucket routes if Fastify tweaks its rendering.
 * - find-my-way internals (`instance.routing`) expose no enumerable route
 *   table (`#routes` is a private field).
 * - Traversing `ModuleRef.container.getModules()` yields STRUCTURED
 *   {controller path, method path, HTTP method, SetMetadata keys} in one pass,
 *   dependency-free, and mirrors exactly what `Reflector.getAllAndOverride`
 *   reads at request time (handler-first, then class).
 *
 * Completeness guard lives in the consumer probe: it asserts a minimum
 * expected inventory so silent under-enumeration fails loudly.
 */

/** One registered controller route with its contract-relevant metadata. */
export interface RouteContractEntry {
  /** Normalized absolute pattern, leading slash, e.g. `/memberships/:id`. */
  readonly path: string;
  /** HTTP method name (GET/POST/PUT/PATCH/DELETE/…). */
  readonly method: string;
  /** `@Public` present (handler-level override beats class-level). */
  readonly isPublic: boolean;
  /**
   * `@RequirePermissions` payload — undefined when ABSENT (deny-by-default
   * violation for private routes), possibly an empty array
   * (authenticated-only declaration).
   */
  readonly permissions: readonly string[] | undefined;
}

/** Structural view of Nest's internal module token wrappers (no `any`). */
interface ControllerWrapper {
  readonly metatype?: object;
  readonly instance?: object;
}

interface NestModuleRecord {
  readonly controllers?: Map<string | symbol, ControllerWrapper>;
}

interface InternalContainer {
  getModules(): Map<string, NestModuleRecord>;
}

const PATH_METADATA_KEY = "path";
const METHOD_METADATA_KEY = "method";

function readStringMetadata(key: string, target: object): string | undefined {
  const value: unknown = Reflect.getMetadata(key, target);
  return typeof value === "string" ? value : undefined;
}

/**
 * Mirrors Reflector.getAllAndOverride for SetMetadata payloads: the handler's
 * own metadata wins over the controller-class metadata.
 */
function readOverrideMetadata<T>(
  key: string,
  handler: object,
  controllerClass: object
): T | undefined {
  const fromHandler: unknown = Reflect.getMetadata(key, handler);
  if (fromHandler !== undefined) {
    return fromHandler as T;
  }
  const fromClass: unknown = Reflect.getMetadata(key, controllerClass);
  return fromClass === undefined ? undefined : (fromClass as T);
}

function joinPaths(controllerPath: string | undefined, methodPath: string | undefined): string {
  const segments = [controllerPath ?? "", methodPath ?? ""]
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter((segment) => segment.length > 0);
  return `/${segments.join("/")}`;
}

function methodName(httpMethod: number | undefined): string {
  if (httpMethod !== undefined && RequestMethod[httpMethod] !== undefined) {
    return RequestMethod[httpMethod];
  }
  return "UNKNOWN";
}

/**
 * Enumerates every controller route registered in the booted application with
 * the metadata the PermissionGuard contract consumes. Requires `app.init()`
 * to have completed (the container must be fully compiled).
 */
export function enumerateRouteContracts(app: NestFastifyApplication): RouteContractEntry[] {
  const moduleRef = app.get(ModuleRef);
  // ModuleRef does not publish the container on its type; this narrow
  // structural projection is the documented internal seam (see decision note).
  const container = (moduleRef as unknown as { container?: InternalContainer }).container;
  if (!container) {
    throw new Error("route enumeration failed: DI container unavailable");
  }

  const entries: RouteContractEntry[] = [];
  for (const moduleRecord of container.getModules().values()) {
    for (const wrapper of (
      moduleRecord.controllers ?? new Map<string | symbol, ControllerWrapper>()
    ).values()) {
      const controllerClass = wrapper.metatype;
      const instance = wrapper.instance;
      if (!controllerClass || !instance) continue;

      const controllerPath = readStringMetadata(PATH_METADATA_KEY, controllerClass);
      const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const methodNameCandidate of Object.getOwnPropertyNames(prototype)) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, methodNameCandidate);
        // The non-generic descriptor overload types `value` as `any`; pin the
        // extraction to `unknown` so narrowing stays explicit.
        const handler: unknown = descriptor?.value;
        if (typeof handler !== "function") continue;

        const methodPath = readStringMetadata(PATH_METADATA_KEY, handler);
        // Reflect.getMetadata is typed `any`; pin the reading point to `unknown`
        // so narrowing happens explicitly instead of leaking `any` downstream.
        const httpMethod: unknown = Reflect.getMetadata(METHOD_METADATA_KEY, handler);
        if (methodPath === undefined || typeof httpMethod !== "number") continue;

        entries.push({
          path: joinPaths(controllerPath, methodPath),
          method: methodName(httpMethod),
          isPublic:
            readOverrideMetadata<boolean>(IS_PUBLIC_ROUTE_KEY, handler, controllerClass) === true,
          permissions: readOverrideMetadata<readonly string[]>(
            REQUIRE_PERMISSIONS_KEY,
            handler,
            controllerClass
          ),
        });
      }
    }
  }
  return entries;
}

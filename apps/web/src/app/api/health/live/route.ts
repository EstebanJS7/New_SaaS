import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface ApiHealthResponse {
  status: string;
  service: string;
  timestamp: string;
}

/**
 * Web health route that proxies to the API liveness endpoint.
 *
 * Keeping the proxy inside the web app makes `/api/health/live` reachable from
 * the browser without opening a broad CORS policy on the API for a development
 * concern. If the API is unreachable the route returns 503 with a safe payload.
 */
export async function GET(): Promise<NextResponse> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const response = await fetch(`${apiUrl}/health/live`, {
      cache: "no-store",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json({ status: "unavailable", service: "api" }, { status: 503 });
    }

    const data = (await response.json()) as ApiHealthResponse;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ status: "unavailable", service: "api" }, { status: 503 });
  }
}

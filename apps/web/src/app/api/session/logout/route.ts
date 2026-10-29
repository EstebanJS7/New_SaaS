import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_SESSION_COOKIE } from "@/lib/session-cookie";

/** Private BFF: the public, credential-less auth proxy deliberately refuses logout. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Request origin is not allowed." } },
      { status: 403 }
    );
  }
  const session = (await cookies()).get(STAFF_SESSION_COOKIE);
  try {
    if (session) {
      const upstream = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/auth/logout`,
        {
          method: "POST",
          headers: { cookie: `${STAFF_SESSION_COOKIE}=${encodeURIComponent(session.value)}` },
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!upstream.ok && upstream.status !== 401) throw new Error("Session revocation failed");
    }
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(STAFF_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Could not confirm sign out. Please try again." } },
      { status: 503 }
    );
  }
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);

  // Outer gate: unauthenticated hitting protected surfaces -> 401 / redirect
  const path = request.nextUrl.pathname;
  if (!user) {
    // System endpoints carry no user session — they self-authenticate via a
    // bearer secret (cron routes via CRON_SECRET; the QB catalogue feed via
    // QB_FEED_SECRET). Let them through so the route's own guard runs.
    if (path.startsWith("/api/cron/") || path === "/api/qb/catalog") {
      return response;
    }
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (path.startsWith("/shop/")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/shop/:path*", "/api/:path*"],
};

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // CRITICAL: nothing between createServerClient and getUser() (Pitfall 2)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Inject identity headers for API route handlers (Pattern 2). Header injection,
  // NOT AsyncLocalStorage — ALS does not cross the Edge->Node boundary.
  if (user) {
    const slug =
      request.headers.get("x-tenant-slug") ?? // client-sent (preferred)
      request.nextUrl.pathname.split("/")[2] ?? // /shop/[slug]/... fallback
      "";
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id", user.id);
    if (slug) requestHeaders.set("x-tenant-slug", slug);

    // Regenerate the response with the augmented request headers, then re-copy
    // any auth cookies the refresh set onto the new response (keep one canonical
    // response — Code Example 3 planner note).
    const augmented = NextResponse.next({ request: { headers: requestHeaders } });
    response.cookies.getAll().forEach((cookie) => augmented.cookies.set(cookie));
    response = augmented;
  }

  return { response, user };
}

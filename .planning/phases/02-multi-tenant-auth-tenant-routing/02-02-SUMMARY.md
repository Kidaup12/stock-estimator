# Plan 02-02 Summary — Supabase Auth Wiring

status: complete-code-verified (human magic-link round-trip pending)
plan: 02-02
phase: 02-multi-tenant-auth-tenant-routing
requirements: [AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05]
completed: 2026-05-30

## What was built

Supabase Auth via `@supabase/ssr@0.10.3` + `@supabase/supabase-js@2.106.2`, end to end:

- **`lib/supabase/client.ts`** — browser client (`createBrowserClient`) for the `"use client"` login page.
- **`lib/supabase/server.ts`** — server client; `await cookies()` (Next 16 async); `setAll` wrapped in try/catch so RSC cookie writes don't throw (Pitfall 3).
- **`lib/supabase/middleware.ts`** — `updateSession()` minimal shape: create client → `getUser()` (nothing between them, Pitfall 2) → returns `{ response, user }`. Header-injection (`x-tenant-slug`/`x-user-id`) intentionally deferred to Plan 03 (later wave, same file — no shared-file race).
- **`middleware.ts`** (repo root) — calls `updateSession`, then the outer gate: unauthenticated `/api/*` → `401 {"error":"Unauthorized"}` (AUTH-05); unauthenticated `/shop/*` → redirect `/login`. `matcher: ["/shop/:path*", "/api/:path*"]` (so `/login`, `/auth/*`, `/`, `/contact`, `/pricing` stay public).
- **`app/login/page.tsx`** — branded client page (uses globals.css tokens/`card`/`btn-*`). `signInWithOtp` (magic link, AUTH-01) + `signInWithOAuth` google (AUTH-02), both `emailRedirectTo/redirectTo = origin + /auth/callback`. Suspense-wrapped (`useSearchParams` needs a boundary for `next build`). Shows "check your email" state + `?error=auth` banner.
- **`app/auth/callback/route.ts`** — GET `exchangeCodeForSession(code)` → redirect `next ?? "/"`, else `/login?error=auth`.
- **`app/auth/signout/route.ts`** — POST `signOut()` → 303 redirect `/login` (AUTH-04). The header sign-out button ships with the app shell in Plan 03.

## Verified (code + runtime)

- `npx tsc --noEmit` exits 0 (login page now included — un-excluded from tsconfig).
- Live on localhost:3082 after restart with real keys:
  - `GET /api/forecast` unauthenticated → `{"error":"Unauthorized"}` HTTP **401** (AUTH-05 ✓).
  - `GET /login` → 200, renders "Send magic link" + "Continue with Google" + brand, no client Supabase-init error.

## Deviations / fixes

- **Un-excluded `app/login`** from `.gitignore` AND `tsconfig.json` — it was a legacy scratch exclusion; Phase 2 makes it a real route (also means tsc now typechecks it).
- **Supplied `slug` on the two `tenant.create` sites** (`app/api/shop/route.ts`, `scripts/seed-from-beautysquare.ts`) — 02-01 made `Tenant.slug` required but left these callers, breaking tsc. Fixed with `slugify(name)` (committed under Task 1). Minor scope spillover, but required to keep the build green.
- **`.env` populated** with real `NEXT_PUBLIC_SUPABASE_URL` (`https://lkkljxvuhkaydhffpaix.supabase.co`), anon key, and service_role key (Roy provided; `.env` is gitignored — secrets stay local).
- **Dev server restarted twice** — a brand-new `middleware.ts` doesn't hot-load into a running Turbopack server, and new env vars need a fresh process. Restart resolved both.

## Pending human verification (tracked — Task 3 checkpoint)

These cannot be done by code and gate downstream work:

1. **Supabase Dashboard → Authentication → URL Configuration:** add `http://localhost:3082/auth/callback` to the redirect allow-list (else the magic link fails).
2. **Magic-link round trip:** visit `/login`, request a link, click it, confirm landing authenticated and that the session survives a browser refresh (AUTH-01/03).
3. **Roy's Supabase user UUID** (created by step 2's first sign-up) is required by **Plan 05's backfill** to bind an OWNER `Membership` to Beauty Square. Plan 05 cannot complete until Roy has signed up once.
4. Google OAuth provider config deferred — Roy chose magic-link-only for this pass (the Google button stays in the UI).

## Self-Check: PASSED

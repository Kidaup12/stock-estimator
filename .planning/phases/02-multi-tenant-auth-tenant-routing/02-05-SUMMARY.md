# Plan 02-05 Summary — Backfill + onboarding + root redirect

status: complete-verified
plan: 02-05
phase: 02-multi-tenant-auth-tenant-routing
requirements: [AUTH-03, TNT-04, TNT-01]
completed: 2026-05-30

## What was built

- **`scripts/backfill-tenant-membership.ts`**: idempotent one-shot that binds an OWNER `Membership` for an env-provided `OWNER_USER_ID` (Supabase UUID) to an existing tenant (default slug `beauty-square`). Guides the user through the 2-step flow if the UUID is missing (research Open Q1).
- **`app/api/onboarding/route.ts`** + **`app/onboarding/page.tsx`**: a new authenticated user with no membership creates a `Tenant` + OWNER `Membership` (D-14). Slug-collision handled (suffix). The route's `prisma.tenant.findUnique({ where: { slug } })` is the sanctioned pre-membership creation-path lookup, allow-listed in 02-06's ESLint rule (W2).
- **`app/page.tsx`**: membership-aware root redirect (D-09) — unauth → `/login`, 0 memberships → `/onboarding`, ≥1 → `/shop/[slug]/dashboard`.
- **`.env.example`**: `OWNER_USER_ID` + `OWNER_TENANT_SLUG`.

## Verified (incl. the live human checkpoint — Task 4)

- `npx tsc --noEmit` → 0 source errors.
- **Live end-to-end** on Roy's real Supabase login:
  - Magic-link sign-in worked; with no membership, root redirect correctly sent Roy to `/onboarding` (proving the 0-membership branch).
  - Backfill ran (`OWNER_USER_ID=9ea9b137-…a7c2`) → bound OWNER membership to `beauty-square` (1,023 products). Roy's dashboard now renders the existing dataset at `/shop/beauty-square/dashboard` — **no re-seed** (the non-negotiable migration UX).
  - Cross-tenant gate confirmed live: `/shop/beauty-square/dashboard` returns 307→/login without a valid session.

## Notes / cleanup

- During verification Roy onboarded a duplicate empty tenant (`beauty-square-ke`, 0 products) before the backfill bound him to the real one — expected behavior of the 0-membership path. The empty duplicate was deleted (guarded delete: aborts if any products), leaving Roy with a single membership so root `/` cleanly routes to his data.
- **Operational learning**: the Supabase free-tier session pooler (port 5432) has a low connection cap; the running `npm run dev` server holds slots and can starve `tsx` scripts (`Can't reach database server`). Fix: stop the dev server before running DB scripts, or run them when the server is idle. (Not a network fault — TCP to the pooler stays open.)

## Self-Check: PASSED

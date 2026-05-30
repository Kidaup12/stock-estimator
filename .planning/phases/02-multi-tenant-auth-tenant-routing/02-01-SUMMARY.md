---
phase: 02-multi-tenant-auth-tenant-routing
plan: 01
subsystem: schema
tags: [prisma, multi-tenant, membership, slug, timezone, migration, tnt-04, tnt-08]
status: complete-verified
dependencies:
  requires:
    - "Phase 1 Postgres migration (postgresql provider, DATABASE_URL + DIRECT_URL via Supabase Session Pooler)"
    - "Existing Tenant model + the live Beauty Square row (1,023 products) on Supabase eu-central-1"
  provides:
    - "Tenant.slug (String @unique, NOT NULL) — the /shop/[slug]/ URL key (D-07)"
    - "Tenant.timezone (String, default Africa/Nairobi) — per-tenant determinism seed input (D-19)"
    - "Membership model (userId String, tenantId, role Role, @@unique([userId,tenantId]), @@index([tenantId]), Cascade from Tenant)"
    - "Role enum (OWNER | MEMBER)"
    - "lib/tenant/slug.ts exporting slugify(name)"
    - "Regenerated @prisma/client exposing prisma.membership + Role"
  affects:
    - "02-02..02-06 — every Phase 2 plan compiles against these schema types (requireTenant resolves Tenant by slug + checks Membership)"
    - "Plan 05 onboarding + scripts/backfill-tenant-membership.ts — consume slugify() and create the OWNER Membership"
    - "Plan (D-19) tenant-tz date bucketing — reads Tenant.timezone"
tech-stack:
  added:
    - "No new npm dependencies (slugify is a 5-line no-dep regex per research)"
  patterns:
    - "Two-step backward-compatible migration: add nullable @unique -> backfill SQL -> ALTER SET NOT NULL"
    - "Supabase auth.users referenced as a plain String userId — NO cross-schema Prisma FK (D-13, Pitfall 4)"
    - "Idempotent data-backfill migration keyed on a stable business key (shopifyDomain) guarded by IS NULL"
key-files:
  created:
    - "lib/tenant/slug.ts (24 lines — pure slugify(name): lowercase + NFKD + collapse non-alnum to hyphens + trim edges)"
    - "prisma/migrations/20260530003500_add_membership_slug_timezone/migration.sql (Role enum, nullable unique slug, timezone default, Membership table + FK + indexes)"
    - "prisma/migrations/20260530003600_backfill_beauty_square_slug/migration.sql (UPDATE Tenant SET slug='beauty-square' WHERE shopifyDomain='beautysquareke.co' AND slug IS NULL)"
    - "prisma/migrations/20260530003700_require_slug_not_null/migration.sql (ALTER Tenant ALTER COLUMN slug SET NOT NULL)"
    - "prisma/migrations/migration_lock.toml (provider=postgresql — was untracked, now committed)"
  modified:
    - "prisma/schema.prisma (Tenant.slug nullable->NOT NULL final state; Membership model + Role enum + memberships back-ref added in Task 1)"
key-decisions:
  - "Reconciled a partial prior session: Task 1 was already committed (58d3e7d) with slug String? @unique; the 3 migration dirs + final schema edit existed uncommitted on disk and were already applied to the live DB. Verified each against the live DB rather than re-running, then committed Task 2 as dcafad3."
  - "Left tsconfig.json (jsx: preserve -> react-jsx) and an unrelated 01-RESEARCH.md UNSTAGED — out of scope for this plan (scope-boundary rule); not introduced by this plan's tasks."
  - "prisma generate hit a Windows EPERM on the query-engine DLL rename (the live dev server on :3082 holds the lock). The TS/JS client WAS regenerated fresh at 04:59 (index.d.ts contains Membership + timezone + OWNER/MEMBER); the engine binary is byte-identical/unchanged, so runtime works — proven by a live prisma.membership.count() call. Did NOT kill the live dev server. Cleaned the stale .tmp engine copies."
patterns-established:
  - "Non-destructive multi-step Prisma migration against a live shared dev DB: never add a NOT-NULL unique column in one shot when existing rows lack it."
  - "Supabase user binding via plain-String userId (no FK into the auth schema) — keeps Prisma confined to the public schema."
requirements-completed: [TNT-04, TNT-08]
metrics:
  duration: ~14 min (reconcile prior partial state + verify-live + Task 2 commit + Task 3 + summary)
  completed: 2026-05-30
  tasks_total: 3
  tasks_complete_autonomous: 3
  files_created: 5
  files_modified: 1
  commits: 3   # 58d3e7d (Task 1, prior session) + dcafad3 (Task 2) + c3ae681 (Task 3)
---

# Phase 2 Plan 01: Tenant Schema Foundation (slug + timezone + Membership + Role) Summary

Added the schema foundation every other Phase 2 plan depends on — `Tenant.slug` (unique URL key), `Tenant.timezone` (default `Africa/Nairobi`), a `Membership` table binding Supabase user UUIDs to tenants with an `OWNER | MEMBER` role, and a no-dep `slugify()` helper — shipped via a two-step backward-compatible migration that preserved Beauty Square's live 1,023-product dataset.

## What Shipped

- **`Tenant.slug String @unique` (NOT NULL)** — the `/shop/[slug]/` URL segment (D-07). Backfilled to `beauty-square` for the existing tenant.
- **`Tenant.timezone String @default("Africa/Nairobi")`** — IANA tz, the per-tenant determinism seed input (D-19). Default backfilled the existing row.
- **`Membership` model** — `id`, `userId String` (Supabase `auth.users` UUID, plain String, NO FK per D-13), `tenantId`, `role Role @default(OWNER)`, `createdAt`; `@@unique([userId, tenantId])`, `@@index([tenantId])`, `onDelete: Cascade` from Tenant.
- **`Role` enum** — `OWNER | MEMBER`.
- **`lib/tenant/slug.ts`** — `export function slugify(name)`, pure and dependency-free.
- **Regenerated `@prisma/client`** — exposes `prisma.membership` and the `Role` enum.

## Migration Strategy (executed as designed)

Three stacked migrations, applied cleanly to the live Supabase Postgres dev DB:

1. `add_membership_slug_timezone` — Role enum, **nullable** unique `slug`, `timezone` (default backfills existing row), `Membership` table + FK + indexes.
2. `backfill_beauty_square_slug` — `UPDATE "Tenant" SET "slug" = 'beauty-square' WHERE "shopifyDomain" = 'beautysquareke.co' AND "slug" IS NULL` (idempotent).
3. `require_slug_not_null` — `ALTER ... SET NOT NULL` (succeeds because every row now has a slug).

The nullable->backfill->not-null ordering is exactly why the existing 1,023-product row never violated the `@unique`/NOT-NULL constraint mid-migration.

## Verification (live DB)

- `npx prisma validate` — schema valid.
- `npx prisma migrate status` — "Database schema is up to date" (5 migrations, no pending).
- Live query: tenant = `{name: "Beauty Square KE", slug: "beauty-square", timezone: "Africa/Nairobi", shopifyDomain: "beautysquareke.co"}`.
- **Product count = 1023** — Beauty Square dataset intact (primary success criterion).
- `prisma.membership.count()` = 0 (expected — owner Membership ships in Plan 05); delegate present at runtime.
- `slugify('Beauty Square KE!')` -> `beauty-square-ke`; `slugify('  Hello--World  ')` -> `hello-world`.
- Final schema line: `slug String @unique` (no `?`).

## Deviations from Plan

### State reconciliation (not a code deviation)
A prior session had already committed Task 1 (`58d3e7d`) and created Task 2's migration files + final schema edit on disk (uncommitted), with all three migrations already applied to the live DB. Rather than re-running migrations against the live 1,023-product DB (risk), each acceptance criterion was verified against the live DB and the work was committed as-is (`dcafad3`).

### [Rule 3 - Blocking] prisma generate EPERM on Windows
`npx prisma generate` failed with `EPERM: ... rename query_engine-windows.dll.node` because the live dev server (localhost:3082) holds the engine DLL. Investigated: the TS/JS client *was* regenerated fresh (its `index.d.ts` contains `Membership`, `timezone`, `OWNER`/`MEMBER`); only the engine-binary rename failed, and the existing engine is the same unchanged Prisma 6 version. Confirmed runtime works via a live `prisma.membership.count()`. Did **not** kill the live dev server (execution context flags it as live/important). Removed the stale `.tmp` engine copies. No commit impact.

### Out-of-scope, intentionally not committed
`tsconfig.json` (`jsx: preserve` -> `react-jsx`) and `.planning/phases/01-boot-determinism-cleanup/01-RESEARCH.md` were present in the working tree but are unrelated to this plan's tasks — left unstaged per the scope-boundary rule.

## Known Stubs

None. `Membership` having 0 rows is by design — the owner-Membership backfill is explicitly Plan 05's job (D-15), not a stub.

## Commits

- `58d3e7d` feat(02-01): add Tenant.slug/timezone, Membership model + Role enum (Task 1, prior session)
- `dcafad3` feat(02-01): apply two-step slug migration + require slug not-null (Task 2)
- `c3ae681` feat(02-01): add slugify() tenant slug helper (Task 3)

## Handoff Notes for Plans 02-06

- `requireTenant()` (Plan 02/03) resolves `prisma.tenant.findUnique({ where: { slug } })` then `prisma.membership.findUnique({ where: { userId_tenantId: { userId, tenantId } } })`.
- The OWNER Membership for Beauty Square does **not** exist yet — Plan 05's `scripts/backfill-tenant-membership.ts` creates it after the owner signs up via the new `/login` (2-step, env-configurable `BACKFILL_OWNER_EMAIL`/`_USER_ID`).
- `slugify` is a named export: `import { slugify } from "@/lib/tenant/slug"`.
- Tenant.timezone is now available for the D-19 tenant-tz date helper (`tenantDayKey`).

## Self-Check: PASSED

All 5 created files exist on disk; all 3 commits (58d3e7d, dcafad3, c3ae681) present in git history.

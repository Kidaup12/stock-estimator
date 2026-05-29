# Phase 2: Multi-Tenant Auth & Tenant Routing — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-30
**Phase:** 02-multi-tenant-auth-tenant-routing
**Mode:** auto (`--auto`) — recommended option auto-selected per gray area
**Areas discussed:** Auth surface & sessions, Tenant routing migration, requireTenant() chokepoint, Membership & roles, Tenant onboarding/backfill, Isolation enforcement, Tenant timezone

---

## Auth Surface & Sessions (AUTH-01..05)

| Option | Description | Selected |
|--------|-------------|----------|
| Supabase Auth via `@supabase/ssr`, custom login page, cookie/httpOnly sessions | SOW-mandated provider; server-first; XSS-safe sessions; branded UI | ✓ |
| Supabase hosted Auth UI | Faster to wire, but off-brand and less control | |
| localStorage-based session | Simpler client, but XSS-exposed and not server-readable | |

**Auto-selected:** `@supabase/ssr` + custom `/login` + cookie sessions (D-01..D-06).
**Notes:** Magic link primary + Google OAuth optional are SOW-locked, not a real choice. `middleware.ts` refreshes the session cookie; `auth/callback` exchanges code for session.

---

## Tenant Routing Migration (TNT-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Path-based `/shop/[slug]/`, move app pages, marketing stays at root | ~2h middleware; Next team's recommended v1 approach | ✓ |
| Subdomain `acme.wezesha.app` | Slick but +1d + DNS; deferred to v2 (V2-08) | |

**Auto-selected:** Path-based; `Tenant.slug` unique; root redirects to user's tenant; cross-tenant slug → 403 (D-07..D-09).

---

## requireTenant() Chokepoint (TNT-02, TNT-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Single `requireTenant()` at `lib/auth/context.ts`; webhooks separate resolver | Research-recommended chokepoint; one sanctioned path | ✓ |
| Per-route inline session+tenant checks | Re-introduces drift the phase exists to remove | |

**Auto-selected:** `requireTenant()` chokepoint resolving session + Membership + active slug; separate webhook domain/realmId resolver (D-10, D-11). Header-injection mechanism left to Claude's discretion within the locked contract.

---

## Membership & Roles (TNT-04)

| Option | Description | Selected |
|--------|-------------|----------|
| `Membership{userId,tenantId,role OWNER\|MEMBER}`, Supabase UUID as String, no FK into auth schema | Clean Prisma migrations; standard Supabase pattern | ✓ |
| Prisma FK into Supabase `auth.users` | Cross-schema coupling Prisma doesn't manage | |

**Auto-selected:** D-12, D-13. First signup creates tenant + OWNER (D-14).

---

## Tenant Onboarding & Backfill

| Option | Description | Selected |
|--------|-------------|----------|
| Self-serve: new user creates a tenant (OWNER); backfill existing Beauty Square tenant a slug + membership | Satisfies success criterion #1; keeps Phase 1 demo alive | ✓ |
| Invite-only onboarding | Adds invite flow not required by success criteria | |

**Auto-selected:** Self-serve owner signup (D-14) + `scripts/backfill-tenant-membership.ts` (D-15). Member-invite UI deferred.

---

## Isolation Enforcement (TNT-05, TNT-06, TNT-07)

| Option | Description | Selected |
|--------|-------------|----------|
| ESLint rule (required, CI) + 2-tenant vitest test + `lib/cache/tenant-cache.ts`; Prisma extension optional | Matches success criterion #4 + research; lint is the locked deliverable | ✓ |
| Prisma extension only | Harder to enforce in CI; success criterion names the ESLint rule | |

**Auto-selected:** D-16, D-17, D-18. 2-tenant test is the honest acceptance proof.

---

## Tenant Timezone (TNT-08)

| Option | Description | Selected |
|--------|-------------|----------|
| `Tenant.timezone @default("Africa/Nairobi")`, tz-aware date bucketing helper | IANA tz; respects Phase 1 determinism seed key recomputed in tenant tz | ✓ |

**Auto-selected:** D-19. Library (`Intl` vs `date-fns-tz`) = Claude's discretion.

---

## Claude's Discretion

- middleware header-injection mechanism for API tenant resolution
- Prisma extension on top of the required ESLint rule
- Test file location (colocated vs `tests/`)
- Timezone library choice
- Tenant-picker UI for multi-membership users
- Supabase client version pinning (resolve at phase start)

## Deferred Ideas

- Member-invitation flow (schema ships; UI deferred)
- Subdomain routing (v2 / V2-08)
- Token-encryption spike (Phase 3 — no tokens stored yet)
- Supabase RLS as a second isolation layer (not leaned on in v1)

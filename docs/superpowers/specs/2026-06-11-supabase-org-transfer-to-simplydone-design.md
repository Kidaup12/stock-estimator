# Supabase Org Transfer → SimplyDone — Runbook / Design

**Date:** 2026-06-11
**Goal:** Move the live Wezesha Restock OS Supabase project off Roy's personal Google account onto the SimplyDone organization, with zero data migration and effectively no downtime.

## Decision

Use Supabase's built-in **in-place project Transfer** (org → org), NOT a fresh-project data migration.

**Rationale:** The project ref `lkkljxvuhkaydhffpaix` stays identical through a transfer. That means every connection string, API key, `auth.users` UUID, AES-encrypted Shopify token, and auth redirect URL remains valid. Nothing in the codebase, Vercel env (15 vars), n8n reconcile cron credential (`3BZMhSoYipMLstT1`), or local `.env` needs to change. Only the owning/billing organization moves. The `sb_secret_` keys generated under SimplyDone become unnecessary and are discarded.

## Current state (source)

- **Project:** `lkkljxvuhkaydhffpaix` ("wezesha-dev"), region eu-central-1 (Frankfurt), Free tier, under Roy's **personal** Google Supabase login.
- **Roles it serves:** (1) Postgres DB via Prisma — 12 migrations + live Beauty Square data (~1,390 products, ~3,000 sales rows, predictions, orders, snapshots, 186 suppliers, tenants, memberships, AES-256-GCM-encrypted Shopify tokens); (2) Auth — magic-link/OTP users (Roy = OWNER, `simplydoneafrica@gmail.com` = test owner). `Membership.userId` references `auth.users.id`, so those UUIDs must not change — which transfer guarantees.
- **Consumers:** local `.env`, Vercel prod (`wezesha-restock-os.vercel.app`), n8n cron (`beautysquare.up.railway.app` WF `3BZMhSoYipMLstT1`), Supabase Auth redirect/SMTP/OTP-template config.

## Destination

- A **separate** SimplyDone Google account / Supabase login (different org from the personal account).
- Target plan: **Free tier**. Transfer requires the SimplyDone org to have an open free-project slot (free orgs cap at 2 active projects).

## Prerequisite — bridge cross-org membership

Supabase only lets you transfer a project to an organization the **currently-logged-in user is an Owner of**. Because source and destination are different logins, the source login must first be made an Owner of the SimplyDone org:

1. Log into the **SimplyDone** account → Organization → **Team / Members** → invite the **personal-account email** (the one that owns `lkkljxvuhkaydhffpaix`) with role **Owner**.
2. Accept the invite from the personal account's inbox / Supabase dashboard.
3. The personal login is now a member of both orgs → it can select SimplyDone as a transfer target.

## Runbook (execution order)

| # | Step | Owner | Notes |
|---|------|-------|-------|
| 1 | **Pre-flight eligibility** | Roy (dashboard) | Confirm source project plan = Free; confirm SimplyDone org has a free slot open. The Transfer screen states eligibility explicitly. |
| 2 | **Bridge membership** | Roy (dashboard) | Invite personal email → Owner of SimplyDone org; accept. (Prerequisite section above.) |
| 3 | **Safety backup** | Claude | `pg_dump` of prod DB via `DIRECT_URL` in `.env` → timestamped local file. Pure rollback insurance; transfer is non-destructive. |
| 4 | **Execute transfer** | Roy (dashboard) | Source project → **Settings → General → Transfer project** → select SimplyDone org → confirm. |
| 5 | **Verify** | Claude | Smoke `wezesha-restock-os.vercel.app`: root→/login (307/200), DB reachable, one cron `?mode=sync` run. Nothing re-points, so should be seamless. |
| 6 | **Billing + security cleanup** | Roy | Confirm SimplyDone org plan; change the SimplyDone password (`[REDACTED — change this password]` was shared in chat); enable 2FA; rotate the pasted `sb_secret_` key if that project is kept anywhere. |

Claude will not drive the Google-OAuth dashboard login (credentials + 2FA), so steps 1, 2, 4, 6 are Roy's clicks with precise step-by-step guidance. Claude owns 3 and 5.

## Verification / success criteria

- Transfer screen shows project now under the SimplyDone org.
- `wezesha-restock-os.vercel.app` root returns 307→/login then 200, with no env changes.
- A manual cron `?mode=sync` returns 200 (DB read/write intact).
- A magic-link OTP login still succeeds for an existing user (auth users preserved).

## Fallback — Plan B (fresh-project data migration)

Only if Supabase refuses the transfer (plan/quota mismatch it won't allow):

1. Create a new empty project under the SimplyDone org (note new ref + new keys).
2. `pg_dump` schema + data from source; restore into destination. Keep the **same** `TOKEN_ENCRYPTION_KEY` app-side so encrypted Shopify tokens stay decryptable.
3. Raw-SQL copy `auth.users` + `auth.identities` to **preserve user UUIDs** (Membership FKs depend on them) — admin API can't set UUIDs, so this must be SQL-level.
4. Re-point env in all four consumers (`.env`, Vercel, n8n credential, sidecar if any) to the new ref/keys, including `NEXT_PUBLIC_SUPABASE_URL`, anon/publishable key, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DIRECT_URL`.
5. Re-add auth redirect/site URLs + re-create the OTP email template (`{{.Token}}`) + SMTP on the new project.
6. Smoke-test as in step 5 above, then decommission the old project.

## Security notes (this session)

- Two identical keys were pasted in chat (`[REDACTED — rotate in Supabase dashboard]`) — one was meant to be a different key. Moot under transfer (keys unchanged); rotate anyway if the SimplyDone-created project is retained.
- SimplyDone password `[REDACTED — change this password]` was shared in chat → change it post-migration; enable 2FA on both Supabase accounts.

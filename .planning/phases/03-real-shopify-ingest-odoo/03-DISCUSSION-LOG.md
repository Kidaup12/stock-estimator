# Phase 3: Real Shopify Ingest + Odoo — Discussion Log

> **Audit trail only.** Decisions are captured in CONTEXT.md.

**Date:** 2026-05-30
**Mode:** auto (`--auto`) — recommended/SOW-canonical option auto-selected per area
**Areas:** App type & auth, Admin API, token encryption, schema, ingest strategy, local dev/webhooks, synthetic→real transition, Odoo scope

---

## Shopify app type & auth (SHOP-01/02)
| Option | Selected |
|--------|----------|
| Public OAuth app (Partner dashboard) + `@shopify/shopify-api` v11, offline tokens, GraphQL | ✓ (SOW-mandated; multi-tenant-correct) |
| Custom app (store-admin Admin API token) | deferred fallback (fast but single-store) |

**Auto-selected:** D-01..D-04. Roy creates the Partner app + provides API key/secret (human checkpoint).

## Token encryption (SHOP-02)
**Auto-selected:** app-level AES-256-GCM at `lib/crypto/encryption.ts`, key from `TOKEN_ENCRYPTION_KEY` (D-05). Over Prisma-extension / Supabase-column for portability.

## Schema (SHOP-04/06/07/08)
**Auto-selected:** ShopifyConnection + Location + InventoryLevel(onHand) + IngestCursor + WebhookEvent; `Tenant.shopifyDomain @unique` (D-06/D-07/D-08).

## Ingest strategy (SHOP-03/05/06/07)
**Auto-selected:** webhooks-primary + Bulk Operations 365d backfill + nightly Vercel-Cron reconcile + IngestCursor; HMAC on request.text() first + timingSafeEqual; X-Shopify-Webhook-Id dedupe (D-09/D-10).

## Local dev & webhooks
**Auto-selected:** backfill (outbound) validates ingest locally; live webhook delivery deferred to Vercel deploy / optional tunnel; HMAC unit-tested with a fixture (D-11).

## Synthetic → real transition
**Auto-selected:** first real connect replaces the tenant's synthetic seed with real data — **destructive for demo data, guarded with explicit owner confirmation + dry-run count** (D-13).

## Odoo (ODOO-01..05)
| Option | Selected |
|--------|----------|
| Build + test Odoo in Phase 3 first pass | ✗ (no live Odoo test target; ODOO-02/03 need Phase-4 merge layer) |
| Defer Odoo to a Phase 3 tail / later milestone; ship Shopify fully first | ✓ |

**Auto-selected:** D-12 — Shopify-complete, Odoo-scaffolded/deferred. **Flagged for Roy** (reshapes Phase 3 scope).

## Deferred
Custom-app token fallback · Odoo connector · multi-location forecasting · webhook→forecast retrigger · local webhook delivery testing.

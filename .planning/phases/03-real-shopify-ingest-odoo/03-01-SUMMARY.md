# Plan 03-01 Summary — Schema + encryption foundation

status: complete-verified
plan: 03-01
phase: 03-real-shopify-ingest-odoo
requirements: [SHOP-02, SHOP-04, SHOP-06, SHOP-07, SHOP-08]
completed: 2026-05-31

## What was built

- **`lib/crypto/encryption.ts`** (SHOP-02 / D-05): authenticated AES-256-GCM `encrypt()`/`decrypt()` keyed on `TOKEN_ENCRYPTION_KEY` (32-byte base64, validated). Self-describing `iv:authTag:ciphertext` (base64). Key read lazily inside the functions. **`lib/crypto/encryption.test.ts`** — 5 tests: exact round-trip, ciphertext≠plaintext, random-IV-per-call, tamper→throws (GCM auth), missing-key→throws.
- **`prisma/schema.prisma`** (D-06/07/08): six new models — `Session` (for session-storage-prisma@9), `ShopifyConnection` (tenantId @unique, shopDomain @unique, encrypted accessToken), `Location` (isPrimary), `InventoryLevel` (`onHand`, NOT available), `IngestCursor`, `WebhookEvent` (webhookId @unique). `Tenant.shopifyDomain` widened `String` → `String? @unique` (enables `resolveTenantByDomain` findUnique). Relations added to Tenant + Product.
- **Migration** `20260531000000_add_shopify_connection_location_inventory_ingest_webhook` — additive-only, applied to the live Supabase DB.

## Verified

- `npx vitest run lib/crypto/encryption.test.ts` → **5 passed**.
- `npx prisma validate` → schema valid; all 6 models present; `onHand` present, no field named `available`.
- Migration SQL: `grep -E "DROP TABLE|DROP COLUMN|DELETE FROM"` → **0** (additive-only); `DROP NOT NULL` on shopifyDomain present (widening); 6 `CREATE TABLE`.
- `npx prisma migrate status` → "Database schema is up to date!" (6 migrations).
- Post-migration: `prisma.product.count()` → **1023** (Beauty Square synthetic data intact); new tables reachable (shopifyConnection/location count = 0).

## Deviations

- **`prisma migrate dev` is non-interactive-hostile** (it blocks on the shopifyDomain unique-constraint data-loss warning, even with `--create-only`). Used the Supabase-safe path instead: `prisma migrate diff --from-schema-datasource --to-schema-datamodel --script` → wrote `migration.sql` → `prisma migrate deploy`. Same end state, recorded in `_prisma_migrations`. (Matches the memory note on Prisma migrate-diff for this project.)
- Stopped the dev server before migrating (Supabase free-tier pooler connection cap — would otherwise fail to connect).
- `Session.userId BigInt?` added (the session-storage-prisma@9 shape) — confirm exact columns against the adapter README when wiring Plan 03-02 (Open Question #3).

## Self-Check: PASSED

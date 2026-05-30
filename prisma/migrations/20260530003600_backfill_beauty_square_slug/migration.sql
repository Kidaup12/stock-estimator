-- Backfill the existing Beauty Square tenant's slug so the NOT NULL constraint
-- in the next migration succeeds. Idempotent: keyed on shopifyDomain, guarded
-- by slug IS NULL. (D-07/D-15: Beauty Square -> slug="beauty-square".)
-- The owner Membership backfill ships in Plan 05; this only populates the slug column.
UPDATE "Tenant" SET "slug" = 'beauty-square' WHERE "shopifyDomain" = 'beautysquareke.co' AND "slug" IS NULL;

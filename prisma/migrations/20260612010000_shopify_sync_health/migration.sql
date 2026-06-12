-- Sync health (G1): record last successful + last failed reconcile so the UI can
-- show a visible "sync failed / stale" warning instead of failing silently.
-- Additive + nullable — safe on the live DB; the cron backfills on next run.
ALTER TABLE "ShopifyConnection" ADD COLUMN "lastSyncOkAt" TIMESTAMP(3);
ALTER TABLE "ShopifyConnection" ADD COLUMN "lastSyncError" TEXT;

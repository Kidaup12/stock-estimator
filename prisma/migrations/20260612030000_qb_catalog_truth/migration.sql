-- QB catalog truth: membership flags + last-confirmed timestamp + sync-run audit.
-- Additive + live-safe: existing rows default to active=true (no behavior change
-- until the first QB feed runs). Out-of-stock has NO effect on `active`.
ALTER TABLE "Product" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN "activeOverride" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "qbMatchedAt" TIMESTAMP(3);
CREATE INDEX "Product_tenantId_active_idx" ON "Product"("tenantId", "active");

CREATE TABLE "QbSyncRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "flagged" INTEGER NOT NULL DEFAULT 0,
    "weak" INTEGER NOT NULL DEFAULT 0,
    "totalProducts" INTEGER NOT NULL DEFAULT 0,
    "aborted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "QbSyncRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "QbSyncRun_tenantId_at_idx" ON "QbSyncRun"("tenantId", "at");
ALTER TABLE "QbSyncRun" ADD CONSTRAINT "QbSyncRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

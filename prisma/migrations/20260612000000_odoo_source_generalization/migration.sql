-- Odoo source generalization (ADDITIVE / live-safe).
-- Keeps the existing (tenantId, shopifyProductId) and (tenantId, shopifyLocationId)
-- uniques so the deployed app + hourly n8n sync keep working. Just makes the
-- shopify columns nullable (Postgres treats NULLs as distinct in a unique, so
-- Odoo rows with NULL shopify ids never collide), adds generic externalId+source,
-- the new (tenantId, source, externalId) uniques, and the OdooConnection table.

-- ── Tenant ───────────────────────────────────────────────────────────────────
ALTER TABLE "Tenant" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'shopify';

-- ── Product ──────────────────────────────────────────────────────────────────
ALTER TABLE "Product" ADD COLUMN "externalId" TEXT;
ALTER TABLE "Product" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'shopify';
ALTER TABLE "Product" ALTER COLUMN "shopifyProductId" DROP NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "shopifyVariantId" DROP NOT NULL;

-- ── Location ─────────────────────────────────────────────────────────────────
ALTER TABLE "Location" ADD COLUMN "externalId" TEXT;
ALTER TABLE "Location" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'shopify';
ALTER TABLE "Location" ALTER COLUMN "shopifyLocationId" DROP NOT NULL;

-- ── OdooConnection ───────────────────────────────────────────────────────────
CREATE TABLE "OdooConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "database" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    CONSTRAINT "OdooConnection_pkey" PRIMARY KEY ("id")
);

-- ── Indexes / constraints ────────────────────────────────────────────────────
CREATE UNIQUE INDEX "OdooConnection_tenantId_key" ON "OdooConnection"("tenantId");
CREATE INDEX "Product_tenantId_source_idx" ON "Product"("tenantId", "source");
CREATE UNIQUE INDEX "Product_tenantId_source_externalId_key" ON "Product"("tenantId", "source", "externalId");
CREATE UNIQUE INDEX "Location_tenantId_source_externalId_key" ON "Location"("tenantId", "source", "externalId");

ALTER TABLE "OdooConnection" ADD CONSTRAINT "OdooConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

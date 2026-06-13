-- Dellwest POS physical sales (Track B1): raw sale + line storage. Additive.
-- SalesHistory (channel="pos") is derived from the matched lines; no Shopify writes.
CREATE TABLE "PosSale" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "reference" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "salesAgent" TEXT,
    "warehouse" TEXT,
    "customer" TEXT,
    "saleStatus" TEXT,
    "paymentStatus" TEXT,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL DEFAULT 'physical',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PosSale_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PosSale_tenantId_externalId_key" ON "PosSale"("tenantId", "externalId");
CREATE INDEX "PosSale_tenantId_date_idx" ON "PosSale"("tenantId", "date");
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PosSaleLine" (
    "id" TEXT NOT NULL,
    "posSaleId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "productId" TEXT,
    CONSTRAINT "PosSaleLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PosSaleLine_tenantId_productId_idx" ON "PosSaleLine"("tenantId", "productId");
CREATE INDEX "PosSaleLine_posSaleId_idx" ON "PosSaleLine"("posSaleId");
ALTER TABLE "PosSaleLine" ADD CONSTRAINT "PosSaleLine_posSaleId_fkey" FOREIGN KEY ("posSaleId") REFERENCES "PosSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosSaleLine" ADD CONSTRAINT "PosSaleLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

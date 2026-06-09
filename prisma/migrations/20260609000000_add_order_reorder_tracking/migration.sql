-- Reorder tracking / order memory: manual "Mark as ordered" markers on the Order model.
-- Additive + nullable (sawEnroute defaults false) — safe on existing rows.
ALTER TABLE "Order" ADD COLUMN "productId" TEXT;
ALTER TABLE "Order" ADD COLUMN "orderedQty" INTEGER;
ALTER TABLE "Order" ADD COLUMN "orderedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "expectedArrivalAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "receivedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "stockAtOrder" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "sawEnroute" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Order_tenantId_productId_status_idx" ON "Order"("tenantId", "productId", "status");

-- Add Product.importCategory ("LOCAL" | "KOREAN" | "WESTERN"; NULL = unclassified, treated LOCAL).
-- Drives default lead time + order-cover window per Mary's policy:
-- local cover ~17d; Korean/Western imports ETA 28d, cover >= 21d.
ALTER TABLE "Product" ADD COLUMN "importCategory" TEXT;

CREATE INDEX "Product_tenantId_importCategory_idx" ON "Product"("tenantId", "importCategory");

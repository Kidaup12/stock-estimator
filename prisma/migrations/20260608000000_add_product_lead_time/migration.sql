-- Per-product lead-time override (days). Nullable → falls back to supplier default.
ALTER TABLE "Product" ADD COLUMN "leadTimeDays" INTEGER;

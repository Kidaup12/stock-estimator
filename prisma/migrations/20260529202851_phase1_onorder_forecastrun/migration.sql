/*
  Warnings:

  - The required column `forecastRunId` was added to the `Prediction` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterTable
ALTER TABLE "Prediction" ADD COLUMN     "forecastRunId" TEXT NOT NULL,
ADD COLUMN     "regime" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "expectedArrivalAt" TIMESTAMP(3),
ADD COLUMN     "onOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "receivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Prediction_tenantId_productId_runDate_idx" ON "Prediction"("tenantId", "productId", "runDate");

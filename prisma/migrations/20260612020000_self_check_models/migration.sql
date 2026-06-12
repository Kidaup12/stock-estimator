-- Self-checking models (G6 backtest history + G8 spot-check). Additive new tables.
CREATE TABLE "BacktestRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mae" DOUBLE PRECISION NOT NULL,
    "bias" DOUBLE PRECISION NOT NULL,
    "mape" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL,
    "tag" TEXT,
    CONSTRAINT "BacktestRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BacktestRun_tenantId_runDate_idx" ON "BacktestRun"("tenantId", "runDate");

CREATE TABLE "SpotCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "systemQty" DOUBLE PRECISION NOT NULL,
    "countedQty" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "countedAt" TIMESTAMP(3),
    CONSTRAINT "SpotCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SpotCheck_tenantId_weekKey_idx" ON "SpotCheck"("tenantId", "weekKey");

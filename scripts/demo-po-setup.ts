/**
 * Demo data setup so PO generation works end-to-end on live Beauty Square data:
 *   1. Create one Supplier per distinct product vendor (brand), assign products.
 *   2. Approve the LATEST forecast run's pending reorder Orders (one per product —
 *      Orders accumulate per run, so we scope to the newest forecastRunId to avoid
 *      duplicate PO lines).
 *   3. Generate POs (grouped by supplier) via the real service.
 *
 * Idempotent: re-running won't duplicate suppliers (matched by name), re-approve,
 * or re-PO already-linked orders. Suppliers/lead-times are placeholders — Mary edits
 * the real ones on the suppliers page later.
 *
 *   npx tsx scripts/demo-po-setup.ts        (dev server stopped — pooler cap)
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { generatePurchaseOrders } from "../lib/po/service";

async function main() {
  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("No tenant");
  const tenantId = tenant.id;

  // ── 1. Suppliers from distinct vendors + assignment ──────────────────────────
  const vendors = await prisma.product.findMany({
    where: { tenantId, vendor: { not: null } },
    select: { vendor: true },
    distinct: ["vendor"],
  });
  const vendorNames = vendors.map((v) => v.vendor!).filter(Boolean);

  let suppliersCreated = 0;
  for (const name of vendorNames) {
    const existing = await prisma.supplier.findFirst({ where: { tenantId, name }, select: { id: true } });
    const supplier =
      existing ??
      (await prisma.supplier.create({
        data: { tenantId, name, currency: "KES", leadTimeAvgDays: 30, leadTimeStdDays: 7, moq: 1 },
        select: { id: true },
      }));
    if (!existing) suppliersCreated++;
    await prisma.product.updateMany({
      where: { tenantId, vendor: name, supplierId: null },
      data: { supplierId: supplier.id },
    });
  }
  const assigned = await prisma.product.count({ where: { tenantId, supplierId: { not: null } } });

  // ── 2. Approve the latest forecast run's pending orders ───────────────────────
  const latest = await prisma.prediction.findFirst({
    where: { tenantId },
    orderBy: { runDate: "desc" },
    select: { forecastRunId: true },
  });
  let approved = 0;
  if (latest?.forecastRunId) {
    const res = await prisma.order.updateMany({
      where: { tenantId, status: "pending", prediction: { forecastRunId: latest.forecastRunId } },
      data: { status: "approved" },
    });
    approved = res.count;
  }

  // ── 3. Generate POs ───────────────────────────────────────────────────────────
  const result = await generatePurchaseOrders(tenantId);

  console.log(
    JSON.stringify({
      vendors: vendorNames.length,
      suppliersCreated,
      productsAssigned: assigned,
      latestForecastRunId: latest?.forecastRunId ?? null,
      ordersApproved: approved,
      posCreated: result.created,
    })
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

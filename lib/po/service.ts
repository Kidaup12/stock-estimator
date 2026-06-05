/**
 * Purchase-order persistence. generatePurchaseOrders() pulls approved Orders not
 * yet attached to a PO, groups them by supplier (lib/po/group), and writes one
 * PurchaseOrder (+ lines) per supplier, linking the source Orders. Tenant-scoped.
 */
import { prisma } from "@/lib/prisma";
import { groupOrdersIntoPos, formatPoNumber, type ApprovedOrderRow } from "./group";

export async function generatePurchaseOrders(tenantId: string) {
  // Approved reorder orders not yet on a PO, with their prediction qty + product/supplier/cost.
  const orders = await prisma.order.findMany({
    where: { tenantId, status: "approved", purchaseOrderId: null },
    select: {
      id: true,
      prediction: {
        select: {
          recommendedQty: true,
          product: { select: { id: true, sku: true, title: true, costKes: true, supplierId: true } },
        },
      },
    },
  });

  const rows: ApprovedOrderRow[] = orders.map((o) => ({
    orderId: o.id,
    supplierId: o.prediction.product.supplierId,
    productId: o.prediction.product.id,
    sku: o.prediction.product.sku,
    title: o.prediction.product.title,
    quantity: o.prediction.recommendedQty,
    unitCostKes: o.prediction.product.costKes,
  }));

  const drafts = groupOrdersIntoPos(rows);
  if (drafts.length === 0) return { created: 0, purchaseOrders: [] as { id: string; poNumber: string }[] };

  let seq = await prisma.purchaseOrder.count({ where: { tenantId } });
  const now = new Date();
  const created: { id: string; poNumber: string }[] = [];

  for (const d of drafts) {
    seq += 1;
    const poNumber = formatPoNumber(seq, now);
    const po = await prisma.purchaseOrder.create({
      data: {
        tenantId,
        supplierId: d.supplierId,
        poNumber,
        status: "draft",
        currency: "KES",
        subtotalKes: d.subtotalKes,
        lines: {
          create: d.lines.map((l) => ({
            productId: l.productId,
            sku: l.sku,
            title: l.title,
            quantity: l.quantity,
            unitCostKes: l.unitCostKes,
            lineTotalKes: l.lineTotalKes,
          })),
        },
      },
      select: { id: true, poNumber: true },
    });
    await prisma.order.updateMany({
      where: { tenantId, id: { in: d.orderIds } },
      data: { purchaseOrderId: po.id },
    });
    created.push(po);
  }
  return { created: created.length, purchaseOrders: created };
}

export async function listPurchaseOrders(tenantId: string) {
  return prisma.purchaseOrder.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, poNumber: true, status: true, currency: true, subtotalKes: true, createdAt: true, sentAt: true,
      supplier: { select: { name: true, country: true } },
      _count: { select: { lines: true } },
    },
  });
}

export async function getPurchaseOrder(tenantId: string, id: string) {
  return prisma.purchaseOrder.findFirst({
    where: { tenantId, id },
    select: {
      id: true, poNumber: true, status: true, currency: true, subtotalKes: true, createdAt: true,
      supplier: { select: { name: true, country: true, currency: true, leadTimeAvgDays: true } },
      lines: { select: { sku: true, title: true, quantity: true, unitCostKes: true, lineTotalKes: true } },
    },
  });
}

export type PurchaseOrderDetail = NonNullable<Awaited<ReturnType<typeof getPurchaseOrder>>>;

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) return NextResponse.json({ products: [] });

  const url = new URL(req.url);
  const vendor = url.searchParams.get("vendor");
  const productType = url.searchParams.get("productType");

  const products = await prisma.product.findMany({
    where: {
      tenantId: tenant.id,
      ...(vendor ? { vendor } : {}),
      ...(productType ? { productType } : {}),
    },
    orderBy: { currentStock: "asc" },
  });

  return NextResponse.json({
    products: products.map(p => ({
      id: p.id,
      sku: p.sku,
      title: p.title,
      vendor: p.vendor,
      productType: p.productType,
      priceKes: p.priceKes,
      imageUrl: p.imageUrl,
      currentStock: p.currentStock,
      dailySalesRate: p.dailySalesRate,
      lastSynced: p.lastSynced,
    })),
  });
}

import { prisma } from "@/lib/prisma";

export type ShopifyConfig = {
  domain: string;
  accessToken?: string | null;
};

export type ShopifyProductSummary = {
  id: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  price: number;
  available: number;
  imageUrl: string | null;
  sku: string;
};

export type ShopifyOrderLine = {
  productId: string;
  quantity: number;
  price: number;
  createdAt: Date;
};

export type ShopifyDraftOrder = {
  id: string;
  productId: string;
  quantity: number;
  createdAt: Date;
};

export class ShopifyClient {
  private cfg: ShopifyConfig;

  constructor(cfg: ShopifyConfig) {
    this.cfg = cfg;
  }

  // MOCK — real impl: GET /admin/api/2024-10/shop.json with X-Shopify-Access-Token header
  async testConnection(): Promise<{ ok: true; shopName: string; mock: boolean }> {
    if (!this.cfg.accessToken) {
      return { ok: true, shopName: `${this.cfg.domain} (mock mode)`, mock: true };
    }
    return { ok: true, shopName: this.cfg.domain, mock: false };
  }

  // MOCK — real impl: GET /admin/api/2024-10/products.json?limit=250
  async fetchProducts(limit = 250): Promise<ShopifyProductSummary[]> {
    const tenant = await prisma.tenant.findFirst({ where: { shopifyDomain: this.cfg.domain } });
    if (!tenant) return [];
    const products = await prisma.product.findMany({
      where: { tenantId: tenant.id },
      take: limit,
    });
    return products.map(p => ({
      id: p.shopifyProductId,
      title: p.title,
      vendor: p.vendor,
      productType: p.productType,
      price: p.priceKes,
      available: p.currentStock,
      imageUrl: p.imageUrl,
      sku: p.sku,
    }));
  }

  // MOCK — real impl: GET /admin/api/2024-10/orders.json?status=any&created_at_min=...
  async fetchOrders(since: Date): Promise<ShopifyOrderLine[]> {
    const tenant = await prisma.tenant.findFirst({ where: { shopifyDomain: this.cfg.domain } });
    if (!tenant) return [];
    const sales = await prisma.salesHistory.findMany({
      where: { tenantId: tenant.id, date: { gte: since } },
      include: { product: true },
    });
    return sales.map(s => ({
      productId: s.product.shopifyProductId,
      quantity: s.quantity,
      price: s.revenueKes / Math.max(s.quantity, 1),
      createdAt: s.date,
    }));
  }

  // MOCK — real impl: GET /admin/api/2024-10/inventory_levels.json?location_ids=...
  async fetchInventory(): Promise<{ productId: string; available: number }[]> {
    const tenant = await prisma.tenant.findFirst({ where: { shopifyDomain: this.cfg.domain } });
    if (!tenant) return [];
    const products = await prisma.product.findMany({ where: { tenantId: tenant.id } });
    return products.map(p => ({ productId: p.shopifyProductId, available: p.currentStock }));
  }

  // MOCK — real impl: POST /admin/api/2024-10/draft_orders.json
  async createDraftOrder(params: { productId: string; quantity: number }): Promise<ShopifyDraftOrder> {
    return {
      id: `mock-draft-${Date.now()}`,
      productId: params.productId,
      quantity: params.quantity,
      createdAt: new Date(),
    };
  }
}

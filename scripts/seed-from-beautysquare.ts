import { PrismaClient } from "@prisma/client";
import { mulberry32, seedFrom } from "../lib/forecast/rng";
import { SCRAPE_SEED } from "../lib/forecast/rng-constants";

const prisma = new PrismaClient();

type ShopifyVariant = {
  id: number;
  title: string;
  sku: string | null;
  price: string;
  available: boolean;
};

type ShopifyImage = { src: string };

type ShopifyProduct = {
  id: number;
  title: string;
  handle: string;
  vendor: string;
  product_type: string;
  tags: string[];
  variants: ShopifyVariant[];
  images: ShopifyImage[];
};

const SOURCE = "https://beautysquareke.co/products.json";
const TENANT_NAME = "Beauty Square KE";
const SHOPIFY_DOMAIN = "beautysquareke.co";

async function fetchPage(page: number): Promise<ShopifyProduct[]> {
  const res = await fetch(`${SOURCE}?limit=250&page=${page}`);
  if (!res.ok) throw new Error(`Page ${page} fetch failed: ${res.status}`);
  const data = await res.json();
  return data.products as ShopifyProduct[];
}

export async function seed() {
  let tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: TENANT_NAME, shopifyDomain: SHOPIFY_DOMAIN, currency: "KES" },
    });
  }

  console.log(`Seeding into tenant ${tenant.id} (${tenant.name})`);

  let page = 1;
  let total = 0;
  while (true) {
    const products = await fetchPage(page);
    if (products.length === 0) break;

    for (const p of products) {
      const variant = p.variants[0];
      if (!variant) continue;
      const price = parseFloat(variant.price);
      if (isNaN(price)) continue;

      const sku = variant.sku || `BS-${p.id}-${variant.id}`;
      const imageUrl = p.images[0]?.src || null;
      // Per-product deterministic rng — re-scrapes of the same product
      // produce identical initial stock + cost regardless of catalogue order.
      const rng = mulberry32(seedFrom([SCRAPE_SEED, p.id ?? p.title ?? sku]));
      const initialStock = Math.floor(20 + rng() * 80);
      // Default cost factor 45-60% of retail; refined by /scripts/backfill-costs.ts once suppliers are assigned.
      const cost = Math.round(price * (0.45 + rng() * 0.15));

      await prisma.product.upsert({
        where: {
          tenantId_shopifyProductId: { tenantId: tenant.id, shopifyProductId: p.id.toString() },
        },
        create: {
          tenantId: tenant.id,
          shopifyProductId: p.id.toString(),
          shopifyVariantId: variant.id.toString(),
          sku,
          title: p.title,
          vendor: p.vendor || null,
          productType: p.product_type || null,
          priceKes: price,
          costKes: cost,
          imageUrl,
          currentStock: initialStock,
        },
        update: {
          shopifyVariantId: variant.id.toString(),
          sku,
          title: p.title,
          vendor: p.vendor || null,
          productType: p.product_type || null,
          priceKes: price,
          imageUrl,
          lastSynced: new Date(),
        },
      });
      total++;
    }

    console.log(`Page ${page}: ${products.length} products`);
    if (products.length < 250) break;
    page++;
  }

  console.log(`Seed done. Total products: ${total}`);
  return { tenantId: tenant.id, count: total };
}

if (require.main === module) {
  seed()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}

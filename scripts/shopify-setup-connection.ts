/**
 * One-off: create the ShopifyConnection for the beauty-square tenant and set
 * Tenant.shopifyDomain, so the backfill route/harness can resolve the shop.
 *
 * Auth is the client-credentials grant (lib/shopify/shopify.ts) — the stored
 * ShopifyConnection.accessToken is an encrypted snapshot of a freshly-minted
 * token (the field is required and documents "a token lives here, encrypted"),
 * but the runtime re-mints on demand from SHOPIFY_API_KEY/SECRET, so staleness
 * is harmless. The durable per-tenant credential model arrives with multi-tenant.
 *
 * Run with the dev server STOPPED (Supabase free-tier pooler connection cap).
 *   npx tsx scripts/shopify-setup-connection.ts
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { encrypt } from "../lib/crypto/encryption";
import { getAdminToken } from "../lib/shopify/shopify";
import fs from "node:fs";

const SLUG = "beauty-square";
const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN || "beauty-square-ke-3.myshopify.com";
const SCOPE = process.env.SHOPIFY_SCOPES || "read_products,read_orders,read_inventory,read_locations";

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' not found`);

  // Verify the grant works + capture a real token to encrypt-at-rest.
  const token = await getAdminToken(SHOP_DOMAIN);
  const encrypted = encrypt(token);

  await prisma.shopifyConnection.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      shopDomain: SHOP_DOMAIN,
      accessToken: encrypted,
      scope: SCOPE,
      uninstalledAt: null,
    },
    update: { shopDomain: SHOP_DOMAIN, accessToken: encrypted, scope: SCOPE, uninstalledAt: null },
  });

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { shopifyDomain: SHOP_DOMAIN },
  });

  fs.writeFileSync(
    ".planning/_setup.txt",
    `OK tenant=${tenant.id} domain=${SHOP_DOMAIN} scope=${SCOPE} tokenPrefix=${token.slice(0, 6)}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    fs.writeFileSync(".planning/_setup.txt", "ERR " + (e as Error).message);
    process.exit(1);
  });

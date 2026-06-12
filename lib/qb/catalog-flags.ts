/**
 * Pure decision for QB catalog-truth (Track A). Given the tenant's products and
 * the set of SKUs present in the latest QB feed, decide which products to confirm
 * active vs. soft-deactivate. Membership in the feed is the ONLY signal — stock is
 * deliberately absent so an out-of-stock-but-in-QB product can never be flagged.
 */
export type CatalogProduct = {
  id: string;
  sku: string;
  source: string;
  active: boolean;
  activeOverride: boolean;
};

export type CatalogFlagResult = {
  activate: string[];   // ids → set active=true + qbMatchedAt=now
  deactivate: string[]; // ids → set active=false
  aborted: boolean;     // guard tripped: feed looks partial/broken
  counts: { matched: number; flagged: number; totalShopify: number };
};

const norm = (s: string) => s.trim().toLowerCase();

export function computeCatalogFlags(
  products: CatalogProduct[],
  feedSkus: Iterable<string>,
  opts: { abortThreshold?: number } = {}
): CatalogFlagResult {
  const threshold = opts.abortThreshold ?? 0.6;
  const feed = new Set<string>();
  for (const s of feedSkus) {
    const k = norm(s);
    if (k) feed.add(k);
  }

  const activate: string[] = [];
  const deactivate: string[] = [];
  let totalShopify = 0;

  for (const prod of products) {
    if (prod.source === "shopify") totalShopify++;
    if (feed.has(norm(prod.sku))) {
      activate.push(prod.id); // confirm + refresh qbMatchedAt (idempotent)
    } else if (prod.source === "shopify" && !prod.activeOverride) {
      deactivate.push(prod.id);
    }
  }

  // A broken/partial QB pull must never nuke the catalogue.
  const flaggedShare = totalShopify > 0 ? deactivate.length / totalShopify : 0;
  const aborted = flaggedShare > threshold;

  return {
    activate,
    deactivate: aborted ? [] : deactivate,
    aborted,
    counts: { matched: activate.length, flagged: aborted ? 0 : deactivate.length, totalShopify },
  };
}

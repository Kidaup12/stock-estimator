/**
 * Cursor-paginated Admin GraphQL reads for the nightly reconcile. Unlike Bulk
 * Operations (server-side, minutes-long, one-per-shop — used only for the initial
 * backfill), these run inline and are sized for small nightly deltas.
 *
 * Each helper pages through `edges`/`pageInfo` until `hasNextPage` is false and
 * returns the flat list of nodes.
 */
import { shopifyGraphql } from "./shopify";

const PAGE = 100;

type PageInfo = { hasNextPage: boolean; endCursor: string | null };

async function pageAll<T>(
  shopDomain: string,
  build: (after: string | null) => { query: string; variables: Record<string, unknown> },
  extract: (data: any) => { nodes: T[]; pageInfo: PageInfo }
): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null;
  // Hard ceiling to avoid an accidental infinite loop.
  for (let i = 0; i < 1000; i++) {
    const { query, variables } = build(after);
    const data = await shopifyGraphql<any>(shopDomain, query, variables);
    const { nodes, pageInfo } = extract(data);
    out.push(...nodes);
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }
  return out;
}

/** Products whose `updated_at >= sinceIso`, with first variant + featured image. */
export async function fetchProductsSince(shopDomain: string, sinceIso: string) {
  return pageAll(
    shopDomain,
    (after) => ({
      query: `query($after: String, $q: String!) {
        products(first: ${PAGE}, after: $after, query: $q) {
          edges { node {
            id title vendor productType
            featuredImage { url }
            variants(first: 1) { edges { node { id sku price inventoryItem { id } } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      variables: { after, q: `updated_at:>=${sinceIso}` },
    }),
    (d) => ({
      nodes: d.products.edges.map((e: any) => ({
        id: e.node.id,
        title: e.node.title,
        vendor: e.node.vendor,
        productType: e.node.productType,
        featuredImage: e.node.featuredImage,
        variants: e.node.variants.edges.map((v: any) => v.node),
      })),
      pageInfo: d.products.pageInfo,
    })
  );
}

/** Orders whose `updated_at >= sinceIso`, with line items. */
export async function fetchOrdersSince(shopDomain: string, sinceIso: string) {
  return pageAll(
    shopDomain,
    (after) => ({
      query: `query($after: String, $q: String!) {
        orders(first: ${PAGE}, after: $after, query: $q) {
          edges { node {
            id name createdAt
            lineItems(first: 50) { edges { node {
              quantity sku product { id } variant { id }
              originalUnitPriceSet { shopMoney { amount currencyCode } }
            } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      variables: { after, q: `updated_at:>=${sinceIso}` },
    }),
    (d) => ({
      nodes: d.orders.edges.map((e: any) => ({
        id: e.node.id,
        name: e.node.name,
        createdAt: e.node.createdAt,
        lineItems: e.node.lineItems.edges.map((l: any) => l.node),
      })),
      pageInfo: d.orders.pageInfo,
    })
  );
}

/** All locations with on_hand inventory levels (full refresh — no cheap delta). */
export async function fetchLocationsWithInventory(shopDomain: string) {
  return pageAll(
    shopDomain,
    (after) => ({
      query: `query($after: String) {
        locations(first: 50, after: $after) {
          edges { node {
            id name isActive
            inventoryLevels(first: 250) { edges { node {
              quantities(names: ["on_hand"]) { name quantity }
              item { id variant { id product { id } } }
            } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      variables: { after },
    }),
    (d) => ({
      nodes: d.locations.edges.map((e: any) => ({
        id: e.node.id,
        name: e.node.name,
        isActive: e.node.isActive,
        inventoryLevels: e.node.inventoryLevels.edges.map((l: any) => l.node),
      })),
      pageInfo: d.locations.pageInfo,
    })
  );
}

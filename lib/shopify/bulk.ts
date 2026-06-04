/**
 * Shopify GraphQL Bulk Operations runner.
 *
 * Bulk Operations run server-side, bypass the cost-based rate limit, and return a
 * temporary JSONL URL — the right tool for the backfill (orders 365d + the full
 * product catalog + on_hand inventory).
 *
 * IMPORTANT: only ONE bulk operation runs per shop at a time. Callers MUST
 * SERIALIZE the three exports (inventory -> products -> orders); launching a
 * second while one is RUNNING errors. `runBulkQuery` enforces nothing across
 * calls — serialization is the caller's responsibility (see the backfill route).
 */

import { shopifyGraphql } from "./shopify";

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 900; // ~30 min ceiling for a large catalog/year of orders

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type BulkOpStatus = {
  id: string | null;
  status: string | null;
  errorCode: string | null;
  objectCount: string | null;
  url: string | null;
};

/**
 * Launch a bulk query, poll until COMPLETED, download the JSONL, and return its
 * raw text. Throws on userErrors, FAILED status, or errorCode. Returns "" when
 * the operation completes with no results (Shopify returns a null url).
 */
export async function runBulkQuery(shopDomain: string, bulkQuery: string): Promise<string> {
  const launch = await shopifyGraphql<{
    bulkOperationRunQuery: {
      bulkOperation: { id: string; status: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(
    shopDomain,
    `mutation bulkRun($query: String!) {
       bulkOperationRunQuery(query: $query) {
         bulkOperation { id status }
         userErrors { field message }
       }
     }`,
    { query: bulkQuery }
  );

  const errs = launch.bulkOperationRunQuery.userErrors;
  if (errs.length) {
    throw new Error(`bulkOperationRunQuery userErrors: ${errs.map((e) => e.message).join("; ")}`);
  }

  // Poll currentBulkOperation until terminal.
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const poll = await shopifyGraphql<{ currentBulkOperation: BulkOpStatus }>(
      shopDomain,
      `{ currentBulkOperation {
           id status errorCode objectCount url
       } }`
    );
    const op = poll.currentBulkOperation;
    if (!op || !op.status) continue;

    if (op.status === "COMPLETED") {
      if (!op.url) return ""; // completed, zero objects
      const res = await fetch(op.url); // temporary GCS link — download immediately
      if (!res.ok) throw new Error(`Bulk JSONL download failed: HTTP ${res.status}`);
      return await res.text();
    }
    if (op.status === "FAILED" || op.errorCode) {
      throw new Error(`Bulk operation failed: status=${op.status} errorCode=${op.errorCode}`);
    }
    // RUNNING / CREATED / CANCELING -> keep polling
  }
  throw new Error("Bulk operation timed out (exceeded max polls).");
}

/** ISO date (YYYY-MM-DD) for `daysAgo` days before now — used in the orders filter. */
export function isoDaysAgo(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Orders for the last `sinceDays` days with line items (quantity, sku, product +
 * variant ids, unit price). Note: without the protected `read_all_orders` scope
 * Shopify only exposes the last ~60 days regardless of the filter; the filter is
 * still correct for when that scope is granted.
 */
export function ordersBulkQuery(sinceDays = 365): string {
  return `{
    orders(query: "created_at:>=${isoDaysAgo(sinceDays)}") {
      edges { node {
        id
        name
        createdAt
        lineItems {
          edges { node {
            id
            quantity
            sku
            product { id }
            variant { id }
            originalUnitPriceSet { shopMoney { amount currencyCode } }
          } }
        }
      } }
    }
  }`;
}

/** Full product catalog with the first variant's id/sku/price + featured image. */
export function productsBulkQuery(): string {
  return `{
    products {
      edges { node {
        id
        title
        vendor
        productType
        featuredImage { url }
        variants {
          edges { node {
            id
            sku
            price
            inventoryItem { id }
          } }
        }
      } }
    }
  }`;
}

/**
 * Locations with their inventory levels, using `on_hand` (NOT `available`, which
 * excludes committed stock — D-09). Each level points back to its variant+product.
 */
export function inventoryBulkQuery(): string {
  return `{
    locations {
      edges { node {
        id
        name
        isActive
        inventoryLevels {
          edges { node {
            id
            quantities(names: ["on_hand"]) { name quantity }
            item { id variant { id product { id } } }
          } }
        }
      } }
    }
  }`;
}

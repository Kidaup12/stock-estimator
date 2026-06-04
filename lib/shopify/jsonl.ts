/**
 * Streaming-friendly parser for Shopify Bulk Operations JSONL output.
 *
 * Bulk JSONL is FLAT (RESEARCH Pitfall 5): each line is one JSON object. Child
 * objects (line items, variants, inventory levels) are SEPARATE lines carrying a
 * `__parentId` field that points at their parent's `id`. We reassemble them into
 * nested parents client-side.
 *
 * The child collection name is inferred from the child's gid type, e.g.
 *   gid://shopify/LineItem/123      -> "lineItems"
 *   gid://shopify/ProductVariant/9  -> "variants"
 *   gid://shopify/InventoryLevel/4  -> "inventoryLevels"
 * Callers can override/extend the mapping via `childKeyForType`.
 */

export type BulkNode = Record<string, unknown> & {
  id?: string;
  __parentId?: string;
};

export type ParentRecord = Record<string, unknown> & { id?: string };

/** Map a gid type segment (e.g. "LineItem") to the parent's child-array key. */
function defaultChildKey(gidType: string): string {
  switch (gidType) {
    case "LineItem":
      return "lineItems";
    case "ProductVariant":
      return "variants";
    case "InventoryLevel":
      return "inventoryLevels";
    case "Order":
      return "orders";
    default:
      // A child MUST carry a typed gid (always true when the bulk query selects
      // `id` on the child). An empty/unknown type means `id` was omitted from the
      // query — bucket under "_unknown" rather than silently fabricating a key
      // like "s" (the bug that hid order lineItems when `id` wasn't selected).
      if (!gidType) return "_unknown";
      return gidType.charAt(0).toLowerCase() + gidType.slice(1) + "s";
  }
}

/** Extract the type segment from a gid: gid://shopify/LineItem/123 -> "LineItem". */
function gidType(gid: string | undefined): string {
  if (!gid) return "";
  const parts = gid.split("/");
  return parts.length >= 4 ? parts[parts.length - 2] : "";
}

/**
 * Parse Bulk JSONL text into top-level parent records with children nested under
 * inferred collection keys. Returns parents in first-seen order. Orphans (a child
 * whose parent hasn't been seen) are tolerated — buffered and attached if the
 * parent appears later, otherwise silently dropped. Never throws on structure.
 */
export function parseBulkJsonl(
  text: string,
  childKeyForType: (gidType: string) => string = defaultChildKey
): ParentRecord[] {
  const parents: ParentRecord[] = [];
  const byId = new Map<string, ParentRecord>();
  // Children whose parent we haven't registered yet.
  const orphans = new Map<string, BulkNode[]>();

  const attachChild = (parent: ParentRecord, child: BulkNode) => {
    const key = childKeyForType(gidType(child.id));
    const arr = (parent[key] as BulkNode[] | undefined) ?? [];
    arr.push(child);
    parent[key] = arr;
  };

  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let node: BulkNode;
    try {
      node = JSON.parse(trimmed) as BulkNode;
    } catch {
      continue; // skip malformed line, keep streaming
    }

    if (node.__parentId) {
      const parent = byId.get(node.__parentId);
      if (parent) {
        attachChild(parent, node);
      } else {
        const buf = orphans.get(node.__parentId) ?? [];
        buf.push(node);
        orphans.set(node.__parentId, buf);
      }
    } else {
      parents.push(node);
      if (node.id) {
        byId.set(node.id, node);
        // Attach any earlier-buffered orphans now that the parent exists.
        const buffered = orphans.get(node.id);
        if (buffered) {
          for (const child of buffered) attachChild(node, child);
          orphans.delete(node.id);
        }
      }
    }
  }

  return parents;
}

import type { OdooClient } from "./client";
import { mapSalesLine, type MappedSalesLine } from "./mappers";

export type SalesSource = "pos" | "sale" | "both" | "none";

/**
 * Auto-detects where sales live (POS vs Sales) and returns normalized lines.
 * pos.order.line carries `qty`; sale.order.line carries `product_uom_qty`. We
 * read each line's `create_date` as the dated bucket (universally present and
 * dated) — confirm the preferred dated field against the live instance during
 * Plan 2 calibration if run-rate looks off.
 */
const POS_MODEL = "pos.order.line";
const SALE_MODEL = "sale.order.line";

function domainSince(field: string, since: Date): unknown[] {
  // Odoo expects "YYYY-MM-DD HH:mm:ss"
  const s = since.toISOString().slice(0, 19).replace("T", " ");
  return [[field, ">=", s]];
}

async function fetchLines(
  client: OdooClient,
  model: string,
  qtyField: "qty" | "product_uom_qty",
  since: Date
): Promise<MappedSalesLine[]> {
  const rows = await client.searchReadAll<Record<string, unknown>>(
    model,
    domainSince("create_date", since),
    ["product_id", qtyField, "price_subtotal", "create_date"]
  );
  return rows
    .map((r) =>
      mapSalesLine({
        ...(r as object),
        order_date: String((r as { create_date?: string }).create_date ?? ""),
      } as never)
    )
    .filter((x): x is MappedSalesLine => x !== null && x.date !== "Invalid Date");
}

export async function detectAndFetchSales(
  client: OdooClient,
  since: Date
): Promise<{ source: SalesSource; lines: MappedSalesLine[] }> {
  const [posCount, saleCount] = await Promise.all([
    client.searchCount(POS_MODEL, domainSince("create_date", since)),
    client.searchCount(SALE_MODEL, domainSince("create_date", since)),
  ]);

  const lines: MappedSalesLine[] = [];
  if (posCount > 0) lines.push(...(await fetchLines(client, POS_MODEL, "qty", since)));
  if (saleCount > 0) lines.push(...(await fetchLines(client, SALE_MODEL, "product_uom_qty", since)));

  const source: SalesSource =
    posCount > 0 && saleCount > 0 ? "both" : posCount > 0 ? "pos" : saleCount > 0 ? "sale" : "none";
  return { source, lines };
}

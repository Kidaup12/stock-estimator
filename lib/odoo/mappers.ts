/**
 * Pure Odoo-record -> normalized-row mappers. No Prisma. Odoo many2one fields
 * arrive as [id, displayName] tuples; numeric fields can be `false` when unset.
 */

/** Odoo many2one: [id, label] | false. */
type M2O = [number, string] | false;

const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const m2oId = (v: M2O): string | null => (Array.isArray(v) ? String(v[0]) : null);
const m2oName = (v: M2O): string | null => (Array.isArray(v) ? v[1] : null);

/** Truncate an Odoo datetime ("YYYY-MM-DD HH:mm:ss", UTC) to UTC-midnight ISO. */
export function dayKeyUTC(odooDatetime: string): string {
  const datePart = odooDatetime.slice(0, 10); // YYYY-MM-DD
  return new Date(`${datePart}T00:00:00.000Z`).toISOString();
}

export type MappedProduct = {
  externalId: string;
  sku: string;
  title: string;
  costKes: number | null; // null => do not write (preserve existing)
  priceKes: number;
};

export function mapProduct(r: {
  id: number;
  default_code?: string | false;
  name?: string;
  standard_price?: number;
  list_price?: number;
}): MappedProduct {
  const cost = num(r.standard_price);
  return {
    externalId: String(r.id),
    sku: r.default_code && r.default_code !== "" ? r.default_code : `odoo-${r.id}`,
    title: r.name ?? `Product ${r.id}`,
    costKes: cost > 0 ? cost : null,
    priceKes: num(r.list_price),
  };
}

export type MappedSalesLine = {
  externalProductId: string;
  quantity: number;
  revenueKes: number;
  date: string; // UTC-midnight ISO
};

/**
 * Normalizes a POS or Sales order line. Caller passes a flattened row that
 * already carries the order's date as `order_date`. pos.order.line uses `qty`;
 * sale.order.line uses `product_uom_qty` — both are read here.
 */
export function mapSalesLine(r: {
  product_id: M2O;
  qty?: number;
  product_uom_qty?: number;
  price_subtotal?: number;
  order_date: string;
}): MappedSalesLine | null {
  const externalProductId = m2oId(r.product_id);
  if (!externalProductId) return null;
  return {
    externalProductId,
    quantity: num(r.qty ?? r.product_uom_qty),
    revenueKes: num(r.price_subtotal),
    date: dayKeyUTC(r.order_date),
  };
}

export type MappedSupplierInfo = {
  supplierName: string | null;
  leadTimeDays: number;
  productTmplId: string | null;
};

export function mapSupplierInfo(r: {
  partner_id: M2O;
  delay?: number;
  product_tmpl_id?: M2O;
}): MappedSupplierInfo {
  return {
    supplierName: m2oName(r.partner_id),
    leadTimeDays: num(r.delay),
    productTmplId: m2oId(r.product_tmpl_id ?? false),
  };
}

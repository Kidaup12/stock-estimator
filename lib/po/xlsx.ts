/** Render a PurchaseOrder to an XLSX buffer via exceljs. */
import ExcelJS from "exceljs";
import type { PurchaseOrderDetail } from "./service";

export async function renderPoXlsx(po: PurchaseOrderDetail): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(po.poNumber);
  ws.addRow([`Purchase Order ${po.poNumber}`]);
  ws.addRow([`Supplier`, po.supplier.name, po.supplier.country ?? ""]);
  ws.addRow([`Date`, new Date(po.createdAt).toLocaleDateString("en-KE"), `Status`, po.status]);
  ws.addRow([]);
  const header = ws.addRow(["SKU", "Product", "Qty", "Unit (KES)", "Total (KES)"]);
  header.font = { bold: true };
  for (const l of po.lines) {
    ws.addRow([l.sku, l.title, l.quantity, l.unitCostKes, l.lineTotalKes]);
  }
  ws.addRow([]);
  ws.addRow(["", "", "", "Subtotal (KES)", po.subtotalKes]).font = { bold: true };
  ws.columns.forEach((c) => { c.width = 18; });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

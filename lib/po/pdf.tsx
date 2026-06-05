/** Render a PurchaseOrder to a PDF buffer via @react-pdf/renderer (server-side). */
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import type { PurchaseOrderDetail } from "./service";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica" },
  h1: { fontSize: 18, marginBottom: 4 },
  muted: { color: "#666", marginBottom: 12 },
  row: { flexDirection: "row", borderBottom: "1 solid #ddd", paddingVertical: 4 },
  head: { flexDirection: "row", borderBottom: "1 solid #000", paddingVertical: 4, fontFamily: "Helvetica-Bold" },
  cSku: { width: "18%" }, cTitle: { width: "42%" }, cQty: { width: "12%", textAlign: "right" },
  cUnit: { width: "14%", textAlign: "right" }, cTot: { width: "14%", textAlign: "right" },
  total: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10, fontFamily: "Helvetica-Bold" },
});

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export async function renderPoPdf(po: PurchaseOrderDetail): Promise<Buffer> {
  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Purchase Order {po.poNumber}</Text>
        <Text style={styles.muted}>
          Supplier: {po.supplier.name}{po.supplier.country ? ` (${po.supplier.country})` : ""} • Lead time ~{po.supplier.leadTimeAvgDays}d{"\n"}
          Date: {new Date(po.createdAt).toLocaleDateString("en-KE")} • Status: {po.status}
        </Text>
        <View style={styles.head}>
          <Text style={styles.cSku}>SKU</Text><Text style={styles.cTitle}>Product</Text>
          <Text style={styles.cQty}>Qty</Text><Text style={styles.cUnit}>Unit</Text><Text style={styles.cTot}>Total</Text>
        </View>
        {po.lines.map((l, i) => (
          <View style={styles.row} key={i}>
            <Text style={styles.cSku}>{l.sku}</Text><Text style={styles.cTitle}>{l.title}</Text>
            <Text style={styles.cQty}>{l.quantity}</Text>
            <Text style={styles.cUnit}>{kes(l.unitCostKes)}</Text>
            <Text style={styles.cTot}>{kes(l.lineTotalKes)}</Text>
          </View>
        ))}
        <View style={styles.total}><Text>Subtotal: {kes(po.subtotalKes)}</Text></View>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}

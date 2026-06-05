/**
 * Supplier PO email (Resend) — DEFERRED. RESEND_API_KEY is not yet provisioned, so
 * this composes the message but does NOT send unless a key is present. When the key
 * arrives, the send path activates with no caller change.
 */
import type { PurchaseOrderDetail } from "./service";

export type EmailResult = { sent: boolean; reason?: string };

export function composePoEmail(po: PurchaseOrderDetail, toEmail: string) {
  const subject = `Purchase Order ${po.poNumber} — ${po.supplier.name}`;
  const lines = po.lines.map((l) => `• ${l.quantity} × ${l.title} (${l.sku})`).join("\n");
  const text = `Hello ${po.supplier.name},\n\nPlease find Purchase Order ${po.poNumber}:\n\n${lines}\n\nSubtotal: KES ${po.subtotalKes.toLocaleString("en-KE")}\n\nThank you.`;
  return { to: toEmail, subject, text };
}

export async function sendPoEmail(po: PurchaseOrderDetail, toEmail: string): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "RESEND_API_KEY not configured (deferred)" };
  // When the key exists: POST to Resend. Left intentionally minimal until provisioned.
  const { subject, text, to } = composePoEmail(po, toEmail);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || "orders@example.com", to, subject, text }),
  });
  if (!res.ok) return { sent: false, reason: `Resend HTTP ${res.status}` };
  return { sent: true };
}

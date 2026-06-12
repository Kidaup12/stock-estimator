import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { encrypt } from "@/lib/crypto/encryption";
import { z } from "zod";

/** GET /api/odoo — current Odoo connection for the tenant (API key never returned). */
export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const c = await prisma.odooConnection.findUnique({ where: { tenantId: tenant.id } });
  return NextResponse.json({
    connected: !!c && !c.disabledAt,
    baseUrl: c?.baseUrl ?? "",
    database: c?.database ?? "",
    username: c?.username ?? "",
    hasApiKey: !!c?.apiKey,
    lastSyncedAt: c?.lastSyncedAt ?? null,
  });
}

const schema = z.object({
  baseUrl: z.string().url(),
  database: z.string().min(1),
  username: z.string().min(1),
  apiKey: z.string().optional(), // optional on edit — blank keeps the stored key
});

/** POST /api/odoo — save the connection (OWNER only). Encrypts the API key. */
export async function POST(req: NextRequest) {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  if (auth.membership.role !== "OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { baseUrl, database, username, apiKey } = parsed.data;
  const cleanUrl = baseUrl.replace(/\/+$/, "");

  const existing = await prisma.odooConnection.findUnique({ where: { tenantId: tenant.id } });
  if (!apiKey && !existing) {
    return NextResponse.json({ error: "API key required" }, { status: 400 });
  }

  const update: { baseUrl: string; database: string; username: string; disabledAt: null; apiKey?: string } = {
    baseUrl: cleanUrl,
    database,
    username,
    disabledAt: null,
  };
  if (apiKey) update.apiKey = encrypt(apiKey);

  await prisma.odooConnection.upsert({
    where: { tenantId: tenant.id },
    update,
    create: { tenantId: tenant.id, baseUrl: cleanUrl, database, username, apiKey: encrypt(apiKey as string) },
  });
  // This tenant is now Odoo-sourced (drives the reconcile/ingest path).
  await prisma.tenant.update({ where: { id: tenant.id }, data: { source: "odoo" } });
  return NextResponse.json({ ok: true });
}

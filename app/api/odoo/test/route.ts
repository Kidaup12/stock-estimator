import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { decrypt } from "@/lib/crypto/encryption";
import { OdooClient } from "@/lib/odoo/client";

/**
 * POST /api/odoo/test — authenticate against Odoo to verify creds (OWNER only).
 * Uses the submitted creds; if the API key is blank, falls back to the stored one
 * so the user can re-test a saved connection without re-typing the key.
 */
export async function POST(req: NextRequest) {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  if (auth.membership.role !== "OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    baseUrl?: string;
    database?: string;
    username?: string;
    apiKey?: string;
  };
  let { baseUrl, database, username, apiKey } = body;
  if (!apiKey) {
    const c = await prisma.odooConnection.findUnique({ where: { tenantId: tenant.id } });
    if (c) {
      baseUrl = baseUrl || c.baseUrl;
      database = database || c.database;
      username = username || c.username;
      apiKey = decrypt(c.apiKey);
    }
  }
  if (!baseUrl || !database || !username || !apiKey) {
    return NextResponse.json({ ok: false, error: "Missing URL / database / username / API key" }, { status: 400 });
  }

  try {
    const uid = await new OdooClient({ baseUrl, database, username, apiKey }).authenticate();
    return NextResponse.json({ ok: true, uid });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message });
  }
}

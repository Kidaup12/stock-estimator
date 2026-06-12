import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { computeCatalogFlags } from "@/lib/qb/catalog-flags";

export const maxDuration = 120;

/**
 * POST /api/qb/catalog — system endpoint for the n8n "QuickBooks catalogue feed".
 * Auth: `Authorization: Bearer <QB_FEED_SECRET>` (no user session). The feed is the
 * authoritative list of QB products, already matched to Shopify SKUs upstream.
 * Marks matched products active (+qbMatchedAt), soft-deactivates Shopify products
 * absent from the feed (unless owner-pinned), and records a QbSyncRun. Never
 * deletes; stock level has no effect on membership.
 */
const Body = z.object({
  slug: z.string().min(1),
  rows: z
    .array(
      z.object({
        sku: z.string(),
        qbName: z.string().optional(),
        qtyOnHand: z.number().optional(),
        cost: z.number().optional(),
        matchConfidence: z.number().optional(),
      })
    )
    .max(20000),
  weak: z.number().int().nonnegative().optional(),
});

export async function POST(req: NextRequest) {
  const secret = process.env.QB_FEED_SECRET;
  const authz = req.headers.get("authorization");
  if (!secret || authz !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { slug, rows, weak = 0 } = parsed.data;

  // eslint-disable-next-line tenant-safety/require-tenant-scope -- system feed resolves the tenant by slug + bearer secret
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (!tenant) return NextResponse.json({ error: "unknown shop" }, { status: 404 });

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, sku: true, source: true, active: true, activeOverride: true },
  });

  const { activate, deactivate, aborted, counts } = computeCatalogFlags(
    products,
    rows.map((r) => r.sku)
  );

  if (!aborted) {
    // Two batched writes — never a per-row loop (Vercel→Supabase timeout rule).
    if (activate.length) {
      await prisma.product.updateMany({
        where: { tenantId: tenant.id, id: { in: activate } },
        data: { active: true, qbMatchedAt: new Date() },
      });
    }
    if (deactivate.length) {
      await prisma.product.updateMany({
        where: { tenantId: tenant.id, id: { in: deactivate } },
        data: { active: false },
      });
    }
  }

  const run = await prisma.qbSyncRun.create({
    data: {
      tenantId: tenant.id,
      matched: counts.matched,
      flagged: counts.flagged,
      weak,
      totalProducts: products.length,
      aborted,
    },
  });

  return NextResponse.json({
    ok: !aborted,
    aborted,
    matched: counts.matched,
    flagged: counts.flagged,
    weak,
    totalProducts: products.length,
    runId: run.id,
    ...(aborted
      ? { warning: "Feed would flag >60% of the catalogue — treated as partial/broken. No changes applied." }
      : {}),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { ShopifyClient } from "@/lib/shopify/client";
import { z } from "zod";

const schema = z.object({
  shopifyDomain: z.string().min(1),
  shopifyAccessToken: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  try {
    const client = new ShopifyClient({
      domain: parsed.data.shopifyDomain,
      accessToken: parsed.data.shopifyAccessToken || null,
    });
    const info = await client.testConnection();
    return NextResponse.json(info);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/tenant/slug";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1),
  shopifyDomain: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  // Pre-membership: the user is authenticated but has no tenant yet, so this
  // cannot use requireTenant(). Resolve the session user directly.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { name, shopifyDomain } = parsed.data;

  // Sanctioned pre-membership tenant lookup for slug-collision handling. This is
  // the onboarding exemption in Plan 06's tenant-safety ESLint allow-list
  // (app/api/onboarding/route.ts) — it runs before the user has any membership.
  let slug = slugify(name);
  let attempt = await prisma.tenant.findUnique({ where: { slug } });
  while (attempt) {
    slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;
    attempt = await prisma.tenant.findUnique({ where: { slug } });
  }

  const tenant = await prisma.tenant.create({
    data: {
      name,
      slug,
      shopifyDomain: shopifyDomain || "",
      currency: "KES",
      // timezone uses the schema default (Africa/Nairobi)
    },
  });

  await prisma.membership.create({
    data: { userId: user.id, tenantId: tenant.id, role: "OWNER" },
  });

  return NextResponse.json({ slug: tenant.slug });
}

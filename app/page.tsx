import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

/**
 * Membership-aware root redirect (D-09):
 *  - unauthenticated      -> /login
 *  - 0 memberships        -> /onboarding (create your shop)
 *  - >=1 membership       -> /shop/[slug]/dashboard (first; multi-tenant picker deferred)
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // User-scoped lookup (filtered by the session user's id) — the sanctioned
  // pattern; not a cross-tenant query.
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { tenant: true },
    orderBy: { createdAt: "asc" },
  });

  if (memberships.length === 0) redirect("/onboarding");
  redirect(`/shop/${memberships[0].tenant.slug}/dashboard`);
}

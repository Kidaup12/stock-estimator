import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

/**
 * Typed tenant-resolution error. `.status` maps directly to the HTTP response:
 * 401 (no session), 403 (no membership), 404 (no/unknown slug).
 */
export class TenantError extends Error {
  constructor(
    public status: 401 | 403 | 404,
    message: string
  ) {
    super(message);
    this.name = "TenantError";
  }
}

/**
 * The ONLY sanctioned way to resolve + authorize the current tenant in app routes
 * (TNT-02). Reads the Supabase session, resolves the tenant by slug (from `slugArg`
 * for RSC layouts, or the `x-tenant-slug` header injected by middleware for API
 * routes), and verifies the user has a Membership for it.
 *
 * This file is the allow-listed home of `prisma.tenant.findUnique` — every other
 * tenant lookup must go through here (enforced by the tenant-safety ESLint rule).
 */
export async function requireTenant(slugArg?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new TenantError(401, "Unauthorized"); // AUTH-05

  const h = await headers();
  const slug = slugArg ?? h.get("x-tenant-slug") ?? "";
  if (!slug) throw new TenantError(404, "No tenant");

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new TenantError(404, "Tenant not found");

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
  });
  if (!membership) throw new TenantError(403, "Forbidden"); // TNT-01

  return { tenant, membership, userId: user.id };
}

export type TenantContext = Awaited<ReturnType<typeof requireTenant>>;

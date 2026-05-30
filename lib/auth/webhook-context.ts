import { prisma } from "@/lib/prisma";

/**
 * The ONLY sanctioned non-session tenant resolver (D-11).
 *
 * Webhooks have no Supabase session; the source domain (Shopify) or realmId
 * (QuickBooks) IS the tenant key. This file is allow-listed by the tenant-safety
 * ESLint rule precisely because it must look a tenant up by an external key
 * without a session — do NOT use these from session-backed app routes (use
 * requireTenant() there).
 *
 * Phase 2 ships the placeholders; Phase 3 (Shopify) and Phase 4 (QuickBooks)
 * fill in the webhook handlers that call them.
 */

/** Resolve a tenant from a Shopify shop domain (e.g. "beautysquareke.co"). */
export async function resolveTenantByDomain(domain: string) {
  // TODO(Phase 3): add `shopifyDomain @unique` to the Tenant model and switch to
  // findUnique. Until then findFirst is correct (one tenant per domain in practice).
  return prisma.tenant.findFirst({ where: { shopifyDomain: domain } });
}

/** Resolve a tenant from a QuickBooks realmId. */
export async function resolveTenantByRealmId(realmId: string) {
  // TODO(Phase 4): QuickBooksConnection.realmId @unique -> resolve via that relation.
  void realmId;
  return null;
}

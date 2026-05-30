// Deliberately-violating fixture — proves the tenant-safety rule fires.
// NOT part of the app build; lint it explicitly:
//   npx eslint --no-config-lookup ... (see Task verify) or the targeted run.
// @ts-nocheck
import { prisma } from "@/lib/prisma";

export async function bareFindMany() {
  // VIOLATION: findMany without a tenantId filter.
  return prisma.product.findMany();
}

export async function bareTenantLookup() {
  // VIOLATION: bare prisma.tenant.findFirst.
  return prisma.tenant.findFirst();
}

export async function scopedOk(tenantId: string) {
  // OK: filtered by tenantId — must NOT be reported.
  return prisma.product.findMany({ where: { tenantId } });
}

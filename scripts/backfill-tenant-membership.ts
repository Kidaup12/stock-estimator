/**
 * backfill-tenant-membership.ts
 *
 * One-shot: bind an OWNER Membership for a Supabase user UUID to an existing
 * tenant (default: Beauty Square, slug "beauty-square"). Without this, the
 * pre-existing seeded tenant has no membership, so requireTenant() would 403 the
 * owner out of their own 1,023-product dataset (D-15).
 *
 * The Supabase UUID only exists AFTER the user signs in once via the magic-link
 * flow (/login). Get it from Supabase Dashboard -> Authentication -> Users.
 *
 * Run:
 *   OWNER_USER_ID=<uuid> npx tsx scripts/backfill-tenant-membership.ts
 *   # PowerShell:
 *   $env:OWNER_USER_ID="<uuid>"; npx tsx scripts/backfill-tenant-membership.ts
 *
 * Optional: OWNER_TENANT_SLUG (default "beauty-square"). Idempotent.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const userId = process.env.OWNER_USER_ID;
  const slug = process.env.OWNER_TENANT_SLUG ?? "beauty-square";

  if (!userId) {
    console.error(
      [
        "ERROR: OWNER_USER_ID is not set.",
        "",
        "How to get it:",
        "  1. Sign in once at http://localhost:3082/login (magic link) to create your Supabase user.",
        "  2. Supabase Dashboard -> Authentication -> Users -> copy your user UUID.",
        "  3. Re-run:",
        "       OWNER_USER_ID=<uuid> npx tsx scripts/backfill-tenant-membership.ts",
        "     (PowerShell: $env:OWNER_USER_ID=\"<uuid>\"; npx tsx scripts/backfill-tenant-membership.ts)",
      ].join("\n")
    );
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    console.error(`ERROR: no tenant with slug "${slug}". Set OWNER_TENANT_SLUG or seed the tenant first.`);
    process.exit(1);
  }

  const membership = await prisma.membership.upsert({
    where: { userId_tenantId: { userId, tenantId: tenant.id } },
    create: { userId, tenantId: tenant.id, role: "OWNER" },
    update: {}, // idempotent — re-running changes nothing
  });

  console.log(
    `OK: ${membership.role} membership bound — user ${userId} -> tenant "${tenant.name}" (slug=${tenant.slug}, id=${tenant.id}).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

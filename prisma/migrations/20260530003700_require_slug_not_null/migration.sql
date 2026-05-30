-- Make Tenant.slug required now that every row has a slug (backfilled in the
-- previous migration). This ALTER succeeds because no NULLs remain.
-- AlterTable
ALTER TABLE "Tenant" ALTER COLUMN "slug" SET NOT NULL;

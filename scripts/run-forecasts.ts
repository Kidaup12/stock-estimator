import { PrismaClient } from "@prisma/client";
import { runForecastsForTenant } from "../lib/forecast/run-batch";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.findFirst({ select: { id: true, timezone: true } });
  if (!tenant) throw new Error("No tenant — seed first");
  const { created, forecastRunId } = await runForecastsForTenant(tenant.id, tenant.timezone);
  console.log(`Done. ${created} forecasts created. forecastRunId=${forecastRunId}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

/**
 * Deterministic "latest forecast run" resolution.
 *
 * runDate is day-truncated (tenantTodayUtc), so several runs can share the same
 * runDate — manual re-runs, the cron, and (historically) runs truncated by
 * Vercel's maxDuration. Picking `findFirst orderBy runDate desc` returned an
 * ARBITRARY run among those, which made dashboard/planner numbers flip between
 * page loads and let partial runs win.
 *
 * Rule: latest runDate, then the MOST COMPLETE run of that day (highest
 * prediction count), tie-broken by forecastRunId for stability.
 */
import { prisma } from "@/lib/prisma";

export async function latestForecastRunId(tenantId: string): Promise<string | null> {
  const latest = await prisma.prediction.findFirst({
    where: { tenantId },
    orderBy: { runDate: "desc" },
    select: { runDate: true },
  });
  if (!latest) return null;

  const runs = await prisma.prediction.groupBy({
    by: ["forecastRunId"],
    where: { tenantId, runDate: latest.runDate },
    _count: { _all: true },
  });
  runs.sort(
    (a, b) => b._count._all - a._count._all || a.forecastRunId.localeCompare(b.forecastRunId)
  );
  return runs[0]?.forecastRunId ?? null;
}

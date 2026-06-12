import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runBacktestForTenant } from "@/lib/backtest/run";
import { accuracyDropped, accuracyDropMessage } from "@/lib/monitor/accuracy";
import { findSalesGaps } from "@/lib/monitor/sales-gaps";
import { sendEmail } from "@/lib/email/send";

export const maxDuration = 300;

/**
 * GET /api/cron/backtest — monthly self-check (G6/G7). Auth: Bearer CRON_SECRET.
 * For each tenant: run the holdout backtest (stores a BacktestRun), then alert on
 * (a) accuracy dropping vs the prior run, (b) gaps in sales data (the May-hole).
 * Alerts email ALERT_EMAIL when set; otherwise they're returned + logged only.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const alertTo = process.env.ALERT_EMAIL;
  // System cron: deliberately iterates EVERY tenant (no tenant scope by design).
  // eslint-disable-next-line tenant-safety/require-tenant-scope -- all-tenant system job
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });

  const results: Array<Record<string, unknown>> = [];
  for (const t of tenants) {
    try {
      const prior = await prisma.backtestRun.findFirst({
        where: { tenantId: t.id },
        orderBy: { runDate: "desc" },
      });
      const metrics = await runBacktestForTenant(t.id);

      const salesDates = await prisma.salesHistory.findMany({
        where: { tenantId: t.id },
        select: { date: true },
      });
      const gaps = findSalesGaps(salesDates.map((s) => s.date));

      const alerts: string[] = [];
      if (prior && accuracyDropped(metrics.mae, prior.mae)) {
        alerts.push(accuracyDropMessage(metrics.mae, prior.mae));
      }
      if (gaps.totalMissingDays > 0) {
        alerts.push(`Sales-data gaps: ${gaps.totalMissingDays} missing day(s) across ${gaps.gaps.length} run(s).`);
      }
      if (alerts.length > 0) {
        console.warn(`[self-check] ${t.name}:`, alerts.join(" "));
        if (alertTo) {
          await sendEmail({ to: alertTo, subject: `[Wezesha] ${t.name}: forecast health alert`, text: alerts.join("\n") });
        }
      }
      results.push({ tenantId: t.id, ok: true, metrics, alerts });
    } catch (err) {
      results.push({ tenantId: t.id, ok: false, error: (err as Error).message });
    }
  }
  return NextResponse.json({ ok: true, tenants: results.length, results });
}

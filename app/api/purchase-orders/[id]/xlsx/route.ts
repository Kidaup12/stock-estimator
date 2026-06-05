import { NextRequest, NextResponse } from "next/server";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";
import { getPurchaseOrder } from "@/lib/po/service";
import { renderPoXlsx } from "@/lib/po/xlsx";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantOrResponse();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const po = await getPurchaseOrder(ctx.tenant.id, id);
  if (!po) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const buf = await renderPoXlsx(po);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${po.poNumber}.xlsx"`,
    },
  });
}

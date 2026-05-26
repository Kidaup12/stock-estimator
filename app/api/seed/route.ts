import { NextResponse } from "next/server";
import { seed } from "@/scripts/seed-from-beautysquare";
import { synth } from "@/scripts/synth-sales-history";

export const maxDuration = 300;

export async function POST() {
  try {
    const seedResult = await seed();
    await synth();
    return NextResponse.json({ ok: true, productsSeeded: seedResult.count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Seed failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

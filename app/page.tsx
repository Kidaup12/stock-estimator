import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  let tenant = null;
  let productCount = 0;
  let predictionCount = 0;
  try {
    tenant = await prisma.tenant.findFirst();
    if (tenant) {
      productCount = await prisma.product.count({ where: { tenantId: tenant.id } });
      predictionCount = await prisma.prediction.count({ where: { tenantId: tenant.id } });
    }
  } catch {
    // DB not reachable (e.g. Vercel read-only FS without DATABASE_URL set to Postgres) — render the empty-state CTA.
  }

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-xs font-mono uppercase tracking-widest text-pink-600 dark:text-pink-400">Beauty stock OS</div>
        <h1 className="text-4xl font-bold mt-2 text-zinc-900 dark:text-zinc-100">Stock Estimator</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          AI-powered demand forecasting for Kenyan beauty shops. Connects to Shopify, learns from your sales,
          and tells you what to reorder before you run out.
        </p>

        <div className="mt-8 grid gap-4">
          {tenant ? (
            <>
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm text-zinc-500">Connected shop</div>
                    <div className="font-semibold text-lg">{tenant.name}</div>
                    <div className="text-xs text-zinc-500 mt-1">{tenant.shopifyDomain} · {tenant.currency}</div>
                    <div className="text-xs text-zinc-500 mt-2">
                      {productCount} products · {predictionCount} active forecasts
                    </div>
                  </div>
                  <Link href="/onboarding" className="text-sm text-blue-600 hover:underline">Reconfigure</Link>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Link href="/dashboard" className="rounded-lg border-2 border-blue-600 bg-blue-600 hover:bg-blue-700 text-white p-5 text-center font-semibold transition">
                  Dashboard
                </Link>
                <Link href="/suppliers" className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 p-5 text-center font-medium transition">
                  Suppliers
                </Link>
                <Link href="/promos" className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 p-5 text-center font-medium transition">
                  Promo Calendar
                </Link>
                <Link href="/onboarding" className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 p-5 text-center font-medium transition">
                  Sync & Forecast
                </Link>
              </div>
            </>
          ) : (
            <Link href="/onboarding" className="rounded-lg border-2 border-blue-600 bg-blue-600 hover:bg-blue-700 text-white p-6 text-center font-semibold transition">
              Get Started — Connect Your Shopify Store
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}

# Stock Estimator — Beauty (Kenya)

AI demand forecasting for Kenyan beauty/skincare/fragrance shops on Shopify.

- Pulls catalog + sales from Shopify (currently **mock mode** scraping `beautysquareke.co`)
- Generates 365 days of synthetic sales calibrated to Kenya patterns (payday weeks, Jamhuri, Christmas, V-Day, Eid)
- Layered forecast: **Layer 1 (SARIMA mock) + Layer 2 (XGBoost mock)** with explainable signals
- Safety stock via King's formula (accounts for variable lead times from Guangzhou/Dubai)
- Promo calendar + supplier setup for the inputs that actually move the needle

## Stack

Next.js 15 · Prisma · SQLite (local) / Postgres (prod) · Tailwind v4 · TypeScript

The two model layers (SARIMA + XGBoost) are currently **simulated in TypeScript** so the dashboard can be built and demoed without a Python service. The real Python sidecar (statsmodels + xgboost) is the next milestone — `lib/forecast/simulate-layers.ts` returns the same JSON shape a real service will produce, so swap is a one-file change.

## Local dev

```bash
npm install
npx prisma db push
npm run dev
```

Open [http://localhost:3000/onboarding](http://localhost:3000/onboarding), leave the access token blank for mock mode, click "Seed catalog" → "Generate forecasts".

## Deploy to Vercel

The bundled `prisma/dev.db` lets the deployment serve pages, but Vercel's filesystem is read-only at runtime — any seed/forecast/promo write will fail. For a working production deploy, switch to Postgres:

1. Provision a database (Vercel Postgres, Neon free tier, etc.)
2. Set `DATABASE_URL` in Vercel project settings to the Postgres connection string
3. Change `prisma/schema.prisma`: `provider = "postgresql"`
4. `npx prisma db push` against the new database

## Project layout

```
app/
  api/              Shop, seed, forecast, products, suppliers, promos, orders
  dashboard/        Urgent + Review + All tabs, product drill-down
  onboarding/       3-step Shopify connect + seed + forecast
  suppliers/        Supplier CRUD with lead-time + MOQ
  promos/           Promo calendar CRUD (payday, holiday, flash, GWP)
lib/
  shopify/          Mock Shopify client (real impl noted on each method)
  forecast/         Baseline math + Layer 1/2 simulator
  seed/             Kenya holiday + payday calendar helpers
scripts/
  seed-from-beautysquare.ts   Scrapes beautysquareke.co Shopify JSON
  synth-sales-history.ts      365-day synthetic sales with Kenya patterns
prisma/schema.prisma          Tenant, Product, SalesHistory, Prediction (layered), Supplier, Promo, Order
```

## Roadmap

- Milestone 2: real Shopify OAuth + Python FastAPI service (statsmodels SARIMA + XGBoost residual)
- Milestone 3: multi-channel sales aggregation (WhatsApp/IG/retail), M-Pesa billing
- Milestone 4: Live FX, Google Trends Kenya, weather signals

# Wezesha Restock OS — Beauty (Kenya)

AI demand forecasting for Kenyan beauty/skincare/fragrance shops on Shopify.

- Pulls catalog + sales from Shopify (currently **mock mode** scraping `beautysquareke.co`)
- Generates 365 days of synthetic sales calibrated to Kenya patterns (payday weeks, Jamhuri, Christmas, V-Day, Eid)
- Layered forecast: **Layer 1 (SARIMA mock) + Layer 2 (XGBoost mock)** with explainable signals
- Safety stock via King's formula (accounts for variable lead times from Guangzhou/Dubai)
- Promo calendar + supplier setup for the inputs that actually move the needle

## Stack

Next.js 16 · Prisma 6 · Postgres · Tailwind v4 · TypeScript

The two model layers (SARIMA + XGBoost) are currently **simulated in TypeScript** so the dashboard can be built and demoed without a Python service. The real Python sidecar (statsmodels + xgboost) is a later milestone — `lib/forecast/simulate-layers.ts` returns the same JSON shape a real service will produce, so the swap is a one-file change.

## Local dev

You need Docker (for local Postgres) or your own Supabase project.

```bash
docker compose up -d db
cp .env.example .env
# Edit .env: set DATABASE_URL + DIRECT_URL (see .env.example for shapes)
#   Local default:
#     DATABASE_URL="postgresql://wezesha:wezesha_dev@localhost:5433/wezesha?schema=public"
#     DIRECT_URL="postgresql://wezesha:wezesha_dev@localhost:5433/wezesha?schema=public"
npm install
npm run db:migrate
npm run seed
npm run dev
```

Open [http://localhost:3082/settings](http://localhost:3082/settings), leave the access token blank for mock mode, click **Seed catalog** → **Generate forecasts**, then jump to [/dashboard](http://localhost:3082/dashboard).

## Deploy to Vercel

1. Provision a Postgres database (Supabase Postgres, Vercel Postgres, or Neon).
2. In Vercel project settings, set **both** env vars **before the first deploy**:
   - `DATABASE_URL` — runtime pooler URL. For Supabase, port `6543`, transaction mode, with `?pgbouncer=true&connection_limit=1` query string.
   - `DIRECT_URL` — direct connection URL on port `5432`. Required by `prisma migrate deploy` during build.
3. Deploy. The `build` script chains `prisma generate && prisma migrate deploy && next build`, so the schema is migrated on every deploy.
4. (Optional) Run `npm run seed` against the production DB to populate Beauty Square demo data.

## Project layout

```
app/
  api/              Shop, seed, forecast, products, suppliers, promos, orders
  dashboard/        Urgent + Review + All tabs, product drill-down
  settings/         Shopify connect + seed + forecast (single-screen onboarding)
  suppliers/        Supplier CRUD with lead-time + MOQ
  promos/           Promo calendar CRUD (payday, holiday, flash, GWP)
lib/
  shopify/          Mock Shopify client (real impl noted on each method)
  forecast/         Baseline math + Layer 1/2 simulator
  seed/             Kenya holiday + payday calendar helpers
scripts/
  seed-from-beautysquare.ts   Scrapes beautysquareke.co Shopify JSON
  synth-sales-history.ts      365-day synthetic sales with Kenya patterns
prisma/
  schema.prisma               Tenant, Product, SalesHistory, Prediction, Supplier, Promo, Order
  migrations/                 Real migration history via prisma migrate
```

## Roadmap

- Milestone 2: real Shopify OAuth + Python FastAPI service (statsmodels SARIMA + XGBoost residual)
- Milestone 3: multi-channel sales aggregation (WhatsApp/IG/retail), M-Pesa billing
- Milestone 4: Live FX, Google Trends Kenya, weather signals

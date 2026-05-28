# Coding Conventions

**Analysis Date:** 2026-05-28

## TypeScript Style

**Strict mode:** Enabled. `tsconfig.json` sets `"strict": true` with `"isolatedModules": true`, `"esModuleInterop": true`, `"moduleResolution": "bundler"`, `target: ES2017`.

**Path alias:** Single alias `@/*` → repo root (`tsconfig.json` lines 25-28). All cross-module imports go through it: `import { prisma } from "@/lib/prisma"`, `import { ShopifyClient } from "@/lib/shopify/client"`. Relative imports (`./baseline`) are only used inside the same `lib/forecast/` folder (see `lib/forecast/simulate-layers.ts:11`).

**`any` / `unknown`:** Effectively zero usage. Grep for `: any`, `as any`, `: unknown` returned no hits across `app/`, `lib/`, `scripts/`. Errors in catch blocks are narrowed via `e instanceof Error` (see `app/api/shop/test/route.ts:25`, `app/api/seed/route.ts:13`) rather than `(e as any).message`. Maintain this — do not introduce `any`.

**`type` vs `interface`:** Codebase exclusively uses `type` aliases, even for object shapes. Examples:
- `app/dashboard/page.tsx:7` — `type Signal = { label: string; deltaPct: number; emoji: string };`
- `lib/forecast/simulate-layers.ts:13` — `export type ActivePromo = { ... }`
- `lib/shopify/client.ts:3` — `export type ShopifyConfig = { ... }`

No `interface` keyword found. Stay with `type`.

**Type-only imports:** Used sparingly and only for true type-only references:
- `app/layout.tsx:1` — `import type { Metadata } from "next";`
- `next.config.ts:1` — `import type { NextConfig } from "next";`
- Inline form preferred when mixed: `import { simulateLayeredForecast, type ActivePromo } from "@/lib/forecast/simulate-layers"` (`app/api/forecast/run/route.ts:3`).

**Inline type annotations:** Function parameter types are inlined in JSX components rather than declared above, e.g. `function Kpi({ label, value, hint, tone = "default" }: { label: string; value: string; hint?: string; tone?: "default" | "warn" | "alarm" })` (`app/dashboard/page.tsx:257`). Don't bother extracting a `KpiProps` type unless the component is exported or reused.

**String literal unions:** Preferred over enums everywhere. Examples: `"critical" | "high" | "medium" | "low"` (`lib/forecast/baseline.ts:50`), `"reorder" | "stockout" | "dead" | "all"` (`app/dashboard/page.tsx:65`).

## Naming Patterns

**Files:**
- App routes / pages: lowercase, kebab-case for multi-word segments (`monthly-context/`, `demand-shock/`, `[id]/approve/`). Single-word folders stay lowercase (`forecast`, `promos`, `simulate`).
- React page files: always `page.tsx` (Next.js convention).
- API route files: always `route.ts`.
- Library modules: kebab-case (`simulate-layers.ts`, `kenya-calendar.ts`).
- Scripts: kebab-case verb-first (`seed-from-beautysquare.ts`, `synth-sales-history.ts`, `backfill-costs.ts`, `run-forecasts.ts`).

**Components:** PascalCase function declarations colocated inside the page file, not extracted to `components/`. See `app/dashboard/page.tsx` — `Kpi`, `TabBtn`, `ReorderCard`, `Mini`, `DeadStockTable`, `AllTable` all live at the bottom of `page.tsx`. No `components/` directory exists. New small UI helpers should follow this pattern: declare in the consuming page file. Extract to a shared module only when reused across pages.

**Functions:** camelCase. Pure helpers in `lib/forecast/baseline.ts`: `weightedDailyRate`, `kingsSafetyStock`, `reorderPoint`, `urgencyFromDays`, `zForServiceLevel`.

**Variables:** camelCase. `const reorderCostKes = ...`, `const filtered = predictions.filter(...)`.

**Money fields:** Always suffixed `Kes` (e.g. `priceKes`, `costKes`, `reorderCostKes`, `selectedRevenueKes`). This is a hard convention — Prisma fields and API responses both follow it. New monetary values MUST use the `Kes` suffix.

**Constants:** SCREAMING_SNAKE_CASE for module-level lookup tables: `URGENCY_WEIGHT` (`app/api/simulate/budget/route.ts:9`), `SUPPLIERS` (`scripts/seed-suppliers.ts:18`).

## React Patterns

**Default = Server Component.** Pages that only read data and render markup do not declare `"use client"`. Example: `app/layout.tsx`, `app/page.tsx` (uses `redirect()`). API routes are server-only by definition.

**Client Components are opt-in via `"use client"` at line 1.** Every interactive page in this app is currently a client component because they all use `useState` + `useEffect` to fetch from `/api/*` on mount:
- `app/dashboard/page.tsx:1`
- `app/promos/page.tsx`
- `app/reports/page.tsx`
- `app/settings/page.tsx`
- `app/simulate/page.tsx`
- `app/suppliers/page.tsx`
- `app/contact/page.tsx`
- `app/dashboard/product/[id]/page.tsx`

**The convention is: route handlers do all the data work, pages are client-side fetchers.** Do not introduce RSC `await prisma.…` directly in `page.tsx` files — break the existing pattern explicitly if you do.

**Data fetching from client pages:**
```typescript
async function load() {
  setLoading(true);
  const res = await fetch("/api/forecast");
  const data = await res.json();
  setPredictions(data.predictions || []);
  setLoading(false);
}
useEffect(() => { load(); }, []);
```
(`app/dashboard/page.tsx:76-85`). Note: no SWR, no React Query, no error toasts — just `fetch` + `useState` + fallback to `|| []`. No client-side caching layer.

**Mutations:** Plain `fetch("/api/...", { method: "POST" })` followed by re-running `load()`. See `rerun()` in `app/dashboard/page.tsx:87-92`.

**No global state.** No Context, Redux, Zustand. Each page owns its state.

**Image handling:** `next/image` is NOT used — pages fall back to `<img>` with an inline ESLint disable: `/* eslint-disable-next-line @next/next/no-img-element */` (`app/dashboard/page.tsx:294`). This is intentional given Shopify CDN remotePatterns are configured but image transforms aren't needed. Match this style when rendering product images.

## API Route Conventions

**Imports order (observed):**
1. `next/server` (`NextRequest`, `NextResponse`)
2. `@/lib/...` (Prisma, helpers)
3. `zod`
4. Local relative

**Handler signatures:**
- `GET`: no params or `(req: NextRequest)` if reading query string.
- `POST` / `PATCH` / dynamic: `(req: NextRequest, { params }: { params: Promise<{ id: string }> })`. **Note `params` is a Promise** in Next 16 — always `await params` first (`app/api/orders/[id]/approve/route.ts:5`, `app/api/products/[id]/route.ts:5`). Use `_req` when the request object is unused (`app/api/orders/[id]/approve/route.ts:4`).

**Multi-tenant guard pattern (universal):** Every handler starts with
```typescript
const tenant = await prisma.tenant.findFirst();
if (!tenant) return NextResponse.json({ error: "No tenant" }, { status: 400 });
// or for read endpoints that should degrade gracefully:
if (!tenant) return NextResponse.json({ products: [] });
```
See `app/api/products/route.ts:5-6`, `app/api/forecast/route.ts:5-6`, `app/api/forecast/run/route.ts:23-24`, `app/api/promos/route.ts:18-19`. Reads return empty collections; writes return `400 No tenant`. Maintain this split.

**Query params:** Parsed via `new URL(req.url).searchParams.get(...)` — no helper. See `app/api/products/route.ts:8-10`.

**Long-running routes:** Declare `export const maxDuration = N;` at top level. Examples: `app/api/forecast/run/route.ts:5` (`120`), `app/api/seed/route.ts:5` (`300`). Use this for any forecast/seed/batch endpoint that may exceed Vercel's default 10s.

## Zod Validation

**Used in 7 of ~15 mutating routes** — present where bodies have multiple fields, absent on simple toggles like `app/api/orders/[id]/approve/route.ts`.

**Pattern: `safeParse` (never `parse`).** Every usage gates on `.success`:
```typescript
const schema = z.object({
  budgetKes: z.number().positive(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { budgetKes } = parsed.data;
  // ...
}
```
(`app/api/simulate/budget/route.ts:5-20`).

**Error detail level varies:**
- Most routes return only `{ error: "Invalid input" }` (`app/api/shop/route.ts:27`, `app/api/simulate/budget/route.ts:19`, `app/api/shop/test/route.ts:14`).
- `app/api/promos/route.ts:33` returns `{ error: "Invalid input", details: parsed.error.flatten() }`.
- **Convention: include `details: parsed.error.flatten()` going forward** so the UI can surface field-level messages. Add to existing routes opportunistically.

**Schema location:** Declared as module-level `const schema = z.object({...})` directly above the handler. No `schemas/` folder, no shared validation module.

**Common validators seen:** `z.string().min(1)`, `z.number().positive()`, `z.number().min(0).max(100)`, `z.enum([...])`, `z.string().optional().nullable()`. Use `.nullable()` whenever the DB column is nullable so updates can clear values.

## Error Handling in API Routes

**Three patterns observed, in order of preference:**

1. **Guard + early return (most common).** No try/catch. Validate via zod or null-check, return `NextResponse.json({ error: "..." }, { status: 400 | 404 })`.

2. **try/catch only when calling external/IO that can throw unpredictably.** Used only in `app/api/shop/test/route.ts:17-27` (Shopify client) and `app/api/seed/route.ts:8-15` (script invocation). Pattern:
```typescript
try {
  // work
  return NextResponse.json({ ok: true, ... });
} catch (e) {
  const msg = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: msg }, { status: 400 });
}
```
`e instanceof Error` narrowing is mandatory — do not cast to `any`.

3. **`.catch(() => fallback)` for tolerant body parsing.** `app/api/products/[id]/route.ts:92` — `const body = await req.json().catch(() => ({}));` for PATCH endpoints where missing body is acceptable.

**No global error handler / middleware.** No `error.tsx` files exist. If a Prisma query throws, the route 500s with default Next.js handling.

**Success envelope:** Either `{ ok: true, <data> }` (mutations: `app/api/orders/[id]/approve/route.ts:17`, `app/api/forecast/run/route.ts:136`, `app/api/seed/route.ts:11`) or `{ <resource>: ... }` (reads: `{ products: [...] }`, `{ promos: [...] }`, `{ predictions: [...] }`). Don't introduce a different envelope.

## Logging

**Framework:** None. Plain `console.log` / `console.error`.

**Where logging exists:** Only in `scripts/*.ts` (22 calls across 5 scripts) — used for progress reporting during seed/backfill. Routes do NOT log. Example: `scripts/run-forecasts.ts:29` — `console.log(`Generating forecasts for ${products.length} products`);`.

**Guidance for new code:** Don't add `console.log` to API routes — it shows up in Vercel function logs as noise. Add it to scripts when iteration count matters.

## Prisma Patterns

**Singleton client:** `lib/prisma.ts` uses the standard `globalThis` cache to avoid connection storms in dev hot-reload:
```typescript
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```
Always import via `import { prisma } from "@/lib/prisma"` in route handlers. Scripts instantiate their own `new PrismaClient()` and `.finally(() => prisma.$disconnect())` (see `scripts/run-forecasts.ts:4` + `:129`).

**Parallel reads:** `Promise.all([...])` for multiple aggregations on the same request (`app/api/forecast/route.ts:17-37`). Use this when 2+ independent queries serve one response.

**Upsert pattern via findFirst + branch:** No `upsert()` calls — code reads with `findFirst`, then branches into `update` vs `create`:
```typescript
const existing = await prisma.tenant.findFirst();
const tenant = existing
  ? await prisma.tenant.update({ where: { id: existing.id }, data: {...} })
  : await prisma.tenant.create({ data: {...} });
```
(`app/api/shop/route.ts:31-39`, `app/api/promos/route.ts:42-44`).

**Conditional `where` spread:**
```typescript
where: {
  tenantId: tenant.id,
  ...(vendor ? { vendor } : {}),
  ...(productType ? { productType } : {}),
}
```
(`app/api/products/route.ts:12-17`). Use this for optional filters instead of `if`-building the where object.

**JSON columns:** `Prediction.signals` is `String` in SQLite and serialized manually: `JSON.stringify(result.signals)` on write (`app/api/forecast/run/route.ts:113`), `JSON.parse(prediction.signals || "[]")` on read (`app/api/products/[id]/route.ts:83`). Keep this idiom for any SQLite-side JSON.

## Code Style / Formatting

**Formatter:** Not detected. No `.prettierrc`, `.editorconfig`, or `biome.json`. Files are visibly consistent (2-space indent, double quotes, trailing semicolons, no trailing commas in single-line objects) but enforcement is by habit, not tooling. **Match the surrounding file style; do not run `prettier --write` blindly.**

**Linter:** ESLint flat config in `eslint.config.mjs` extending `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`. No custom rules added. Run via `npm run lint` (which calls `next lint`).

**Quotes:** Double quotes for strings and JSX attributes throughout.

**Semicolons:** Present at end of statements.

**Arrow vs function declarations:** Top-level page/route handlers use `function` declarations (`export default function Dashboard()`, `export async function POST(...)`). Inline callbacks and helpers use arrow functions (`predictions.map(p => ({...}))`). Local utility helpers can go either way — `currentMonth()` is a `function`, `KES` and `KESshort` are `const = (n) =>`.

## Comments

**JSDoc / TSDoc:** Not used. No `/** */` blocks found in source.

**Line comments mark intent, not behavior.** Examples:
- `// MOCK — real impl: GET /admin/api/2024-10/products.json?limit=250` (`lib/shopify/client.ts:48`) — flags that the function is a stub.
- `// Composite: urgency dominates, ROI breaks ties.` (`app/api/simulate/budget/route.ts:37`) — explains a scoring choice.
- `// Pass 1: always include critical` (`app/api/simulate/budget/route.ts:65`) — labels an algorithm step.
- `// Switch to Postgres in production and remove this.` (`next.config.ts:6`) — flags tech debt inline.

Prefer this style: short, opinionated, explains "why" or "TODO". Don't comment what the code already says.

## Module Design

**Exports:** Named exports throughout `lib/` (`export function ...`, `export type ...`). Default exports are used for React page components and route handlers because Next.js requires them.

**Barrel files:** None. No `index.ts` re-exports. Always import from the concrete file path: `@/lib/forecast/baseline`, not `@/lib/forecast`.

**Co-location:** Page-specific components live inside the page file. Forecast math lives in `lib/forecast/`. Shopify integration in `lib/shopify/`. Seed data in `lib/seed/`. Keep this shallow structure — don't introduce a `components/` directory until at least 2 pages share a component.

---

*Convention analysis: 2026-05-28*

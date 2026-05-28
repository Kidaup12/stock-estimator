# Feature Research — Stock Estimator (Inventory Demand Forecasting for SMB Retail)

**Domain:** Multi-tenant inventory demand-forecasting SaaS for Kenyan SMB retail (first tenant: Beauty Square — Shopify + QuickBooks).
**Researched:** 2026-05-28
**Confidence:** MEDIUM-HIGH (verified across ~15 SMB-focused inventory tools — Inventory Planner by Sage, Cogsy, Fabrikatör, Prediko, GMDH Streamline, Sumtracker, Forthcast, Assisty, Inventory Forecasting Hero, Verve AI, Stocky-replacements, Inventory Optimizer, Katana, Qoblex. Kenya/M-Pesa retail signals are MEDIUM confidence — search returned ecosystem context but not academic-grade payday-pattern studies; inferred from existing repo calendar logic plus general payment-cycle research.)

## Scope Note — What's Already Shipped (NOT re-researched)

Per `.planning/codebase/ARCHITECTURE.md`, the v0 baseline already has: Urgent/Review/All dashboard tabs, product drill-down, supplier CRUD with lead-time + MOQ, promo calendar CRUD, mock Shopify catalog, synthetic 365-day sales, mocked layered forecast, and auto-create `Order` rows on critical/high urgency. This research covers only the **upcoming work**: real Shopify ingest, real QuickBooks ingest, Python forecast accuracy, on-order quantity tracking, ABC tiering + overrides, multi-tenant hardening, and Kenya-specific signals.

---

## Feature Landscape

### Table Stakes (v1 Must-Have — Owner Abandons Without These)

Every SMB inventory forecasting tool surveyed (Inventory Planner, Cogsy, Fabrikatör, Prediko, IFH, Sumtracker, Assisty) ships these. Missing them = "this app is a toy."

| # | Feature | Why Expected | Complexity | Kenya/SMB twist |
|---|---------|--------------|------------|-----------------|
| TS-1 | **Real Shopify Admin API ingest (OAuth)** — products, variants, inventory levels, order history (1-2 yrs back) | Every competitor app starts here; mock data has zero forecasting value | **L** | Beauty Square's Shopify is the storefront but POS sales bypass it; design ingest so QB is allowed to overwrite Shopify rows where they overlap |
| TS-2 | **On-order / incoming PO quantity tracking** — `quantityOrdered`, `expectedArrivalAt`, `receivedAt` on Order; subtract on-order from reorder math | Without it, system double-orders every time a previous PO is in transit (current repo bug per CONCERNS.md §3.5) | **M** | Guangzhou/Dubai lead times are 30-60d; on-order overlap is the norm, not the exception. Must default-show pending Orders on the dashboard, not hide them |
| TS-3 | **Reorder report / "buy this now" CSV or PDF export** | Inventory Planner, Cogsy, Fabrikatör all surface "here's the PO to send today." Mary (Beauty Square owner) currently exports from QuickBooks to Excel — she needs the same artifact, prefilled. | **S** | Should group by supplier (one CSV per supplier so Mary can WhatsApp the Guangzhou agent one file, the Eastleigh distributor another). Currency mixed (USD/AED for international, KES for local). |
| TS-4 | **Days-of-cover / days-until-stockout (visible on every SKU)** | Already partially exists in repo (`urgencyFromDays`), but Inventory Planner, IFH, Verve AI all show it as a first-class column, not a derived urgency badge | **S** | Already in code — just elevate it to a sortable column on the dashboard |
| TS-5 | **Low-stock + stockout alerts (email or in-app)** | Every Shopify forecasting app does this. Owners don't log in daily. | **S** | Email is fine for v1 — adding WhatsApp/SMS is a v1.x ask given Kenya WhatsApp dominance. Skip M-Pesa alerts. |
| TS-6 | **Lost-sales estimate per SKU** ("you lost ~KES 18,400 on Cetaphil last month due to stockouts") | Hydrian, Pecan AI, Inventory Planner all surface this; it's the #1 "aha" metric that converts owners. Already partially in `app/api/reports/route.ts` per ARCHITECTURE.md | **M** | Method: average daily sales when in-stock × (number of stockout days × retail price). Repo already has the data; needs a dedicated card + per-SKU breakdown. |
| TS-7 | **Real QuickBooks Online ingest (OAuth)** — pull sales, inventory adjustments, COGS | For Beauty Square, QB is canonical (per PROJECT.md). Without it, Shopify-only forecasts will mis-state inventory by the percentage of POS sales. | **L** | QBO has its own multi-tenant OAuth pattern. Token refresh + encrypted-at-rest storage required for both Shopify and QB tokens. |
| TS-8 | **Forecast accuracy / actual-vs-predicted view** ("we predicted 42, you sold 38, accuracy 90%") | Verve AI, Prediko, Cogsy all show this. Without it, owners can't trust the model — and Roy can't tune it. | **M** | Requires keeping prediction history. CONCERNS.md §6.2: current code `deleteMany`s predictions every run. This must be fixed for v1 — store predictions immutably, append rather than wipe. |
| TS-9 | **Multi-tenant auth + per-tenant data isolation** | Anjay's standing rule, and prerequisite for any second client. Repo has the schema but breaks it via `findFirst()` in 12 routes (CONCERNS.md §4.2). | **L** | NextAuth v5 + session-bound `tenantId` resolution + middleware. Beauty Square is tenant #1; demo accounts will be tenant #2. |
| TS-10 | **Deterministic forecasts** (same inputs → same outputs) | Owners panic when "yesterday it said 60, today it says 54 on the same data." Both Inventory Planner and Prediko have stable per-day outputs. | **S** | Repo currently has `Math.random()` (CONCERNS.md §6.3). Replace with seeded noise or remove noise entirely. Required before real Python sidecar swap. |
| TS-11 | **Forecast explanation per SKU** ("60 units recommended because: payday week +60%, Christmas +150%, base trend −5%") | 2026 explainability research (Tredence, PowerMetrics): owner-led SMBs ignore black-box numbers. Repo has the `signals[]` shape; just needs UI surfacing. | **M** | Repo `Signal[]` (label/deltaPct/emoji) is exactly the right contract. Surface as a "Why this number?" expand panel on dashboard. Localize labels (Kenyan holiday names: Jamhuri, Mashujaa, Madaraka, Eid). |
| TS-12 | **Approve/Skip workflow with audit trail** | Repo has `pending/approved/skipped` Order states. Need `who approved + when + WHY skipped` (skip reason is critical for next forecast) | **S** | Repo has approve/skip; add `approvedBy: User`, mandatory skip reason field. Once auth lands, "user" becomes meaningful. |

### Differentiators (Worth Considering for v1 — Where Beauty Square Pays vs. Doesn't)

Not in every competitor; specifically valuable for the Kenya/SMB/beauty context. Each costs build time — call out which 2-3 are worth it for v1.

| # | Feature | Value Proposition | Complexity | Kenya/SMB twist | v1? |
|---|---------|-------------------|------------|-----------------|-----|
| D-1 | **Promo lift modeling** (Layer-2 signal already exists as mock) | Beauty Square runs Valentine's, Mother's Day, payday flash sales constantly. Without promo lift, forecasts catastrophically under-call promo weeks | **M** | Repo's `kenya-calendar.ts` already has the V-Day fragrance 3.0× / Mother's Day boost. The Python sidecar must learn from `Promo` rows, not hardcode. | **YES** — core to Core Value |
| D-2 | **Lead-time auto-tuning from PO actuals** (when ETA = 30d but actual was 47d, learn it) | Guangzhou suppliers slip routinely. Current `Supplier.leadTimeAvgDays` is owner-entered and goes stale. Lead-time variance feeds King's safety stock — staleness compounds. | **M** | This is the SMB-Kenya-specific win. Mary won't update lead-time fields manually; system must do it from `Order.receivedAt - Order.approvedAt`. Requires TS-2 (on-order tracking) first. | **YES** — moderate build, high payoff |
| D-3 | **Supplier scorecard** (OTIF %, lead-time variance, last 6 PO performance) | Mary needs to know "Guangzhou Beauty Imports has been late 4/6 last orders" to make sourcing decisions. SPS Commerce + retail-exec research shows 8-15 metrics is right floor for SMB. | **M** | Simplify to 3 metrics: on-time %, fill rate %, lead-time variance days. Don't try to do PPM defect tracking — Beauty Square doesn't have QA staff to log it. | **STRETCH** — depends on D-2 maturity |
| D-4 | **Slow-mover / dead-stock detection with liquidation suggestion** | Beauty inventory rots fast (skincare expiry, fragrance fashion cycles). Current dashboard has a "Dead" tab but no "what to do" action — Shopify, NetSuite, Omniful all recommend liquidation actions. | **M** | Beauty fashion cycle = ~90 days slow-moving threshold (vs 180d general retail). Action: "discount 30%", "bundle with X", "stop reordering" — not just flagging. | **YES** — small surface, high owner value |
| D-5 | **A/B/C tiering with manual override + lifecycle stages** | Repo has ABC heuristic but no override (CONCERNS.md §3.4) and no "new SKU" vs "EOL" awareness. New SKUs incorrectly get C-tier because they have low cumulative revenue. | **S** | Add `abcOverride: String?` + `lifecycleStage: NEW|MATURE|EOL` enum. NEW = forecast from category proxy, not own history. | **YES** — schema change + simple UI |
| D-6 | **Kenya payday-aware reorder timing** ("ship-by date is Nov 22 so stock lands Nov 24 — the start of payday week") | M-Pesa payday cycle (mid-month 13-16, end-of-month 25-31) is already in `kenya-calendar.ts`. But the *reorder timing* doesn't account for it — Mary wants stock to land BEFORE payday, not during | **S** | Adjust `reorderPoint` math to bias reorder dates +3-5 days earlier when projected arrival falls during payday week. Owner-visible message: "ship-by Nov 22 to catch the 25th payday surge". | **YES** — small math change, distinctive |
| D-7 | **Google Trends Kenya signal** (search interest for SKU / brand / category as Layer-2 input) | Google can predict retail demand up to 3 quarters ahead (Shopify research). For trend-driven beauty (K-beauty, TikTok-viral products), this is the difference between catching a wave vs missing it. | **L** | Free API but rate-limited. Geo: KE only. Match Shopify product_type and vendor to Trends keywords. Risk: noisy signal for low-volume SKUs; only use for A-tier and brand-level | **DEFER to v1.x** — high build cost, requires tuning. Validate base model first. |
| D-8 | **Weather signal** (skincare moisturizer demand vs humidity / temperature) | Beauty research shows "cooling care" rising with climate; Kenya has rainy/dry seasons that affect skincare buying | **L** | Nairobi weather has clear long-rains (Mar-May) / short-rains (Oct-Dec) cycles. But evidence is weak for direct beauty correlation in Kenya. Risk of overfitting. | **NO for v1** — speculative, prove base accuracy first |
| D-9 | **"Cash-flow aware" reorder budget allocator** | Repo already has `/api/simulate/budget` (greedy fill by urgency × margin × ROI). Surface this as a first-class workflow, not a hidden tool. SMBs are cash-constrained; "what should I buy with my KES 800K this week?" is THE question. | **S** | Already built — just elevate to main nav. Critical for Beauty Square where import financing is monthly. | **YES** — already built, just promote |
| D-10 | **Multi-warehouse / multi-channel inventory split** | Beauty Square has Shopify online + POS in-store + walk-ins. Inventory Planner, Cogsy all support multi-location. | **L** | Schema already has `SalesHistory.channel`. But Beauty Square is single-location; multi-channel sales aggregation (PROJECT.md "Out of Scope") is deferred. Don't build until 2nd client needs it. | **NO for v1** — explicitly out of scope per PROJECT.md |
| D-11 | **Landed cost calculation** (FOB price + duty + shipping + FX → true cost basis) | Guangzhou/Dubai imports have 18-25% landed-cost markup that distorts margin math. Cogsy + Fabrikatör both do this. | **M** | Suppliers already carry `currency` (USD/AED/KES). Need: FX rate at PO time, freight allocation, KRA duty rate per HS code. Pragmatic v1: per-supplier flat % markup field, owner-set. | **STRETCH** — start with manual markup field, full landed-cost is v2 |
| D-12 | **Encrypted-at-rest token storage + token refresh** | Shopify + QB tokens are sensitive (per CONCERNS.md §4.4). Standard SaaS pattern — owners EXPECT this once they read your privacy policy | **M** | Use `@vercel/postgres` row-level encryption or a `KMS_KEY` env-driven AES-256 wrapper. Token refresh jobs (cron via Vercel) are a Phase concern. | **YES** — security hardening is non-negotiable for real OAuth |

### Anti-Features (Deliberately NOT Building for v1)

Each of these is "table stakes" in enterprise tools but is wrong for SMB / wrong for Beauty Square / wrong for the timeline.

| # | Anti-Feature | Why Customers Ask | Why It's Wrong For Us | What To Do Instead |
|--------------|-------------------|-----------------------|--------------------|
| AF-1 | **Full "what-if" scenario planner** (multi-scenario tree, save/compare/branch scenarios) | Cogsy markets it heavily; sounds like "AI strategy" | SMB research: complex scenario planners cause analysis paralysis (LimeLight, IBM), and SMB staff abandon tools with steep learning curves within 6 months. Beauty Square has one owner — Mary. She doesn't need branched scenarios. | Keep the existing single-shot demand-shock simulator (already in repo). Output: one number with explanation. That's the SMB-correct shape. |
| AF-2 | **Open-to-Buy (OTB) budgeting** (retail-week budgets by category) | Inventory Planner pushes it; standard for apparel | Apparel-specific; Beauty Square doesn't think in retail weeks. Adds a UI surface no one will use. | Stick with the cash-flow-aware budget allocator (D-9) — one budget number, owner-set per cycle. |
| AF-3 | **Complex ML model dashboard** (RMSE, MAPE, MAE, hold-out validation curves) | Data-team-y tools love this; tech-forward SMBs ask | Mary will not look at a MAPE chart. Roy/Anjay might, but they don't need it in the product — runs in the Python sidecar logs or a hidden `/admin` page | One simple "forecast accuracy this month: 87%" number on the dashboard. Detailed metrics live in Python service logs, not UI. |
| AF-4 | **Real-time inventory webhooks** | Shopify pushes them; sounds modern | Daily/hourly batched pulls are sufficient for forecasting cadence (per PROJECT.md "Out of Scope"). Webhook handling adds infra complexity (retry queues, dedup, ordering) without forecasting win. | Scheduled cron pulls every 1-6 hours via Vercel cron. Idempotent upserts. |
| AF-5 | **Bill of Materials (BOM) / manufacturing planning** | Prediko bundles it; useful for makers | Beauty Square is pure retail — they buy finished SKUs from suppliers, no assembly. Pure scope creep for v1. | Skip the entire schema. If a future tenant is a maker, build then. |
| AF-6 | **Multi-channel sales aggregation** (WhatsApp / IG DM sales manual entry) | Kenya retail reality — half of sales happen on WhatsApp | Explicitly deferred in PROJECT.md (Milestone 3). Ingestion code, dedup logic, manual-entry UI is multiple phases of work. | Beauty Square: capture WhatsApp/walk-in sales via POS → QuickBooks (POS sync workflow, separate from forecasting app). |
| AF-7 | **M-Pesa STK push / billing in-app** | Kenya market expects M-Pesa for everything | Anjay invoices Roy off-platform via the standard freelance arrangement. Beauty Square is the only paying client; invoice them directly. M-Pesa billing is PROJECT.md Milestone 3. | Skip. Revisit after second paying client. |
| AF-8 | **Demand sensing from POS data in real time** (sub-daily forecasts) | Enterprise tools (RELEX, GMDH Streamline) | Forecast horizon is 30 days; sub-daily granularity adds zero accuracy at 30d horizon and 100× the data volume. | Daily aggregates are the right granularity. |
| AF-9 | **Custom alert routing rules engine** ("if SKU X drops below Y, notify Z user via channel W") | Slack-era SaaS bloat | Mary is one user. The owner gets the email. Done. Don't build a rules engine for one user. | Single email recipient field on Tenant; one alert template; done. |
| AF-10 | **Forecast model selection UI** ("choose between Prophet, ARIMA, XGBoost, LSTM per SKU") | Inventory Planner exposes some of this; data-team-attractive | Mary will not pick a model. The forecast contract (`simulateLayeredForecast`) hides the choice — Python sidecar picks. | Auto-select model server-side. Surface only the result and the explanation. Hide the model name unless asked. |
| AF-11 | **Public API for the SaaS** (so customers can build integrations) | Big-feature ask for SaaS marketing pages | Zero paying customers will use it in v1. Adds auth/rate-limit/docs/versioning overhead. | Defer until a customer asks. |
| AF-12 | **Multi-currency dashboard display** | Supplier currencies are USD/AED/EUR — owners want to see in their currency | The owner-facing dashboard is KES-only (Mary thinks in KES). Supplier PO exports are in supplier currency. That split is enough. | Display: dashboard in KES (FX at view time). Exports: supplier currency. No user-toggleable currency switcher in v1. |

---

## Feature Dependencies

```
TS-1 (Shopify OAuth)
    └──prerequisite──> TS-7 (QuickBooks OAuth — same auth pattern, reuse)
    └──prerequisite──> TS-2 (on-order tracking — needs real PO data to validate)
        └──prerequisite──> D-2 (lead-time auto-tuning)
            └──prerequisite──> D-3 (supplier scorecard)

TS-9 (multi-tenant auth)
    └──prerequisite──> ALL real-data features (else you leak tenant A's data to tenant B)
    └──prerequisite──> TS-12 (audit trail — needs "who")
    └──prerequisite──> D-12 (encrypted token storage — same KMS pattern)

TS-10 (deterministic forecasts)
    └──prerequisite──> Python sidecar swap
        └──prerequisite──> TS-8 (forecast accuracy — needs prediction history retained, not deleted)

TS-11 (forecast explanations)
    └──enhances──> TS-8 (accuracy view — "why was this prediction wrong?")
    └──enhances──> D-1 (promo lift — signal already feeds into explanation)
    └──enhances──> D-6 (payday timing — already a signal)

D-1 (promo lift) ──conflicts──> AF-1 (scenario planner)
    Why: promos are the single most common "what if" question; if D-1 works well,
    AF-1 is mostly redundant.

D-9 (cash-flow budget allocator) ──enhances──> TS-3 (reorder report)
    "Generate POs only for what I can afford this cycle, grouped by supplier"
```

### Critical Dependency Notes

- **TS-9 (multi-tenant auth) must land BEFORE TS-1/TS-7 (real OAuth)**. Real OAuth without tenant scoping = a security incident waiting to happen. The current `prisma.tenant.findFirst()` pattern (CONCERNS.md §4.2) will deterministically mix tenant data once two stores connect.
- **TS-10 (determinism) must land BEFORE Python sidecar**. Otherwise you can't tell if forecast changes are model improvements or `Math.random()` noise.
- **TS-2 (on-order) is the highest-impact correctness fix** — without it, every other accuracy improvement gets undermined by double-counting. Sequence: TS-2 → Python sidecar → D-2.
- **TS-8 (accuracy view) needs TS-10 + prediction history retention** — currently impossible because `forecast/run` wipes predictions every call (CONCERNS.md §6.2).

---

## MVP Definition (v1 — What "First Real Client Onboarded" Means)

### Launch With (v1 — required to demo to Mary and have her trust the number)

- [ ] **TS-9** Multi-tenant auth + per-tenant data isolation — security floor
- [ ] **TS-10** Forecast determinism (remove `Math.random()`) — trust floor
- [ ] **TS-1** Real Shopify Admin API ingest (OAuth) — replaces mock
- [ ] **TS-7** Real QuickBooks Online ingest (OAuth) — Beauty Square's source of truth
- [ ] **TS-2** On-order quantity tracking — fixes double-ordering correctness bug
- [ ] **Python FastAPI sidecar with real SARIMA + XGBoost** — fulfills Core Value (forecast quality)
- [ ] **TS-8** Forecast accuracy / actual-vs-predicted view (requires retained prediction history)
- [ ] **TS-11** Forecast explanation panel (already-shaped `Signal[]` + UI surfacing)
- [ ] **TS-3** Reorder report export (CSV per supplier)
- [ ] **TS-5** Low-stock email alerts (single recipient)
- [ ] **TS-6** Lost-sales estimate per SKU + dashboard summary
- [ ] **TS-12** Approve/Skip with audit trail (who/when + mandatory skip reason)
- [ ] **D-5** ABC override + lifecycle stage (NEW SKUs get category-proxy forecast)
- [ ] **D-1** Promo lift driven by real `Promo` rows (not hardcoded calendar)
- [ ] **D-6** Kenya payday-aware reorder timing (bias reorder dates ±3-5d to land before payday)
- [ ] **D-9** Cash-flow budget allocator promoted to main nav (already built)
- [ ] **D-12** Encrypted-at-rest token storage for Shopify + QB tokens

### Add After Mary Uses It For 30 Days (v1.1-v1.3)

- [ ] **D-2** Lead-time auto-tuning from `Order.receivedAt` — trigger: after 6+ POs flow through with real receipts
- [ ] **D-4** Slow-mover detection with liquidation suggestions — trigger: Mary asks "what about my dead stock?"
- [ ] **D-3** Supplier scorecard (OTIF, fill rate, lead-time variance) — trigger: depends on D-2
- [ ] **TS-4** Days-of-cover elevated to first-class sortable column — minor UX upgrade
- [ ] **D-11** Landed cost markup field (per-supplier flat %) — trigger: when Mary complains about margin reporting

### Future Consideration (v2+ — needs second paying client or market signal)

- [ ] **D-7** Google Trends Kenya signal — trigger: base model accuracy validated at ≥85% MAPE, then attempt
- [ ] **D-8** Weather signal — only if Mary or another tenant explicitly asks for it
- [ ] **D-10** Multi-warehouse / multi-channel — trigger: second client with multiple locations
- [ ] **D-11 full landed-cost** (FX + duty + freight breakdown) — trigger: tenant doing >$50K/mo imports

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| TS-9 multi-tenant auth | HIGH (security) | HIGH | **P1** |
| TS-10 determinism | HIGH (trust) | LOW | **P1** |
| TS-1 Shopify OAuth | HIGH | HIGH | **P1** |
| TS-7 QuickBooks OAuth | HIGH (canonical truth) | HIGH | **P1** |
| TS-2 on-order tracking | HIGH (correctness) | MEDIUM | **P1** |
| Python sidecar (real ML) | HIGH (Core Value) | HIGH | **P1** |
| TS-8 forecast accuracy view | HIGH (trust) | MEDIUM | **P1** |
| TS-11 explanation panel | HIGH (trust, adoption) | MEDIUM | **P1** |
| TS-3 reorder CSV export | HIGH (replaces Excel) | LOW | **P1** |
| TS-6 lost-sales estimate | HIGH (aha-metric) | MEDIUM | **P1** |
| TS-5 email alerts | MEDIUM | LOW | **P1** |
| TS-12 audit trail + skip reason | MEDIUM | LOW | **P1** |
| D-1 promo lift (real) | HIGH (Beauty Square runs promos constantly) | MEDIUM | **P1** |
| D-5 ABC override + lifecycle | MEDIUM | LOW | **P1** |
| D-6 payday-aware reorder timing | MEDIUM (Kenya twist, distinctive) | LOW | **P1** |
| D-9 cash-flow budget allocator promotion | HIGH (already built) | LOW | **P1** |
| D-12 encrypted token storage | HIGH (security) | MEDIUM | **P1** |
| TS-4 days-of-cover column | LOW (already shown as urgency) | LOW | P2 |
| D-2 lead-time auto-tuning | HIGH (Kenya import twist) | MEDIUM | **P2** |
| D-3 supplier scorecard | MEDIUM | MEDIUM | P2 |
| D-4 slow-mover with action | MEDIUM | MEDIUM | P2 |
| D-11 landed-cost markup | MEDIUM | LOW | P2 |
| D-7 Google Trends Kenya | LOW (speculative) | HIGH | P3 |
| D-8 weather signal | LOW (speculative) | HIGH | P3 |
| D-10 multi-warehouse | LOW (Beauty Square is single-loc) | HIGH | P3 |

**P1 = v1 launch. P2 = v1.x after first 30 days. P3 = v2+ / on-demand.**

---

## Competitor Feature Analysis

| Feature | Inventory Planner | Cogsy | Fabrikatör | Prediko | Our Approach |
|---------|------------------|-------|------------|---------|-------------|
| Forecasting model | Configurable seasonal/non-seasonal | Demand planning + scenarios | AI demand forecasting | AI trained on 25M+ SKUs | Python SARIMA + XGBoost sidecar; Kenya-specific Layer-2 signals |
| Pricing tier | $244/mo+ | $199/mo | $99/mo+ | $49-99/mo | Pricing TBD; tier below Prediko ($49/mo equivalent in KES via M-Pesa eventually) |
| On-order tracking | Yes (multiple-delivery POs) | Yes | Yes (with backorder selling) | Yes | YES — must-have (TS-2) |
| Reorder PO automation | Yes (full PO generation) | Yes (bulk PO creation) | Yes | Yes | CSV per supplier in v1, full PO send in v2 |
| Multi-location | Yes | Yes (vendor-to-customer) | Yes | Yes (multi-channel) | NO in v1 (Beauty Square single-loc) |
| Open-to-Buy budgeting | Yes (signature feature) | Yes | No | No | NO (apparel-specific; use cash-flow allocator instead) |
| Forecast explanations | Limited | Yes | Limited | Yes | YES (TS-11 — competitive must per 2026 explainability research) |
| Multi-tenant SaaS shape | Yes (own app per merchant) | Yes | Yes | Yes | YES — Anjay's standing rule |
| QuickBooks integration | Yes | Limited | No (Shopify-first) | Limited | YES (TS-7) — Beauty Square requires it |
| Kenya/M-Pesa-specific signals | No | No | No | No | YES (D-6 payday timing) — distinctive moat |
| Slow-mover liquidation | Reports it | Yes | Yes | Yes | YES (D-4) |
| Scenario planning | No (other tools handle) | YES (big feature) | No | No | NO (AF-1 anti-feature) |

**Differentiation thesis:** Most competitors target US/EU DTC brands at $200/mo. Our position is "QB + Shopify in Kenyan SMB context, with explainable forecasts that respect M-Pesa payday cycles and Guangzhou/Dubai lead-time reality, priced for a Nairobi shop owner." The features in D-1/D-2/D-6 are where this differs from copying Prediko — everywhere else, parity is fine.

---

## Sources

**Surveyed competitors / market context:**
- [Inventory Planner Review 2026 — ATTN Agency](https://www.attnagency.com/blog/inventory-planner-shopify-review)
- [Inventory Planner — Multiple Delivery POs](https://www.inventory-planner.com/multiple-delivery-purchase-orders/)
- [Inventory Planner + QuickBooks Online](https://www.inventory-planner.com/integrations/quickbooks/)
- [Cogsy alternatives comparison](https://cogsy.com/blog/inventory-planner-shopify/)
- [Prediko pricing & features](https://www.prediko.io/pricing) / [Prediko vs Cogsy vs Inventory Planner](https://www.prediko.io/inventory-planner-vs-cogsy-vs-prediko)
- [Fabrikatör Shopify App](https://apps.shopify.com/fabrikator) / [Fabrikatör vs Cogsy](https://www.fabrikator.io/blog/inventory-planner-vs-cogsy)
- [Stocky deprecation — Sensible Tools](https://sensible.tools/blog/stocky-deprecated-shopify-inventory-forecasting-alternatives)
- [Verve AI — Shopify Forecasting App Comparison 2026](https://www.getverveai.com/blog/shopify-inventory-forecasting-app-comparison)
- [Sumtracker — Top 10 Shopify Forecasting Software 2026](https://www.sumtracker.com/blog/top-10-shopify-demand-forecasting-software)
- [Sumtracker — Best Demand Planning Tools 2026](https://www.sumtracker.com/blog/best-demand-planning-tools-for-shopify-stores)
- [Charle — Best Shopify Inventory Apps 2026](https://www.charle.co.uk/articles/best-shopify-inventory-management-apps/)
- [The Retail Exec — 24 Best Inventory Optimization Tools 2026](https://theretailexec.com/tools/best-inventory-optimization-software/)

**Feature-specific research:**
- [On-Order / PO visibility for forecasting — Leverage AI](https://tryleverage.ai/blog/why-po-inventory-visibility-in-the-supply-chain-is-critical-for-demand-forecasting)
- [Lost-sales calculation — Demand Planning Blog](https://demand-planning.com/2020/04/13/how-do-i-calculate-lost-sales-from-a-stockout/)
- [Lost-sales as the metric you're not tracking — Hydrian](https://hydrian.com/library/stockout-cost/)
- [Out-of-stock prediction — Pecan AI](https://www.pecan.ai/blog/out-of-stock-prediction-lost-sales/)
- [Slow-moving inventory — NetSuite](https://www.netsuite.com/portal/resource/articles/inventory-management/slow-moving-inventory.shtml)
- [Slow-moving detection methods — Red Stag Fulfillment](https://redstagfulfillment.com/how-to-identify-slow-moving-inventory/)
- [Shopify — How to identify slow-moving inventory](https://www.shopify.com/retail/slow-moving-inventory)
- [Supplier scorecard for retailers — RetailerHub](https://www.retailerhub.ai/guides/vendor-scorecard)
- [Supplier scorecards — SPS Commerce](https://www.spscommerce.com/community/articles/how-to-build-an-effective-supplier-scorecard)
- [Supplier performance KPIs — ISM](https://www.ism.ws/supply-chain/supplier-performance-measurement-kpis/)

**Explainability + SMB adoption research:**
- [Demand Forecasting with Explainable AI — Tredence](https://www.tredence.com/blog/ai-explainability-in-demand-forecasting)
- [2026 SMB AI Predictions — PowerMetrics](https://www.powermetrics.app/blog/smb-data-analytics-ai-metrics-trends-2026)
- [Scenario planning underutilization — LimeLight](https://www.golimelight.com/blog/scenario-planning)
- [SMB demand planning tools — Flowlity](https://www.flowlity.com/resources/ai-powered-demand-planning-software-small-businesses)
- [SMB scenario planning practical guide — Bob Stanke](https://www.bobstanke.com/blog/scenario-planning-for-smb)

**Kenya / context-specific signals:**
- [Google Trends as retail forecasting tool — Shopify](https://www.shopify.com/blog/how-to-use-google-trends-to-start-and-run-a-retail-business)
- [Google Beauty Trends 2025-2026 — Accio](https://www.accio.com/business/google-beauty-trends)
- [POS systems in Kenya 2026 — Endeavour Africa](https://endeavourafrica.com/pos-system-in-kenya-how-smart-retailers-are-increasing-sales-in-2026/)
- [M-Pesa retail context — TechTrends Kenya](https://techtrendske.co.ke/2026/03/25/m-pesa-retail-trading-kenya/)

**Confidence flags:**
- HIGH confidence: Table-stakes feature list (consistent across 6+ competitor sources), on-order/PO visibility (multiple authoritative sources), explainability as SMB trust driver (Tredence + PowerMetrics).
- MEDIUM confidence: Pricing tiers cited (varies by source/recency); supplier scorecard metric counts (8-15 is "right floor" per one source, others give ranges).
- LOW confidence: Kenya payday weekly cycle for retail demand specifically — search returned M-Pesa context but not Kenya-retail-specific payday demand studies. The repo's `kenya-calendar.ts` payday boost (1.6× in days 13-16 and 25-end) is the operating assumption; treat as a hypothesis to validate from real Beauty Square sales data once QB ingest lands.

---
*Feature research for: SMB Inventory Demand Forecasting (Kenya + Shopify + QuickBooks)*
*Researched: 2026-05-28*

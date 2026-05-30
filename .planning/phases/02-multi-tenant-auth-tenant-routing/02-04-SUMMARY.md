# Plan 02-04 Summary — Tenant-timezone date bucketing + determinism

status: complete-verified
plan: 02-04
phase: 02-multi-tenant-auth-tenant-routing
requirements: [TNT-08]
completed: 2026-05-30

## What was built

Per-tenant timezone date handling (D-19) that preserves Phase 1's determinism invariant (Pitfall 7).

- **`lib/time/tenant-date.ts`** (`date-fns-tz@3.2.0`, `date-fns@4`): `tenantDayKey(tz, when?)` → `YYYY-MM-DD` in tenant tz; `tenantTodayUtc(tz, when?)` → UTC instant of tenant-local midnight.
- **`lib/time/tenant-date.test.ts`**: proves two UTC instants within one Nairobi day collapse to the same dayKey; tenant midnight maps to the correct UTC instant; next Nairobi day yields a different key.
- **`lib/forecast/simulate-layers.ts`**: `ForecastInput` gains optional `runDateKey?: string`. New `anchorToday(runDateKey?)` anchors ALL internal date math — the rng seed AND the `seasonalNaive30` / `lookaheadHolidayBoost` / `lookaheadPaydays` window helpers (which previously each called wall-clock `new Date()`). The seed uses the `runDateKey` STRING directly (bypassing rng's UTC `toISOString()` slice). Absent `runDateKey`, falls back to wall-clock UTC midnight = unchanged Phase-1 behavior.
- **`app/api/forecast/run/route.ts`** + **`scripts/run-forecasts.ts`**: compute `runDateKey` + `todayUtc` ONCE from `tenant.timezone`; anchor history/promo windows on `todayUtc`; thread `runDateKey` into every `simulateLayeredForecast(...)`; store `prediction.runDate = todayUtc` so predictions bucket by the tenant calendar day.
- **`scripts/check-determinism.ts`**: keeps the FND-02 case; adds a TNT-08 case — two UTC instants on the same Nairobi day produce byte-identical forecasts, and a different day key is shown to change the forecast (proving the key feeds the seed).

## Verified

- `npx tsc --noEmit` → 0 source errors.
- `npx vitest run` → **25 passed** (4 files, incl. 3 new tenant-date tests).
- `npm run check:determinism` → `DETERMINISM PASS` (FND-02) **and** `TZ DETERMINISM PASS` (same Nairobi day identical; next-day differs).
- `grep -rn "Math.random" lib/forecast/simulate-layers.ts app/api/forecast/run/route.ts scripts/run-forecasts.ts` → 0.
- `package.json` now declares `date-fns@^4.1.0` + `date-fns-tz@^3.2.0`.

## Deviations

- Went beyond the plan's "seed only" guidance and also anchored the `lookaheadHolidayBoost`/`lookaheadPaydays`/`seasonalNaive30` window helpers on the same tenant-local `today`. Reason: those helpers call wall-clock `new Date()` and feed Layer-2 signals; without anchoring, a real production run at 22:30 UTC vs 05:00 UTC on the same Nairobi day would diverge even with a fixed seed. This makes production genuinely deterministic per tenant-day, not just the test. Backward-compatible (absent `runDateKey` = identical prior behavior).

## Self-Check: PASSED

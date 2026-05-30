/**
 * check-determinism.ts
 *
 * Phase 1 acceptance gate for FND-02: simulateLayeredForecast() MUST return
 * byte-identical output for byte-identical input. Phase 5 will reuse this
 * script (via `npm run check:determinism`) as the smoke gate that proves the
 * Python sidecar matches the TS reference implementation.
 *
 * Builds a 90-day deterministic history using the same seeded RNG the rest of
 * the system uses (mulberry32), invokes the simulator twice with that fixed
 * fixture, and JSON-deep-equals the outputs. Exits 0 on match, 1 on mismatch
 * with a clear printout of the first divergence.
 *
 * Run via:  npm run check:determinism
 */

import {
  simulateLayeredForecast,
  type ForecastInput,
} from "../lib/forecast/simulate-layers";
import { mulberry32, seedFrom } from "../lib/forecast/rng";
import { tenantDayKey } from "../lib/time/tenant-date";

const FIXTURE_ID = "test-product-determinism-001";

// Deterministic 90-day history: the fixture itself is reproducible.
const fixtureRng = mulberry32(seedFrom(["check-determinism-history", FIXTURE_ID]));

const sample: ForecastInput = {
  productId: FIXTURE_ID,
  productType: "skincare",
  vendor: "TEST VENDOR",
  sku: "TEST-SKU-1",
  currentStock: 10,
  abcCategory: "B",
  history: Array.from({ length: 90 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1 + i)),
    quantity: Math.max(0, Math.round(2 + fixtureRng() * 4)),
  })),
  leadTimeAvg: 30,
  leadTimeStd: 7,
  activePromos: [],
};

const a = simulateLayeredForecast(sample);
const b = simulateLayeredForecast(sample);

const aJson = JSON.stringify(a);
const bJson = JSON.stringify(b);

if (aJson !== bJson) {
  console.error("DETERMINISM FAIL — outputs diverged for identical input.");
  console.error("  Fixture productId:", FIXTURE_ID);
  // First-divergence locator: walk the top-level keys.
  for (const k of Object.keys(a) as Array<keyof typeof a>) {
    const av = JSON.stringify(a[k]);
    const bv = JSON.stringify(b[k]);
    if (av !== bv) {
      console.error(`  First divergence at key: ${String(k)}`);
      console.error(`    Run A: ${av}`);
      console.error(`    Run B: ${bv}`);
      break;
    }
  }
  console.error("Run A full:", aJson);
  console.error("Run B full:", bJson);
  process.exit(1);
}

console.log(`DETERMINISM PASS — outputs identical. (fixture=${FIXTURE_ID})`);

// ── TNT-08: tenant-timezone determinism ──────────────────────────────────────
// Two different UTC instants that fall on the SAME Africa/Nairobi calendar day
// must produce the SAME runDateKey, and therefore byte-identical forecasts.
const keyMorning = tenantDayKey("Africa/Nairobi", new Date("2026-05-31T05:00:00Z")); // 08:00 Nairobi
const keyEvening = tenantDayKey("Africa/Nairobi", new Date("2026-05-31T20:30:00Z")); // 23:30 Nairobi
if (keyMorning !== "2026-05-31" || keyEvening !== "2026-05-31") {
  console.error(`TZ DETERMINISM FAIL — expected both keys 2026-05-31, got ${keyMorning} / ${keyEvening}`);
  process.exit(1);
}

const tzA = simulateLayeredForecast({ ...sample, runDateKey: keyMorning });
const tzB = simulateLayeredForecast({ ...sample, runDateKey: keyEvening });
const tzAJson = JSON.stringify(tzA);
const tzBJson = JSON.stringify(tzB);

if (tzAJson !== tzBJson) {
  console.error("TZ DETERMINISM FAIL — same Nairobi day, different UTC instants diverged.");
  for (const k of Object.keys(tzA) as Array<keyof typeof tzA>) {
    if (JSON.stringify(tzA[k]) !== JSON.stringify(tzB[k])) {
      console.error(`  First divergence at key: ${String(k)}`);
      console.error(`    Run A: ${JSON.stringify(tzA[k])}`);
      console.error(`    Run B: ${JSON.stringify(tzB[k])}`);
      break;
    }
  }
  process.exit(1);
}

// Sanity: a DIFFERENT day key is permitted (not required) to differ — proves the
// key actually feeds the seed. Logged only, never fails the gate.
const tzNextDay = simulateLayeredForecast({ ...sample, runDateKey: "2026-06-01" });
const differs = JSON.stringify(tzNextDay) !== tzAJson;
console.log(
  `TZ DETERMINISM PASS — 2026-05-31 morning/evening identical; next-day key drives seed: ${differs ? "differs" : "same"}.`
);

process.exit(0);

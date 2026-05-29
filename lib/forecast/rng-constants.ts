// Centralised seed constants. `grep <SEED_NAME>` to find what determines each
// script's output. Hex literals are arbitrary but stable — DO NOT change them
// without coordinating; any change re-shuffles synthetic data + reorder
// recommendations across the entire test suite.
export const SYNTH_SEED    = 0xBEA4_C4FE; // scripts/synth-sales-history.ts
export const SUPPLIER_SEED = 0xC0FF_EE01; // scripts/seed-suppliers.ts
export const BACKFILL_SEED = 0xC057_5EED; // scripts/backfill-costs.ts
export const SCRAPE_SEED   = 0xB5C4_7A10; // scripts/seed-from-beautysquare.ts (combined with productId per row)

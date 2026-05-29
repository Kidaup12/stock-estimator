/**
 * Deterministic PRNG seam for the forecast simulator.
 *
 * mulberry32: 32-bit seeded PRNG, period 2^32, statistically excellent for
 *   simulation use (used by d3-random et al). Public domain (Tommy Ettinger,
 *   via Bryc's PRNG collection).
 * seedFrom: FNV-1a 32-bit hash. Combines mixed-type parts (string|number|Date)
 *   into a single unsigned 32-bit seed. Public domain (Fowler/Vo/Noll).
 *
 * Usage:
 *   const rng = mulberry32(seedFrom([productId, runDateIso]));
 *   const r = rng(); // 0..1, replaces Math.random()
 *
 * NOTE: `seedFrom` calls `.toISOString().slice(0, 10)` for Date parts, so the
 * time-of-day is dropped. Two runs on the same calendar day with the same
 * productId produce identical sequences. This is the FND-02 invariant.
 */

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(parts: Array<string | number | Date>): number {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const s =
      part instanceof Date
        ? part.toISOString().slice(0, 10) // drops time-of-day per D-06
        : String(part);
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}

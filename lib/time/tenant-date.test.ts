import { describe, it, expect } from "vitest";
import { tenantDayKey, tenantTodayUtc } from "./tenant-date";

describe("tenant-date (TNT-08 determinism invariant)", () => {
  it("collapses two UTC instants within one Nairobi day to the same dayKey", () => {
    // 2026-05-30T22:30:00Z = 01:30 on 2026-05-31 in Nairobi (+03:00)
    const lateNightUtc = new Date("2026-05-30T22:30:00Z");
    // 2026-05-31T05:00:00Z = 08:00 on 2026-05-31 in Nairobi
    const morningUtc = new Date("2026-05-31T05:00:00Z");

    expect(tenantDayKey("Africa/Nairobi", lateNightUtc)).toBe("2026-05-31");
    expect(tenantDayKey("Africa/Nairobi", morningUtc)).toBe("2026-05-31");
    // The invariant: different UTC instants, same Nairobi calendar day -> same key.
    expect(tenantDayKey("Africa/Nairobi", lateNightUtc)).toBe(
      tenantDayKey("Africa/Nairobi", morningUtc)
    );
  });

  it("computes tenant-local midnight as the correct UTC instant", () => {
    // Nairobi midnight on 2026-05-31 is 2026-05-30T21:00:00Z (UTC = local - 03:00)
    const got = tenantTodayUtc("Africa/Nairobi", new Date("2026-05-31T05:00:00Z"));
    expect(got.toISOString()).toBe("2026-05-30T21:00:00.000Z");
  });

  it("a different UTC instant on the next Nairobi day yields a different key", () => {
    // 2026-05-31T21:30:00Z = 00:30 on 2026-06-01 in Nairobi
    expect(tenantDayKey("Africa/Nairobi", new Date("2026-05-31T21:30:00Z"))).toBe("2026-06-01");
  });
});

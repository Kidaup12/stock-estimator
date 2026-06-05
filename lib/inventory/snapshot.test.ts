import { describe, it, expect } from "vitest";
import { utcDayKey } from "./snapshot";

describe("utcDayKey", () => {
  it("floors a timestamp to UTC midnight", () => {
    const d = utcDayKey(new Date("2026-06-05T14:33:09.123Z"));
    expect(d.toISOString()).toBe("2026-06-05T00:00:00.000Z");
  });

  it("is idempotent (already-midnight stays midnight)", () => {
    const d = utcDayKey(new Date("2026-06-05T00:00:00.000Z"));
    expect(d.toISOString()).toBe("2026-06-05T00:00:00.000Z");
  });

  it("uses the UTC day even for late-evening local times", () => {
    const d = utcDayKey(new Date("2026-06-05T23:59:59.000Z"));
    expect(d.toISOString()).toBe("2026-06-05T00:00:00.000Z");
  });
});

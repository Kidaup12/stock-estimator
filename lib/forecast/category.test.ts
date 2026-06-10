import { describe, it, expect } from "vitest";
import { leadDaysFor, coverDaysFor, normalizeCategory, DEFAULT_LEAD_DAYS, COVER_DAYS } from "./category";

describe("normalizeCategory", () => {
  it("accepts the three categories case-insensitively", () => {
    expect(normalizeCategory("LOCAL")).toBe("LOCAL");
    expect(normalizeCategory("korean")).toBe("KOREAN");
    expect(normalizeCategory("Western")).toBe("WESTERN");
  });
  it("returns null for null/empty/garbage", () => {
    expect(normalizeCategory(null)).toBeNull();
    expect(normalizeCategory(undefined)).toBeNull();
    expect(normalizeCategory("")).toBeNull();
    expect(normalizeCategory("IMPORT")).toBeNull();
  });
});

describe("leadDaysFor precedence", () => {
  it("per-product override wins over everything", () => {
    expect(leadDaysFor({ leadTimeDays: 11, importCategory: "KOREAN" }, { leadTimeAvgDays: 14 })).toBe(11);
  });
  it("supplier average wins over category default", () => {
    expect(leadDaysFor({ leadTimeDays: null, importCategory: "KOREAN" }, { leadTimeAvgDays: 14 })).toBe(14);
  });
  it("category default applies when product+supplier silent", () => {
    expect(leadDaysFor({ leadTimeDays: null, importCategory: "KOREAN" }, null)).toBe(DEFAULT_LEAD_DAYS.KOREAN);
    expect(leadDaysFor({ leadTimeDays: null, importCategory: "WESTERN" }, undefined)).toBe(28);
    expect(leadDaysFor({ leadTimeDays: null, importCategory: "LOCAL" }, null)).toBe(7);
  });
  it("unclassified falls back to legacy 30", () => {
    expect(leadDaysFor({ leadTimeDays: null, importCategory: null }, null)).toBe(30);
  });
  it("leadTimeDays 0 is a valid explicit override (same-day)", () => {
    expect(leadDaysFor({ leadTimeDays: 0, importCategory: "KOREAN" }, { leadTimeAvgDays: 14 })).toBe(0);
  });
});

describe("coverDaysFor", () => {
  it("local covers 17 days (Mary: 2 weeks 3 days)", () => {
    expect(coverDaysFor({ importCategory: "LOCAL" })).toBe(COVER_DAYS.LOCAL);
    expect(COVER_DAYS.LOCAL).toBe(17);
  });
  it("imports cover 21 days (Mary: at least 3 weeks)", () => {
    expect(coverDaysFor({ importCategory: "KOREAN" })).toBe(21);
    expect(coverDaysFor({ importCategory: "western" })).toBe(21);
  });
  it("unclassified keeps the legacy flat 30d (behavior changes only once classified)", () => {
    expect(coverDaysFor({ importCategory: null })).toBe(30);
    expect(coverDaysFor({})).toBe(30);
  });
});

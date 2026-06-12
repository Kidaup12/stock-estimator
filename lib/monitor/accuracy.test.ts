import { describe, it, expect } from "vitest";
import { accuracyDropped, accuracyDropMessage } from "./accuracy";

describe("accuracyDropped", () => {
  it("flags a worse-than-threshold MAE increase", () => {
    expect(accuracyDropped(13, 10, 20)).toBe(true); // +30%
  });
  it("ignores increases within the threshold", () => {
    expect(accuracyDropped(11, 10, 20)).toBe(false); // +10%
  });
  it("ignores improvements", () => {
    expect(accuracyDropped(8, 10, 20)).toBe(false);
  });
  it("no baseline → never flags", () => {
    expect(accuracyDropped(99, null)).toBe(false);
    expect(accuracyDropped(99, 0)).toBe(false);
  });
  it("message describes the regression", () => {
    expect(accuracyDropMessage(13, 10)).toContain("+30%");
  });
});

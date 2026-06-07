import { describe, it, expect } from "vitest";
import { isSellableLocation, isEnrouteLocation } from "./locations";

describe("isSellableLocation", () => {
  it("real shelf locations are sellable", () => {
    expect(isSellableLocation("Warehouse CBD")).toBe(true);
    expect(isSellableLocation("New Stanley Building Opposite Lonhro House, CBD")).toBe(true);
    expect(isSellableLocation("Lavington- Valley Field Court,Hendred Avenue")).toBe(true);
  });
  it("virtual locations are NOT sellable", () => {
    expect(isSellableLocation("Main Warehouse- Nairobi (Virtual)")).toBe(false);
  });
  it("the en-route / incoming QB location is NOT sellable", () => {
    expect(isSellableLocation("INCOMING (QB) ENROUTE ORDERS")).toBe(false);
  });
  it("tolerates null/empty (treated sellable — unknown real location)", () => {
    expect(isSellableLocation(null)).toBe(true);
    expect(isSellableLocation("")).toBe(true);
  });
});

describe("isEnrouteLocation", () => {
  it("matches the incoming/en-route bucket", () => {
    expect(isEnrouteLocation("INCOMING (QB) ENROUTE ORDERS")).toBe(true);
    expect(isEnrouteLocation("En Route")).toBe(true);
    expect(isEnrouteLocation("en-route")).toBe(true);
  });
  it("does not match real or virtual locations", () => {
    expect(isEnrouteLocation("Warehouse CBD")).toBe(false);
    expect(isEnrouteLocation("Main Warehouse- Nairobi (Virtual)")).toBe(false);
  });
});

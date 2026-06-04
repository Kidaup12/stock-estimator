import { describe, it, expect } from "vitest";
import { parseBulkJsonl } from "./jsonl";

describe("parseBulkJsonl", () => {
  it("reassembles __parentId children under the inferred collection key", () => {
    const fixture = [
      JSON.stringify({ id: "gid://shopify/Order/1", name: "#1001" }),
      JSON.stringify({ id: "gid://shopify/LineItem/10", quantity: 2, __parentId: "gid://shopify/Order/1" }),
      JSON.stringify({ id: "gid://shopify/LineItem/11", quantity: 5, __parentId: "gid://shopify/Order/1" }),
    ].join("\n");

    const out = parseBulkJsonl(fixture);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("#1001");
    const lineItems = out[0].lineItems as Array<{ quantity: number }>;
    expect(lineItems).toHaveLength(2);
    expect(lineItems.map((l) => l.quantity)).toEqual([2, 5]);
  });

  it("treats a line with no __parentId as a top-level record", () => {
    const fixture = [
      JSON.stringify({ id: "gid://shopify/Product/1", title: "A" }),
      JSON.stringify({ id: "gid://shopify/Product/2", title: "B" }),
    ].join("\n");

    const out = parseBulkJsonl(fixture);
    expect(out.map((p) => p.title)).toEqual(["A", "B"]);
  });

  it("tolerates a child referencing an unseen parent without throwing (orphan dropped)", () => {
    const fixture = [
      JSON.stringify({ id: "gid://shopify/LineItem/99", quantity: 1, __parentId: "gid://shopify/Order/404" }),
      JSON.stringify({ id: "gid://shopify/Order/1", name: "#1001" }),
    ].join("\n");

    let out: ReturnType<typeof parseBulkJsonl> = [];
    expect(() => {
      out = parseBulkJsonl(fixture);
    }).not.toThrow();
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("#1001");
    expect(out[0].lineItems).toBeUndefined();
  });

  it("attaches a buffered orphan once its parent appears later", () => {
    const fixture = [
      JSON.stringify({ id: "gid://shopify/LineItem/10", quantity: 7, __parentId: "gid://shopify/Order/1" }),
      JSON.stringify({ id: "gid://shopify/Order/1", name: "#1001" }),
    ].join("\n");

    const out = parseBulkJsonl(fixture);
    expect(out).toHaveLength(1);
    const lineItems = out[0].lineItems as Array<{ quantity: number }>;
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0].quantity).toBe(7);
  });

  it("buckets a child WITHOUT an id under _unknown, never a fabricated key (regression)", () => {
    // Regression for the orders lineItems bug: a child node whose `id` was not
    // selected in the bulk query has no gid type. It must NOT land under a
    // fabricated key like "s" (empty-string -> "" + "s"). The real fix is to
    // select `id` on the child; this guards the parser against silent misfiling.
    const fixture = [
      JSON.stringify({ id: "gid://shopify/Order/1", name: "#1001" }),
      JSON.stringify({ quantity: 2, sku: "ABC", __parentId: "gid://shopify/Order/1" }),
    ].join("\n");

    const out = parseBulkJsonl(fixture);
    expect(out).toHaveLength(1);
    expect(out[0].s).toBeUndefined();
    expect((out[0]._unknown as unknown[]).length).toBe(1);
  });

  it("buckets order line items under lineItems when the child carries a LineItem gid", () => {
    const fixture = [
      JSON.stringify({ id: "gid://shopify/Order/1", name: "#1001" }),
      JSON.stringify({
        id: "gid://shopify/LineItem/5",
        quantity: 3,
        sku: "ABC",
        __parentId: "gid://shopify/Order/1",
      }),
    ].join("\n");

    const out = parseBulkJsonl(fixture);
    const lineItems = out[0].lineItems as Array<{ quantity: number }>;
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0].quantity).toBe(3);
  });

  it("returns an empty array for empty input (no throw)", () => {
    expect(parseBulkJsonl("")).toEqual([]);
    expect(parseBulkJsonl("\n\n  \n")).toEqual([]);
  });

  it("skips malformed JSON lines without throwing", () => {
    const fixture = [
      JSON.stringify({ id: "gid://shopify/Product/1", title: "A" }),
      "{not valid json",
      JSON.stringify({ id: "gid://shopify/Product/2", title: "B" }),
    ].join("\n");

    const out = parseBulkJsonl(fixture);
    expect(out.map((p) => p.title)).toEqual(["A", "B"]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OdooClient } from "./client";

function mockFetchOnce(body: unknown, ok = true) {
  return vi.fn().mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });
}

describe("OdooClient", () => {
  const cfg = { baseUrl: "https://x.odoo.com", database: "x", username: "u@x.com", apiKey: "k" };
  beforeEach(() => vi.restoreAllMocks());

  it("authenticate() returns the uid from a JSON-RPC result", async () => {
    const fetchMock = mockFetchOnce({ jsonrpc: "2.0", id: 1, result: 7 });
    vi.stubGlobal("fetch", fetchMock);
    const c = new OdooClient(cfg);
    expect(await c.authenticate()).toBe(7);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://x.odoo.com/jsonrpc");
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.params.service).toBe("common");
    expect(sent.params.method).toBe("authenticate");
    expect(sent.params.args).toEqual(["x", "u@x.com", "k", {}]);
  });

  it("authenticate() throws on uid=false (bad creds)", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ jsonrpc: "2.0", id: 1, result: false }));
    await expect(new OdooClient(cfg).authenticate()).rejects.toThrow(/authentication failed/i);
  });

  it("searchRead() caches uid then calls execute_kw with paging args", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: 7 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ result: [{ id: 1 }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const c = new OdooClient(cfg);
    const rows = await c.searchRead(
      "product.product",
      [["active", "=", true]],
      ["id", "default_code"],
      { limit: 100, offset: 0 }
    );
    expect(rows).toEqual([{ id: 1 }]);
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(sent.params.method).toBe("execute_kw");
    expect(sent.params.args[3]).toBe("product.product");
    expect(sent.params.args[4]).toBe("search_read");
    expect(sent.params.args[5]).toEqual([[["active", "=", true]]]);
    expect(sent.params.args[6]).toEqual({ fields: ["id", "default_code"], limit: 100, offset: 0 });
  });

  it("throws when the response carries a JSON-RPC error", async () => {
    vi.stubGlobal("fetch", mockFetchOnce({ error: { data: { message: "Access Denied" } } }));
    await expect(new OdooClient(cfg).authenticate()).rejects.toThrow(/Access Denied/);
  });
});

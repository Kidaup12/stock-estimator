/**
 * Odoo external-API client over JSON-RPC (/jsonrpc) — the read seam for ingest.
 * Auth: common.authenticate(db, user, apiKey) -> uid (cached per instance).
 * Reads: object.execute_kw(db, uid, apiKey, model, "search_read", [domain], opts).
 * API key replaces the password (login stays). Raw fetch — no SDK, no XML.
 */
export type OdooConfig = {
  baseUrl: string; // https://store.odoo.com (no trailing slash required)
  database: string;
  username: string;
  apiKey: string;
};

type JsonRpcCall = { service: "common" | "object"; method: string; args: unknown[] };

export class OdooClient {
  private uid: number | null = null;
  private id = 0;
  constructor(private cfg: OdooConfig) {}

  private async rpc<T>(call: JsonRpcCall): Promise<T> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, "")}/jsonrpc`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: ++this.id, params: call }),
    });
    if (!res.ok) throw new Error(`Odoo JSON-RPC HTTP ${res.status}`);
    const json = (await res.json()) as {
      result?: T;
      error?: { data?: { message?: string }; message?: string };
    };
    if (json.error) {
      throw new Error(`Odoo error: ${json.error.data?.message ?? json.error.message ?? "unknown"}`);
    }
    return json.result as T;
  }

  async authenticate(): Promise<number> {
    if (this.uid) return this.uid;
    const uid = await this.rpc<number | false>({
      service: "common",
      method: "authenticate",
      args: [this.cfg.database, this.cfg.username, this.cfg.apiKey, {}],
    });
    if (!uid || typeof uid !== "number") {
      throw new Error("Odoo authentication failed (check db/username/apiKey)");
    }
    this.uid = uid;
    return uid;
  }

  /** search_read with paging. domain is an Odoo domain array, e.g. [["active","=",true]]. */
  async searchRead<T = Record<string, unknown>>(
    model: string,
    domain: unknown[],
    fields: string[],
    opts: { limit?: number; offset?: number } = {}
  ): Promise<T[]> {
    const uid = await this.authenticate();
    return this.rpc<T[]>({
      service: "object",
      method: "execute_kw",
      args: [this.cfg.database, uid, this.cfg.apiKey, model, "search_read", [domain], { fields, ...opts }],
    });
  }

  async searchCount(model: string, domain: unknown[]): Promise<number> {
    const uid = await this.authenticate();
    return this.rpc<number>({
      service: "object",
      method: "execute_kw",
      args: [this.cfg.database, uid, this.cfg.apiKey, model, "search_count", [domain]],
    });
  }

  /** Page through ALL rows for a domain, honoring Odoo paging. */
  async searchReadAll<T = Record<string, unknown>>(
    model: string,
    domain: unknown[],
    fields: string[],
    pageSize = 500
  ): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.searchRead<T>(model, domain, fields, { limit: pageSize, offset });
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  }
}

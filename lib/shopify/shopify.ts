/**
 * Shopify Admin API client — client-credentials grant (D-02 re-sequenced).
 *
 * Auth model: this Dev Dashboard app ("Wezesha API access") is owned by us and
 * installed on the store we own (Beauty Square), so we use the OAuth
 * **client-credentials grant** instead of the browser authorization-code flow:
 *
 *   POST https://{shop}/admin/oauth/access_token
 *   { grant_type: "client_credentials", client_id, client_secret }
 *   -> { access_token: "shpat_…", scope, expires_in: 86399 }
 *
 * The minted `shpat_` token is short-lived (~24h), so we DON'T persist it; we mint
 * on demand and cache it in-process until shortly before expiry. The durable
 * credential is the client secret (SHOPIFY_API_SECRET, app-level for the single
 * custom app; per-tenant copy stored encrypted in ShopifyConnection for
 * multi-tenant readiness).
 *
 * No @shopify/shopify-api SDK: that exists to manage authorization-code OAuth
 * *sessions*, which client-credentials does not use. Raw fetch is simpler and is
 * exactly what was verified live against the store.
 */

export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

/** Mint a fresh short-lived Admin API token via the client-credentials grant. */
async function mintAdminToken(shopDomain: string): Promise<CachedToken> {
  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("SHOPIFY_API_KEY / SHOPIFY_API_SECRET are not set.");
  }

  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Shopify client-credentials grant failed (${res.status}) for ${shopDomain}: ${body.slice(0, 200)}`
    );
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh 60s before the real expiry to avoid mid-flight 401s on long backfills.
  const expiresAt = Date.now() + Math.max(0, (json.expires_in - 60) * 1000);
  return { token: json.access_token, expiresAt };
}

/** Get a valid Admin API token for the shop, minting + caching as needed. */
export async function getAdminToken(shopDomain: string): Promise<string> {
  const cached = tokenCache.get(shopDomain);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const fresh = await mintAdminToken(shopDomain);
  tokenCache.set(shopDomain, fresh);
  return fresh.token;
}

export type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
  extensions?: { cost?: unknown };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Execute a GraphQL Admin API query against the shop. Throws on transport errors
 * and on GraphQL `errors`. One retry on 401 (token rotated/expired mid-run), and
 * up to 3 retries with backoff on transient transport failures (`fetch failed` —
 * Roy's Kenya↔EU link can drop a connection mid-backfill; a long bulk run must
 * not die on a single blip).
 */
export async function shopifyGraphql<T>(
  shopDomain: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const run = async (token: string) =>
    fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    });

  let res: Response | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await run(await getAdminToken(shopDomain));
      break;
    } catch (e) {
      lastErr = e; // transient transport error (e.g. "fetch failed") — retry
      await sleep(1000 * (attempt + 1));
    }
  }
  if (!res) {
    throw new Error(
      `Shopify GraphQL transport failed after retries: ${(lastErr as Error)?.message ?? "unknown"}`
    );
  }

  if (res.status === 401) {
    tokenCache.delete(shopDomain); // force a re-mint
    res = await run(await getAdminToken(shopDomain));
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify GraphQL HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as GraphqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!json.data) throw new Error("Shopify GraphQL returned no data.");
  return json.data;
}

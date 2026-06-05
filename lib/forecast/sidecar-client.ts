/**
 * HTTP client for the Python forecast sidecar.
 * Builds an HS256 JWT using Node built-in `crypto` (no extra dependency),
 * then POSTs to /forecast/batch and returns DemandForecast[].
 *
 * Throws on non-200 responses — callers should catch and fall back.
 */
import { createHmac } from "crypto";
import type { ForecastInput } from "./simulate-layers";
import type { DemandForecast } from "./assemble";

// ── HS256 JWT (no jsonwebtoken dep) ─────────────────────────────────────────

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function makeJwt(secret: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({ iss: "wezesha", exp: nowSec + 300 })
  );
  const sigInput = `${header}.${payload}`;
  const sig = base64url(
    createHmac("sha256", secret).update(sigInput).digest()
  );
  return `${sigInput}.${sig}`;
}

// ── Sidecar request shape (matches Python schemas.DemandRequest) ─────────────

type SidecarHistoryPoint = { date: string; quantity: number };

type SidecarItem = {
  productId: string;
  history: SidecarHistoryPoint[];
  productType: string | null;
  vendor: string | null;
  sku: string;
  abcCategory: string | null;
  runDateKey: string;
  activePromos: ForecastInput["activePromos"];
};

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function inputToSidecarItem(input: ForecastInput): SidecarItem {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return {
    productId: input.productId,
    history: input.history.map((p) => ({
      date: toDateString(p.date),
      quantity: p.quantity,
    })),
    productType: input.productType,
    vendor: input.vendor,
    sku: input.sku,
    abcCategory: input.abcCategory,
    runDateKey: input.runDateKey ?? toDateString(today),
    activePromos: input.activePromos,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Batch-call the sidecar for demand forecasts.
 * Reads FORECAST_SIDECAR_URL + FORECAST_SIDECAR_SECRET from process.env.
 * Throws on non-200 so the caller can fall back to simulateLayeredForecast.
 */
export async function forecastDemandViaSidecar(
  inputs: ForecastInput[]
): Promise<DemandForecast[]> {
  const url = process.env.FORECAST_SIDECAR_URL;
  const secret = process.env.FORECAST_SIDECAR_SECRET;

  if (!url || !secret) {
    throw new Error(
      "FORECAST_SIDECAR_URL and FORECAST_SIDECAR_SECRET must be set"
    );
  }

  const jwt = makeJwt(secret);
  const body = { items: inputs.map(inputToSidecarItem) };

  const res = await fetch(`${url}/forecast/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(
      `Sidecar /forecast/batch returned ${res.status}: ${text}`
    );
  }

  const json = (await res.json()) as { results: DemandForecast[] };
  return json.results;
}

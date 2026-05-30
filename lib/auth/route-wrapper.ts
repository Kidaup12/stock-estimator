import { NextResponse, type NextRequest } from "next/server";
import { requireTenant, TenantError, type TenantContext } from "./context";

type RouteCtx = { params?: Promise<Record<string, string>> };
type TenantHandler<C extends RouteCtx> = (
  req: NextRequest,
  ctx: C & { tenant: TenantContext }
) => Promise<Response> | Response;

/**
 * Wrap an API route handler so it runs only for an authenticated, authorized
 * tenant. Resolves the tenant via requireTenant() and passes it as `ctx.tenant`.
 * A thrown TenantError becomes the matching 401/403/404 JSON response.
 */
export function withTenant<C extends RouteCtx>(handler: TenantHandler<C>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      const tenant = await requireTenant();
      return await handler(req, { ...ctx, tenant });
    } catch (e) {
      if (e instanceof TenantError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
  };
}

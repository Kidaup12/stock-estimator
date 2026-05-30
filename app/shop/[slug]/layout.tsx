import { redirect } from "next/navigation";
import { requireTenant, TenantError } from "@/lib/auth/context";

/**
 * Auth/tenant shell for everything under /shop/[slug]/ (D-08/D-09).
 * Resolves + authorizes the tenant server-side via requireTenant(slug):
 *  - 401 (no session) -> /login
 *  - 403 (not a member) / 404 (unknown slug) -> / (root routes by membership)
 * Also provides the sign-out control (D-05 — logout from every authed page).
 */
export default async function ShopLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  try {
    await requireTenant(slug);
  } catch (e) {
    if (e instanceof TenantError) {
      if (e.status === 401) redirect("/login");
      redirect("/"); // 403 / 404 -> let the root redirect route by membership
    }
    throw e;
  }

  return (
    <div>
      <div className="flex justify-end items-center gap-3 px-4 py-2 border-b border-line bg-canvas-raised">
        <span className="text-2xs text-mute font-mono">{slug}</span>
        <form action="/auth/signout" method="post">
          <button type="submit" className="text-sm text-mute hover:text-ink transition">
            Sign out
          </button>
        </form>
      </div>
      {children}
    </div>
  );
}

import { redirect } from "next/navigation";
import { requireTenant, TenantError } from "@/lib/auth/context";
import { RoleProvider } from "@/lib/auth/role-context";
import type { Role } from "@/lib/auth/money-visibility";
import ShopNav from "./nav";

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

  let role: Role = "MEMBER"; // least-privilege default
  try {
    const ctx = await requireTenant(slug);
    role = ctx.membership.role as Role;
  } catch (e) {
    if (e instanceof TenantError) {
      if (e.status === 401) redirect("/login");
      redirect("/"); // 403 / 404 -> let the root redirect route by membership
    }
    throw e;
  }

  return (
    <RoleProvider role={role}>
      <div>
        <ShopNav slug={slug} />
        {/* Content sits right of the fixed 232px rail on lg+; full-width under the mobile top bar. */}
        <div className="lg:pl-[232px]">{children}</div>
      </div>
    </RoleProvider>
  );
}

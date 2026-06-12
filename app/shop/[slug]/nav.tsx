"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useIsOwner } from "@/lib/auth/role-context";

/**
 * App shell navigation — GoHighLevel-style left rail (DESIGN.md "App Shell").
 *
 * ≥lg: fixed 232px sidebar; the layout offsets content with lg:pl-[232px].
 * <lg: slim top bar with a hamburger that opens the same rail as a slide-over.
 * Active item: bg-canvas-tint + ink + medium weight. No side-stripes.
 */
export default function ShopNav({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer on navigation + lock body scroll while open.
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 h-14 flex items-center gap-3 px-4 border-b border-line bg-canvas-raised/95 backdrop-blur">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="h-9 w-9 -ml-1 inline-flex items-center justify-center rounded-lg text-ink-soft hover:bg-canvas-tint transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13" />
          </svg>
        </button>
        <Brand slug={slug} />
        <span className="ml-auto text-2xs text-mute font-mono">{slug}</span>
      </header>

      {/* Mobile slide-over */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-ink-deep/30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-[260px] bg-canvas-raised border-r border-line shadow-lift flex flex-col animate-[rail-in_180ms_cubic-bezier(0.22,1,0.36,1)]">
            <RailContent slug={slug} pathname={pathname} />
          </div>
        </div>
      )}

      {/* Desktop fixed rail */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-[232px] flex-col border-r border-line bg-canvas-raised">
        <RailContent slug={slug} pathname={pathname} />
      </aside>
    </>
  );
}

function Brand({ slug }: { slug: string }) {
  return (
    <Link href={`/shop/${slug}/dashboard`} className="flex items-center gap-2.5 min-w-0">
      <div className="h-7 w-7 shrink-0 rounded-lg bg-gradient-to-br from-accent-500 to-accent-700" />
      <div className="min-w-0 leading-tight">
        <div className="text-[15px] font-semibold tracking-tight truncate">Wezesha</div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-mute">Restock OS</div>
      </div>
    </Link>
  );
}

function RailContent({ slug, pathname }: { slug: string; pathname: string }) {
  const owner = useIsOwner();
  const base = `/shop/${slug}`;
  // Restock Planner (budgets) + Settings are OWNER-only (Dave DoD §7).
  const workflow = [
    { href: `${base}/dashboard`, label: "Dashboard", icon: <IconGrid /> },
    ...(owner ? [{ href: `${base}/restock-planner`, label: "Restock Planner", icon: <IconWallet /> }] : []),
    { href: `${base}/products`, label: "Products", icon: <IconBox /> },
    { href: `${base}/orders`, label: "Orders", icon: <IconTruck /> },
    { href: `${base}/reports`, label: "Reports", icon: <IconChart /> },
  ];
  const setup = [
    { href: `${base}/getting-started`, label: "How it works", icon: <IconHelp /> },
    { href: `${base}/promos`, label: "Promo calendar", icon: <IconTag /> },
    ...(owner ? [{ href: `${base}/settings`, label: "Settings", icon: <IconGear /> }] : []),
  ];
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      <div className="px-4 h-16 flex items-center border-b border-line/70">
        <Brand slug={slug} />
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-6">
        <div className="space-y-0.5">
          {workflow.map((l) => <RailLink key={l.href} {...l} active={isActive(l.href)} />)}
        </div>
        <div>
          <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-mute/80">Setup</div>
          <div className="space-y-0.5">
            {setup.map((l) => <RailLink key={l.href} {...l} active={isActive(l.href)} />)}
          </div>
        </div>
      </nav>

      <SyncStatus />

      <div className="px-4 py-3.5 border-t border-line/70 flex items-center justify-between gap-2">
        <span className="text-2xs text-mute font-mono truncate px-2 py-1 rounded-md bg-canvas-tint border border-line">{slug}</span>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            title="Sign out"
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-mute hover:text-ink hover:bg-canvas-tint transition-colors"
          >
            <IconSignOut />
          </button>
        </form>
      </div>
    </>
  );
}

type SyncInfo = { lastSyncAt: string | null; lastSyncError: string | null; lastSyncOkAt: string | null };

/**
 * Sync-health badge (Dave DoD §1). Polls /api/shop/status every 60s.
 *  - red when the last reconcile FAILED (visible warning, not silent),
 *  - amber when stale (> 2h since last sync),
 *  - muted "Synced X ago" otherwise.
 */
function SyncStatus() {
  const [info, setInfo] = useState<SyncInfo | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/shop/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && d?.shopify) {
            setInfo({
              lastSyncAt: d.shopify.lastSyncAt ?? null,
              lastSyncError: d.shopify.lastSyncError ?? null,
              lastSyncOkAt: d.shopify.lastSyncOkAt ?? null,
            });
          }
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (info === undefined) return null; // not loaded yet

  if (info?.lastSyncError) {
    const okRel = info.lastSyncOkAt ? formatSync(info.lastSyncOkAt).label.replace("Synced ", "") : "never";
    return (
      <div className="px-4 pb-2.5">
        <span
          className="inline-flex items-center gap-1.5 text-2xs text-status-bad"
          title={`Last sync failed: ${info.lastSyncError}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          Sync failed · last ok {okRel}
        </span>
      </div>
    );
  }

  const { label, stale } = formatSync(info?.lastSyncAt ?? null);
  return (
    <div className="px-4 pb-2.5">
      <span
        className={`inline-flex items-center gap-1.5 text-2xs ${stale ? "text-status-warn" : "text-mute"}`}
        title="Last Shopify sync"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
        {label}
      </span>
    </div>
  );
}

function formatSync(iso: string | null): { label: string; stale: boolean } {
  if (!iso) return { label: "Never synced", stale: true };
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  let rel: string;
  if (min < 1) rel = "just now";
  else if (min < 60) rel = `${min}m ago`;
  else {
    const h = Math.floor(min / 60);
    rel = h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
  }
  return { label: `Synced ${rel}`, stale: ms > 2 * 60 * 60 * 1000 };
}

function RailLink({ href, label, icon, active }: { href: string; label: string; icon: ReactNode; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300 ${
        active
          ? "bg-canvas-tint text-ink font-medium"
          : "text-ink-soft hover:bg-canvas hover:text-ink"
      }`}
    >
      <span className={`shrink-0 ${active ? "text-accent-700" : "text-mute"}`}>{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

/* ── 16px stroke icons (1.5px, round caps) ─────────────────────────────────── */

const ic = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function IconGrid() {
  return <svg {...ic}><rect x="1.8" y="1.8" width="5.2" height="5.2" rx="1.2" /><rect x="9" y="1.8" width="5.2" height="5.2" rx="1.2" /><rect x="1.8" y="9" width="5.2" height="5.2" rx="1.2" /><rect x="9" y="9" width="5.2" height="5.2" rx="1.2" /></svg>;
}
function IconBox() {
  return <svg {...ic}><path d="M2 5.2 8 2l6 3.2v5.6L8 14l-6-3.2V5.2Z" /><path d="M2 5.2 8 8.4l6-3.2M8 8.4V14" /></svg>;
}
function IconTruck() {
  return <svg {...ic}><path d="M1.8 3.5h7.4v7H1.8zM9.2 6h3l2 2.4v2.1h-5" /><circle cx="4.6" cy="12.4" r="1.4" /><circle cx="11.6" cy="12.4" r="1.4" /></svg>;
}
function IconWallet() {
  return <svg {...ic}><rect x="1.8" y="3.6" width="12.4" height="9" rx="1.6" /><path d="M10.4 8.1h3.8M1.8 6h12.4" /></svg>;
}
function IconChart() {
  return <svg {...ic}><path d="M2 14h12M4 11V7M8 11V3.6M12 11V5.6" /></svg>;
}
function IconTag() {
  return <svg {...ic}><path d="m8.6 1.9 5.5 5.5a1.5 1.5 0 0 1 0 2.1l-4.6 4.6a1.5 1.5 0 0 1-2.1 0L1.9 8.6V1.9h6.7Z" /><circle cx="5.2" cy="5.2" r="1" fill="currentColor" stroke="none" /></svg>;
}
function IconGear() {
  return <svg {...ic}><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.9M8 12.3v1.9M1.8 8h1.9M12.3 8h1.9M3.6 3.6l1.35 1.35M11.05 11.05l1.35 1.35M12.4 3.6l-1.35 1.35M4.95 11.05 3.6 12.4" /></svg>;
}
function IconSignOut() {
  return <svg {...ic}><path d="M6 2h-2.5A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14H6M10.5 11 14 8l-3.5-3M14 8H6" /></svg>;
}
function IconHelp() {
  return <svg {...ic}><circle cx="8" cy="8" r="6.2" /><path d="M6.2 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.8.6-.8 1.1v.4" /><circle cx="8" cy="11.6" r="0.55" fill="currentColor" stroke="none" /></svg>;
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Shared top navigation for every page under /shop/[slug]/.
 * Sticky, light, dense — one place for brand, primary pages, secondary "More"
 * menu, tenant badge and sign-out. Per-page ad-hoc headers were removed in
 * favour of this (W6 premium pass).
 */
export default function ShopNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/shop/${slug}`;

  const primary = [
    { href: `${base}/dashboard`, label: "Dashboard" },
    { href: `${base}/products`, label: "Products" },
    { href: `${base}/orders`, label: "Orders" },
    { href: `${base}/restock-planner`, label: "Restock Planner" },
    { href: `${base}/reports`, label: "Reports" },
  ];
  const secondary = [
    { href: `${base}/suppliers`, label: "Suppliers" },
    { href: `${base}/promos`, label: "Promo calendar" },
    { href: `${base}/settings`, label: "Settings" },
    { href: "/pricing", label: "Pricing" },
    { href: "/contact", label: "Contact" },
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const moreActive = secondary.some((s) => isActive(s.href));

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas-raised/95 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 flex items-center gap-1 h-14">
        <Link href={`${base}/dashboard`} className="flex items-center gap-2.5 pr-3 shrink-0">
          <div className="h-6 w-6 rounded-md bg-gradient-to-br from-accent-500 to-accent-700" />
          <span className="text-[15px] font-semibold tracking-tight hidden sm:inline">Wezesha</span>
        </Link>

        <nav className="flex items-center gap-0.5 overflow-x-auto flex-1 min-w-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {primary.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`relative px-3 py-2 text-sm rounded-lg whitespace-nowrap transition ${
                isActive(l.href)
                  ? "text-ink font-medium bg-canvas-tint"
                  : "text-mute hover:text-ink hover:bg-canvas"
              }`}
            >
              {l.label}
            </Link>
          ))}
          <MoreMenu items={secondary} active={moreActive} />
        </nav>

        <div className="flex items-center gap-3 shrink-0 pl-2">
          <span className="hidden md:inline text-2xs text-mute font-mono px-2 py-1 rounded-md bg-canvas-tint border border-line">{slug}</span>
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-2xs uppercase tracking-wider text-mute hover:text-ink transition">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

function MoreMenu({ items, active }: { items: { href: string; label: string }[]; active: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Close on navigation.
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`px-3 py-2 text-sm rounded-lg whitespace-nowrap transition flex items-center gap-1 ${
          active ? "text-ink font-medium bg-canvas-tint" : "text-mute hover:text-ink hover:bg-canvas"
        }`}
      >
        More <span className={`text-2xs transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-44 rounded-xl border border-line bg-canvas-raised shadow-lift py-1.5 z-30">
          {items.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="block px-3.5 py-2 text-sm text-ink-soft hover:bg-canvas-tint hover:text-ink transition"
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

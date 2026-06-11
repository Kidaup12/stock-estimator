# Design

Captured from the live code (app/globals.css, Tailwind v4 `@theme`) plus the 2026-06-11 sidebar shell decision. This is the source of truth for visual choices; tokens below are the real values in production.

## Theme

Light only. Scene: a shop owner at a bright Nairobi counter mid-morning, deciding what to spend KES 800k on. Light surfaces, high-contrast ink, no dark mode.

## App Shell

GoHighLevel-style **left sidebar** (the only global nav):

- Fixed rail, 232px wide on ≥lg screens; icon + label rows; section split: primary workflow pages (Dashboard, Products, Orders, Restock Planner, Reports) then a quiet divider, then setup pages (Suppliers, Promo calendar, Settings).
- Brand block (logo mark + "Wezesha") top; tenant chip + sign-out pinned at the bottom.
- Active item: `bg-canvas-tint` + ink text + 600 weight; no side-stripes.
- Mobile (<lg): rail hidden; slim top bar with hamburger opening the same rail as a slide-over (overlay, ease-out, ≤200ms).
- Content area scrolls independently; page content max-width stays per page (3xl–7xl) inside the shell.

## Color Palette

Neutrals are violet-tinted, never pure black/white.

- Canvas: `#fafafa` (base), `#ffffff` (raised), `#f3f2f8` (tint)
- Ink: `#17171c` (default), `#0b0b10` (deep), `#3f3f46` (soft), `#71717a` (mute)
- Line: `#e7e6ee`
- Accent (purple, Restrained strategy — primary actions + active states only, ≤10% of surface): 50 `#f3f1ff` · 100 `#e6e2ff` · 200 `#cfc6ff` · 300 `#ada0f5` · 400 `#8e7eea` · 500 `#7a68e2` · 600 `#6d5cd6` · 700 `#5a4bbf` · 800 `#443697`
- Status: ok `#15803d` · warn `#b45309` · bad `#b91c1c` · crit `#7f1d1d`
- Category chips: LOCAL = ok-tint, KOREAN = accent-tint, WESTERN = blue-tint

## Typography

- Sans: Inter (`--font-inter`), tight letter-spacing (-0.005em), cv02/03/04/11 features.
- Mono: JetBrains Mono for every number (`.num`, tabular-nums). Numbers are the hero; KES totals and days-of-cover get size + weight, labels stay 2xs uppercase mute.
- Scale in use: 2xs (0.6875rem) labels · sm body · base section titles · xl page titles · 2xl KPI values.

## Components

- `.card`: white, rounded-2xl, 1px line border, soft shadow. No nested cards.
- `.btn-accent` (primary), `.btn-primary` (ink), `.btn-ghost` (bordered) — all min-h 40px.
- `.badge-{ok,warn,bad,info,mute}` chips for status; never side-stripe borders.
- `.page-eyebrow / .page-title / .page-sub` header block on every page; primary page action sits right of the title.
- `.skeleton` shimmer for loading; no bare "Loading…" text on new surfaces.
- Tables: 2xs uppercase mute headers on canvas, divide-y line rows, row hover `bg-canvas`, sticky header in tall scrollers, right-aligned `.num` columns.

## Motion

Functional only: 150–200ms, ease-out. Sidebar slide-over and dropdowns ease-out; no bounce, no layout-property animation, honors `prefers-reduced-motion`.

## Shadows

- soft: `0 1px 2px rgba(17,17,30,.04), 0 1px 3px rgba(17,17,30,.05)`
- lift (menus/overlays): `0 10px 28px rgba(109,92,214,.20)`

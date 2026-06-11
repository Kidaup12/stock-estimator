# Product

## Register

product

## Users

Two audiences, one surface:

1. **Mary** — owner-operator of Beauty Square, a Nairobi beauty retailer on Shopify. Checks the app in the morning at the shop counter (bright room, mid-range laptop or phone) to answer one question: *what do I order this week, from which supplier, with the cash I have?* She is not technical; she trusts numbers that look stable and explainable. Decisions are denominated in KES and in days-of-cover.
2. **Investors / prospects** (via Roy and SimplyDone Africa) — see the app in demos and screenshots. The interface must read as a fundable SaaS platform, not an internal tool.

## Product Purpose

Wezesha Restock OS tells beauty retailers when and what to reorder. It syncs Shopify nightly, forecasts demand with a recency-weighted run rate (capped, no speculative boosts), tracks stock en route, and turns a cash budget into a supplier-ready order sheet. Success = Mary orders from the app's list weekly and never runs out of an A-class product; demo viewers ask "when can we onboard our shop?".

## Brand Personality

Calm, capable, decisive. Three words: **trustworthy, operator-grade, quietly premium**. The app should feel like a competent ops manager: confident numbers, no drama, no decoration that doesn't earn its place. Reference feel: Stripe Dashboard's calm light surfaces + Shopify Admin's table density + GoHighLevel's left-rail app shell.

## Anti-references

- Generic admin-template look (Bootstrap dashboards, identical stat-card grids, gradient hero metrics).
- Crypto/neon "AI tool" aesthetics; dark mode for coolness' sake (Mary works in daylight).
- Toy-like over-rounded consumer apps; anything that undermines "this number is safe to spend money on".
- Internal-tool sloppiness: ad-hoc per-page headers, alert() dialogs, "Loading…" text.

## Design Principles

1. **The number is the product.** Forecasts, days-of-cover and KES totals get the strongest type hierarchy on every screen; decoration never competes with them.
2. **One glance, one decision.** Each page answers a single operator question (what's at risk / what do I order / what's on the way). Secondary analytics fold away.
3. **Dense tables, calm chrome.** Operator data stays dense and scannable; the shell around it stays quiet, light and consistent.
4. **Show the safety rails.** Caps, en-route stock and category cover windows are visible in the UI so trust is earned, not asked for.
5. **Premium by restraint.** Light theme, tinted neutrals, one purple accent doing real work (primary actions, active states), nothing else shouting.

## Accessibility & Inclusion

- Target WCAG AA contrast on text and controls (Mary's bright-room laptop is the worst case: avoid low-contrast greys).
- Touch targets ≥40px (phone use at the counter); tables degrade with horizontal scroll, never hidden data.
- Respect `prefers-reduced-motion`; motion is sub-200ms and functional only.
- Numbers always tabular-lined (`num` class) so columns scan without jitter.

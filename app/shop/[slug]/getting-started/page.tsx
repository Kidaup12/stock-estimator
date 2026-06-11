import Link from "next/link";

/**
 * Getting Started / How it works — a GENERIC explainer shown to every tenant.
 * It teaches the model (what's automatic, what's set up once, what's ongoing, and
 * how a recommendation is built). No shop is named or special-cased; live per-shop
 * state lives on Settings, not here.
 */
export default async function GettingStartedPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const base = `/shop/${slug}`;

  return (
    <main className="min-h-screen bg-canvas">
      <div className="max-w-3xl mx-auto px-5 sm:px-8 py-7">
        <div className="mb-7">
          <div className="text-2xs uppercase tracking-wider text-mute">Getting started</div>
          <h1 className="text-xl font-semibold tracking-tight mt-0.5">How Wezesha works</h1>
          <p className="text-sm text-ink-soft mt-2 leading-relaxed max-w-prose">
            Wezesha tells you what to reorder this week, how much, and from which supplier — then
            builds the purchase order for you. Most of the data flows in on its own. Here&apos;s the
            full picture so you know exactly what&apos;s automatic and what needs you.
          </p>
        </div>

        <div className="space-y-4">
          <Step
            n={1}
            title="Automatic — nothing to do"
            tone="ok"
            badge="Hands-off"
          >
            <p>We keep your data current so you don&apos;t have to:</p>
            <ul className="mt-2 space-y-1.5">
              <Item>Sales history per product, daily</Item>
              <Item>Current stock levels</Item>
              <Item>Selling prices and your product catalogue</Item>
              <Item>New products are detected as you add them</Item>
              <Item>
                Stock-level history — your store doesn&apos;t keep this, so we build it from every
                sync (stockout dates fall out of it for free)
              </Item>
              <Item>
                If your accounting (e.g. QuickBooks) is connected, cost prices and recent purchase
                orders flow in too
              </Item>
            </ul>
          </Step>

          <Step
            n={2}
            title="Set up once"
            tone="info"
            badge="With your setup team"
          >
            <p>
              Done once during onboarding — usually together with your setup team. It takes a couple
              of hours and then you&apos;re set:
            </p>
            <ul className="mt-2 space-y-1.5">
              <Item>
                Cost price per product — needed for the buy math. A product with no cost is left out
                of recommendations until it has one.
              </Item>
              <Item>A quick stock-count check on your top sellers</Item>
              <Item>
                <Link href={`${base}/suppliers`} className="text-accent-700 hover:underline">
                  Suppliers
                </Link>{" "}
                — who you buy from, which products map to them, and rough lead times
              </Item>
              <Item>Pack sizes / minimum order quantities for your top movers</Item>
              <Item>Your last few months of past orders (what, when, from whom)</Item>
              <Item>A &ldquo;kill list&rdquo; of dead or discontinued products</Item>
              <Item>Shelf-life by category (e.g. skincare 12 months, makeup 18 months)</Item>
              <Item>
                Who can sign in — set up{" "}
                <Link href={`${base}/settings`} className="text-accent-700 hover:underline">
                  users and roles
                </Link>
              </Item>
            </ul>
          </Step>

          <Step
            n={3}
            title="Ongoing — keep it short"
            tone="warn"
            badge="A few seconds, now and then"
          >
            <p>The habit that keeps recommendations sharp is deliberately tiny:</p>
            <ul className="mt-2 space-y-1.5">
              <Item>Mark items as ordered from the buy list — it&apos;s part of ordering anyway</Item>
              <Item>Mark orders as received when stock arrives</Item>
              <Item>
                Add upcoming{" "}
                <Link href={`${base}/promos`} className="text-accent-700 hover:underline">
                  promos
                </Link>{" "}
                to the calendar when you plan them
              </Item>
              <Item>Set cost, supplier and pack size for new products as you add them</Item>
              <Item>Update a lead time if a supplier changes — rare</Item>
            </ul>
          </Step>
        </div>

        <section className="card p-6 mt-4">
          <h2 className="text-base font-semibold tracking-tight">How a recommendation is made</h2>
          <p className="text-sm text-ink-soft mt-1.5 leading-relaxed max-w-prose">
            Every number is built the same way, so you can trust it:
          </p>
          <div className="mt-4 rounded-xl border border-line bg-canvas-tint px-4 py-3 text-sm text-ink-soft leading-relaxed">
            recent sales rate × supplier lead time
            <span className="text-mute"> + </span>
            safety stock
            <span className="text-mute"> − </span>
            stock on hand
            <span className="text-mute"> − </span>
            stock already on order
          </div>
          <p className="text-sm text-ink-soft mt-3 leading-relaxed max-w-prose">
            The sales rate is weighted toward recent weeks and adjusted for paydays, public holidays,
            and any promos you&apos;ve entered. Safety stock grows with how unpredictable a
            supplier&apos;s lead time is. Every recommendation shows its reasoning so you can see why.
          </p>
        </section>

        <section className="card p-6 mt-4 bg-accent-50 border-accent-100">
          <h2 className="text-base font-semibold tracking-tight text-accent-700">Ready to check your setup?</h2>
          <p className="text-sm text-ink-soft mt-1.5 leading-relaxed">
            Settings shows live status for your shop — what&apos;s connected, cost coverage, suppliers
            and more.
          </p>
          <div className="mt-4 flex gap-2 flex-wrap">
            <Link href={`${base}/settings`} className="btn-accent">Go to Settings</Link>
            <Link href={`${base}/dashboard`} className="btn-ghost">Open dashboard</Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function Step({
  n,
  title,
  badge,
  tone,
  children,
}: {
  n: number;
  title: string;
  badge: string;
  tone: "ok" | "info" | "warn";
  children: React.ReactNode;
}) {
  const badgeClass = tone === "ok" ? "badge-ok" : tone === "warn" ? "badge-warn" : "badge-info";
  return (
    <section className="card p-6">
      <div className="flex items-start gap-3">
        <div className="shrink-0 h-7 w-7 rounded-lg bg-canvas-tint border border-line flex items-center justify-center text-sm font-semibold text-ink-soft num">
          {n}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            <span className={badgeClass}>{badge}</span>
          </div>
          <div className="text-sm text-ink-soft mt-2 leading-relaxed">{children}</div>
        </div>
      </div>
    </section>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-mute select-none mt-0.5">·</span>
      <span>{children}</span>
    </li>
  );
}

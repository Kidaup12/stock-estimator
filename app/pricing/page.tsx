import Link from "next/link";

type Tier = {
  name: string;
  priceKes: number;
  tagline: string;
  audience: string;
  features: string[];
  inherits?: string;
  cta: string;
  ctaHref: string;
  highlight?: boolean;
  badge?: string;
};

const TIERS: Tier[] = [
  {
    name: "Starter",
    priceKes: 8500,
    tagline: "For solo founders and small brands just getting serious about inventory.",
    audience: "Solo founder · small brand",
    cta: "Start with Starter",
    ctaHref: "/contact",
    features: [
      "Up to KES 1.5M monthly revenue",
      "1 system integration",
      "2 globally proven forecasting models",
      "Forecasting tuned for the Kenyan market (paydays, holidays, school terms)",
      "Promo calendar and reorder alerts via email",
      "Weekly forecast dashboard",
      "Email support",
    ],
  },
  {
    name: "Growth",
    priceKes: 18500,
    tagline: "For established beauty brands ready to scale without stockouts.",
    audience: "Established brand · scaling",
    cta: "Choose Growth",
    ctaHref: "/contact",
    highlight: true,
    badge: "Most popular",
    inherits: "Everything in Starter, plus",
    features: [
      "Up to KES 6M monthly revenue",
      "2 system integrations",
      "3 globally proven forecasting models",
      "AI forecasting with Google Trends, weather and FX signals",
      "Multi-channel sales (Shopify + Jumia)",
      "Auto-calculated safety stock and PO suggestions",
      "Onboarding call and email support",
    ],
  },
  {
    name: "Scale",
    priceKes: 42000,
    tagline: "For multi-brand groups, distributors and larger players.",
    audience: "Multi-brand · distributor",
    cta: "Talk to us",
    ctaHref: "/contact",
    inherits: "Everything in Growth, plus",
    features: [
      "Revenue above KES 6M monthly",
      "3 system integrations",
      "4 globally proven forecasting models",
      "Multi-warehouse and multi-brand support",
      "Custom features and API access",
      "Monthly planner check-ins and quarterly model retraining",
    ],
  },
];

const KES = (n: number) => n.toLocaleString("en-KE");

const CONTACT_EMAIL = "wezesha@simplydoneafrica.com";
const CONTACT_WHATSAPP_DISPLAY = "+254 758 158 195";
const CONTACT_WHATSAPP_LINK = "https://wa.me/254758158195";

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-canvas flex flex-col">
      <header className="border-b border-line bg-canvas/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-baseline gap-2.5">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-accent-500 to-accent-700" />
            <span className="text-base font-semibold tracking-tight">Wezesha Restock OS</span>
            <span className="hidden sm:inline text-2xs text-mute uppercase tracking-[0.18em]">Pricing</span>
          </Link>
          <Link href="/contact" className="text-2xs uppercase tracking-wider text-mute hover:text-ink transition">
            Contact
          </Link>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute -top-32 -right-24 w-[420px] h-[420px] bg-accent-200/40 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -left-20 w-[320px] h-[320px] bg-accent-100/60 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-3xl mx-auto px-5 sm:px-8 pt-14 sm:pt-20 pb-10 sm:pb-14 text-center">
          <div className="text-2xs uppercase tracking-[0.22em] text-accent-700 font-semibold mb-5">
            Pricing
          </div>
          <h1 className="text-[2rem] sm:text-[2.75rem] font-semibold leading-[1.06] tracking-tight">
            <span className="text-gradient">One platform.</span>
            <br className="hidden sm:block" /> Three sizes.
          </h1>
          <p className="text-ink-soft mt-5 sm:mt-6 text-base sm:text-lg leading-relaxed max-w-xl mx-auto">
            Plans are priced by monthly revenue, not catalogue size.
            A 2,000-item shop doing modest sales pays the same as a 50-item one.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 sm:px-8 pb-16 sm:pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">
          {TIERS.map(t => <TierCard key={t.name} tier={t} />)}
        </div>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-px bg-line border border-line rounded-2xl overflow-hidden shadow-soft">
          <FactCell label="Billing" value="Monthly, KES" hint="Annual plans available on request" />
          <FactCell label="Setup" value="Self-serve" hint="Onboarding included from Growth up" />
          <FactCell label="Contracts" value="Month-to-month" hint="Cancel any time, no lock-in" />
        </div>

        <div className="mt-10 card p-6 sm:p-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
            <div>
              <div className="text-2xs uppercase tracking-wider text-accent-700 font-semibold">Talk to us</div>
              <h2 className="text-lg font-semibold tracking-tight mt-1">Not sure which plan fits?</h2>
              <p className="text-sm text-ink-soft mt-2 leading-relaxed">
                Send us your monthly revenue and channel mix.
                We&apos;ll point you to the right plan.
              </p>
            </div>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="rounded-xl border border-line hover:border-accent-300 hover:bg-accent-50/40 transition p-4 block"
            >
              <div className="text-2xs uppercase tracking-wider text-mute mb-1">Email</div>
              <div className="font-medium text-ink num break-all">{CONTACT_EMAIL}</div>
            </a>
            <a
              href={CONTACT_WHATSAPP_LINK}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-line hover:border-accent-300 hover:bg-accent-50/40 transition p-4 block"
            >
              <div className="text-2xs uppercase tracking-wider text-mute mb-1">WhatsApp</div>
              <div className="font-medium text-ink num">{CONTACT_WHATSAPP_DISPLAY}</div>
            </a>
          </div>
          <div className="mt-5 text-center">
            <Link href="/contact" className="text-2xs uppercase tracking-wider text-accent-700 hover:text-accent-800 font-semibold">
              Or fill in the contact form →
            </Link>
          </div>
        </div>

        <p className="text-2xs uppercase tracking-wider text-mute text-center mt-10">
          Prices in KES, exclusive of VAT.
        </p>
      </section>

      <footer className="border-t border-line mt-auto">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6 text-center text-2xs uppercase tracking-wider text-mute">
          Wezesha Restock OS — a product of{" "}
          <span className="text-ink-soft">SimplyDone Africa</span>
        </div>
      </footer>
    </main>
  );
}

function TierCard({ tier }: { tier: Tier }) {
  const ring = tier.highlight
    ? "border-accent-300 shadow-lift bg-canvas-raised ring-1 ring-accent-200"
    : "border-line shadow-soft bg-canvas-raised";

  return (
    <div className={`relative rounded-2xl border p-6 sm:p-7 flex flex-col ${ring}`}>
      {tier.badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="text-2xs uppercase tracking-[0.18em] font-semibold px-3 py-1 rounded-full bg-accent-600 text-white shadow-soft">
            {tier.badge}
          </span>
        </div>
      )}

      <div className="text-2xs uppercase tracking-wider text-mute">{tier.audience}</div>
      <div className="text-xl font-semibold tracking-tight mt-1">{tier.name}</div>

      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="text-2xs uppercase tracking-wider text-mute">KES</span>
        <span className="text-[2.25rem] leading-none font-semibold num tracking-tight">
          {KES(tier.priceKes)}
        </span>
        <span className="text-sm text-mute">/ month</span>
      </div>

      <p className="text-sm text-ink-soft leading-relaxed mt-4">{tier.tagline}</p>

      <Link
        href={tier.ctaHref}
        className={`mt-6 ${tier.highlight ? "btn-accent" : "btn-ghost"} w-full`}
      >
        {tier.cta}
      </Link>

      <div className="border-t border-line mt-7 pt-5">
        {tier.inherits && (
          <div className="text-2xs uppercase tracking-wider text-accent-700 font-semibold mb-3">
            {tier.inherits}
          </div>
        )}
        <ul className="space-y-2.5">
          {tier.features.map(f => (
            <li key={f} className="flex items-start gap-2.5 text-sm text-ink leading-relaxed">
              <Check />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Check() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="w-4 h-4 mt-0.5 flex-shrink-0 text-accent-600"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10.5l3.5 3.5L16 6" />
    </svg>
  );
}

function FactCell({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-canvas-raised p-5 text-center sm:text-left">
      <div className="text-2xs uppercase tracking-wider text-mute">{label}</div>
      <div className="text-base font-semibold tracking-tight mt-1">{value}</div>
      <div className="text-2xs text-mute mt-1">{hint}</div>
    </div>
  );
}

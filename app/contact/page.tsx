"use client";

import { useState } from "react";
import Link from "next/link";

const EMAIL = "wezesha@simplydoneafrica.com";
const WHATSAPP_DISPLAY = "+254 758 158 195";
const WHATSAPP_LINK = "https://wa.me/254758158195";

const REVENUE_BANDS = [
  "Under KES 1.5M / month",
  "KES 1.5M – 6M / month",
  "Over KES 6M / month",
  "Not sure yet",
];

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [business, setBusiness] = useState("");
  const [revenue, setRevenue] = useState(REVENUE_BANDS[0]);
  const [message, setMessage] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = [
      `Name: ${name}`,
      `Email: ${email}`,
      `Business: ${business}`,
      `Monthly revenue: ${revenue}`,
      "",
      message,
    ].join("\n");
    const url = `mailto:${EMAIL}?subject=${encodeURIComponent(
      `Wezesha enquiry — ${business || name || "new contact"}`
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
  }

  return (
    <main className="min-h-screen bg-canvas flex flex-col">
      <header className="border-b border-line bg-canvas/90 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-baseline gap-2.5">
            <div className="h-6 w-6 rounded-md bg-gradient-to-br from-accent-500 to-accent-700" />
            <span className="text-base font-semibold tracking-tight">Wezesha Restock OS</span>
            <span className="hidden sm:inline text-2xs text-mute uppercase tracking-[0.18em]">Contact</span>
          </Link>
          <Link href="/pricing" className="text-2xs uppercase tracking-wider text-mute hover:text-ink transition">
            See pricing
          </Link>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute -top-32 -right-24 w-[420px] h-[420px] bg-accent-200/40 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -left-20 w-[320px] h-[320px] bg-accent-100/60 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-3xl mx-auto px-5 sm:px-8 pt-14 sm:pt-20 pb-8 sm:pb-10 text-center">
          <div className="text-2xs uppercase tracking-[0.22em] text-accent-700 font-semibold mb-5">
            Get in touch
          </div>
          <h1 className="text-[2rem] sm:text-[2.75rem] font-semibold leading-[1.06] tracking-tight">
            <span className="text-gradient">Let&apos;s talk</span>
            <br className="hidden sm:block" /> about your stock.
          </h1>
          <p className="text-ink-soft mt-5 sm:mt-6 text-base sm:text-lg leading-relaxed max-w-xl mx-auto">
            Fill in the form and we&apos;ll reply within one business day.
            Prefer something faster? Email or WhatsApp us directly.
          </p>
        </div>
      </section>

      <section className="max-w-6xl w-full mx-auto px-5 sm:px-8 pb-14 sm:pb-20 flex-1">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <form onSubmit={handleSubmit} className="card p-6 sm:p-7 lg:col-span-3 space-y-4">
            <div className="mb-2">
              <div className="text-2xs uppercase tracking-wider text-mute">Send a message</div>
              <h2 className="text-base font-semibold tracking-tight mt-1">Tell us about your business</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldLabel label="Your name">
                <input className="input" required value={name} onChange={e => setName(e.target.value)} placeholder="Jane Wanjiru" />
              </FieldLabel>
              <FieldLabel label="Email">
                <input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.co.ke" />
              </FieldLabel>
              <FieldLabel label="Business name">
                <input className="input" value={business} onChange={e => setBusiness(e.target.value)} placeholder="Beauty Square KE" />
              </FieldLabel>
              <FieldLabel label="Monthly revenue">
                <select className="input" value={revenue} onChange={e => setRevenue(e.target.value)}>
                  {REVENUE_BANDS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </FieldLabel>
            </div>

            <FieldLabel label="What would you like to discuss?">
              <textarea
                className="input min-h-[140px] py-3 resize-y"
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="A bit about your stock, channels, and what you'd like to fix first."
              />
            </FieldLabel>

            <button type="submit" className="btn-accent w-full">
              Send message
            </button>
            <p className="text-2xs text-mute text-center">
              Opens your email app prefilled. We respond within one business day.
            </p>
          </form>

          <aside className="lg:col-span-2 space-y-4">
            <div className="card p-6 sm:p-7">
              <div className="text-2xs uppercase tracking-wider text-mute">Direct channels</div>
              <h2 className="text-base font-semibold tracking-tight mt-1 mb-5">Reach us right now</h2>

              <a
                href={`mailto:${EMAIL}`}
                className="block rounded-xl border border-line hover:border-accent-300 hover:bg-accent-50/40 transition p-4"
              >
                <div className="text-2xs uppercase tracking-wider text-mute mb-1">Email</div>
                <div className="font-medium text-ink num break-all">{EMAIL}</div>
                <div className="text-2xs text-accent-700 mt-2 uppercase tracking-wider font-semibold">Open mail app →</div>
              </a>

              <a
                href={WHATSAPP_LINK}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl border border-line hover:border-accent-300 hover:bg-accent-50/40 transition p-4 mt-3"
              >
                <div className="text-2xs uppercase tracking-wider text-mute mb-1">WhatsApp</div>
                <div className="font-medium text-ink num">{WHATSAPP_DISPLAY}</div>
                <div className="text-2xs text-accent-700 mt-2 uppercase tracking-wider font-semibold">Open WhatsApp →</div>
              </a>
            </div>

            <div className="card p-6 sm:p-7">
              <div className="text-2xs uppercase tracking-wider text-mute mb-2">Hours</div>
              <p className="text-sm text-ink-soft leading-relaxed">
                Mon – Fri, 9:00 – 18:00 EAT.
                Outside hours we&apos;ll get back to you next working day.
              </p>
            </div>
          </aside>
        </div>
      </section>

      <SimplyDoneFooter />
    </main>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-2xs uppercase tracking-wider text-mute mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function SimplyDoneFooter() {
  return (
    <footer className="border-t border-line mt-auto">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6 text-center text-2xs uppercase tracking-wider text-mute">
        Wezesha Restock OS — a product of{" "}
        <span className="text-ink-soft">SimplyDone Africa</span>
      </div>
    </footer>
  );
}

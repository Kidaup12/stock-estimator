/**
 * Guarded transactional email via Resend's REST API (no SDK dependency — raw
 * fetch). When RESEND_API_KEY is absent the call is a logged no-op so alerts and
 * PO delivery can be wired now and "just start emailing" once the key lands.
 */
export type SendResult = { ok: boolean; reason?: string };

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  text: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "alerts@wezesha.app";
  if (!key) {
    console.warn(`[email] RESEND_API_KEY not set — skipping send: "${opts.subject}"`);
    return { ok: false, reason: "no_api_key" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: opts.to, subject: opts.subject, text: opts.text }),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

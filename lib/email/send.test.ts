import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendEmail } from "./send";

describe("sendEmail", () => {
  const orig = process.env.RESEND_API_KEY;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { process.env.RESEND_API_KEY = orig; });

  it("no-ops (no fetch) when RESEND_API_KEY is absent", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendEmail({ to: "a@b.com", subject: "x", text: "y" });
    expect(r).toEqual({ ok: false, reason: "no_api_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to Resend when the key is present", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendEmail({ to: "a@b.com", subject: "x", text: "y" });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.resend.com/emails");
  });

  it("returns http_<status> on a failed send", async () => {
    process.env.RESEND_API_KEY = "re_test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    const r = await sendEmail({ to: "a@b.com", subject: "x", text: "y" });
    expect(r).toEqual({ ok: false, reason: "http_422" });
  });
});

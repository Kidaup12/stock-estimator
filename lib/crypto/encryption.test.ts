import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt } from "./encryption";

describe("encryption (AES-256-GCM token-at-rest, SHOP-02)", () => {
  beforeAll(() => {
    // Exactly 32 bytes -> base64 key for AES-256.
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from(
      "0123456789abcdef0123456789abcdef"
    ).toString("base64");
  });

  it("round-trips a token exactly", () => {
    const token = "shpat_abc123def456";
    expect(decrypt(encrypt(token))).toBe(token);
  });

  it("ciphertext differs from plaintext and does not contain it", () => {
    const token = "shpat_secret_value";
    const ct = encrypt(token);
    expect(ct).not.toBe(token);
    expect(ct.includes(token)).toBe(false);
  });

  it("produces different ciphertext on each call (random IV)", () => {
    const token = "shpat_same_input";
    expect(encrypt(token)).not.toBe(encrypt(token));
  });

  it("throws when the ciphertext is tampered (GCM auth failure)", () => {
    const ct = encrypt("shpat_tamper_me");
    const parts = ct.split(":");
    // Flip a character in the ciphertext body.
    const body = Buffer.from(parts[2], "base64");
    body[0] = body[0] ^ 0xff;
    const tampered = [parts[0], parts[1], body.toString("base64")].join(":");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws when the key is missing", () => {
    const saved = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encrypt("x")).toThrow(/TOKEN_ENCRYPTION_KEY/);
    process.env.TOKEN_ENCRYPTION_KEY = saved;
  });
});

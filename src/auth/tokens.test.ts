import { describe, it, expect } from "vitest";
import { randomToken, sha256Hex } from "./tokens.js";

describe("tokens", () => {
  it("randomToken returns 43-char base64url (32 bytes)", () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("randomToken returns distinct values", () => {
    expect(randomToken()).not.toBe(randomToken());
  });

  it("sha256Hex is deterministic and 64 chars", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abc")).toHaveLength(64);
  });
});

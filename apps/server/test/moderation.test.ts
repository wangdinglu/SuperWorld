import { describe, expect, it } from "vitest";
import { verifyGuestToken, issueGuestToken } from "../src/guest.ts";
import { maskText, RateLimiter } from "../src/moderation.ts";

describe("maskText", () => {
  it("masks blocked words and leaves the rest", () => {
    expect(maskText("well SHIT happens")).toBe("well **** happens");
    expect(maskText("Scunthorpe is fine")).toBe("Scunthorpe is fine");
  });
});

describe("RateLimiter", () => {
  it("allows a burst up to the limit, then recovers after the window", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 10)).toBe(true);
    expect(limiter.allow("a", 20)).toBe(false);
    expect(limiter.allow("a", 1500)).toBe(true);
  });
});

describe("guest tokens", () => {
  it("verifies its own tokens and rejects tampered or expired ones", () => {
    const { token } = issueGuestToken("Ada", "#ff8800", 1000);
    expect(verifyGuestToken(token, 1000)?.name).toBe("Ada");
    expect(
      verifyGuestToken(
        token.replace(/.$/, (c) => (c === "A" ? "B" : "A")),
        1000,
      ),
    ).toBeUndefined();
    expect(verifyGuestToken(token, 1000 + 31 * 24 * 3600)).toBeUndefined();
    expect(verifyGuestToken("garbage")).toBeUndefined();
  });
});

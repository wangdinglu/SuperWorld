import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export interface GuestIdentity {
  /** Stable guest id for this token (not the room session id). */
  guestId: string;
  name: string;
  colour: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

const DAY = 24 * 60 * 60;

function secret(): string {
  const fromEnv = process.env.GUEST_TOKEN_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error("GUEST_TOKEN_SECRET must be set (32+ characters) in production");
  }
  // Development: a per-process secret. Tokens stop working when the server restarts, which is fine locally.
  return (devSecret ??= randomBytes(32).toString("hex"));
}
let devSecret: string | undefined;

/** Throws at startup if production is missing its token secret, so a bad deploy fails fast. */
export function assertGuestSecret(): void {
  secret();
}

const sign = (payload: string): string =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

export function issueGuestToken(
  name: string,
  colour: string,
  now = Date.now() / 1000,
): { token: string; identity: GuestIdentity } {
  const identity: GuestIdentity = {
    guestId: randomUUID(),
    name,
    colour,
    exp: Math.floor(now + 30 * DAY),
  };
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, identity };
}

/** Returns the identity in a valid, unexpired token, or undefined. */
export function verifyGuestToken(
  token: string | undefined,
  now = Date.now() / 1000,
): GuestIdentity | undefined {
  if (!token) return undefined;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return undefined;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  try {
    const identity = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as GuestIdentity;
    if (typeof identity.exp !== "number" || identity.exp < now) return undefined;
    return identity;
  } catch {
    return undefined;
  }
}

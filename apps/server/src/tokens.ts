import { createHmac, timingSafeEqual } from "node:crypto";

/** What a signed session token says about its holder. */
export interface Identity {
  userId: string;
  kind: "guest" | "member";
  name: string;
  colour: string;
  /** Expiry, seconds since epoch. */
  exp: number;
}

const DAY = 24 * 60 * 60;
const DEV_SECRET = "superworld-development-only-secret-do-not-use-in-production";

function secret(): string {
  const fromEnv = process.env.GUEST_TOKEN_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error("GUEST_TOKEN_SECRET must be set (32+ characters) in production");
  }
  return DEV_SECRET;
}

/** Throws at startup if production is missing its token secret, so a bad deploy fails fast. */
export function assertTokenSecret(): void {
  secret();
}

const sign = (payload: string): string =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

export function issueToken(
  user: Omit<Identity, "exp">,
  now = Date.now() / 1000,
): { token: string; identity: Identity } {
  const identity: Identity = {
    userId: user.userId,
    kind: user.kind,
    name: user.name,
    colour: user.colour,
    exp: Math.floor(now + 30 * DAY),
  };
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, identity };
}

/** Returns the identity in a valid, unexpired token, or undefined. */
export function verifyToken(
  token: string | undefined,
  now = Date.now() / 1000,
): Identity | undefined {
  if (!token) return undefined;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return undefined;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  try {
    const identity = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Identity;
    if (
      typeof identity.exp !== "number" ||
      identity.exp < now ||
      typeof identity.userId !== "string"
    )
      return undefined;
    return identity;
  } catch {
    return undefined;
  }
}

/** Reads "Authorization: Bearer <token>". */
export function bearer(header: string | undefined): string | undefined {
  return header?.startsWith("Bearer ") ? header.slice(7) : undefined;
}

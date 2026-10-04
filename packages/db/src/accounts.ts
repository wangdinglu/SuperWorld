import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import { loginTokens, places, reports, users } from "./schema.ts";

export type User = typeof users.$inferSelect;

const LOGIN_TOKEN_MINUTES = 30;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createGuest(
  db: Db,
  input: { displayName: string; colour: string },
): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({ kind: "guest", ...input })
    .returning();
  return user!;
}

export async function getUser(db: Db, id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function touchUser(db: Db, id: string): Promise<void> {
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, id));
}

export async function updateProfile(
  db: Db,
  id: string,
  input: { displayName?: string; colour?: string },
): Promise<void> {
  await db.update(users).set(input).where(eq(users.id, id));
}

/**
 * Adds an item to a player's inventory (once; the oldest falls out past `max`).
 * Returns the new inventory.
 */
export async function addToInventory(
  db: Db,
  id: string,
  item: string,
  max: number,
): Promise<string[]> {
  const user = await getUser(db, id);
  if (!user) return [];
  const items = [...user.inventory.filter((i) => i !== item), item].slice(-max);
  await db.update(users).set({ inventory: items }).where(eq(users.id, id));
  return items;
}

/** Starts an email sign-in. Returns the raw one-time token to put in the emailed link. */
export async function startEmailLogin(
  db: Db,
  input: { email: string; guestId?: string },
  now = new Date(),
): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db.insert(loginTokens).values({
    tokenHash: hash(token),
    email: input.email.trim().toLowerCase(),
    guestId: input.guestId ?? null,
    expiresAt: new Date(now.getTime() + LOGIN_TOKEN_MINUTES * 60_000),
  });
  return token;
}

/**
 * Completes an email sign-in. If a member with that email exists, signs into it (moving the
 * guest's spaces across); otherwise the guest becomes a member, keeping everything they made.
 */
export async function finishEmailLogin(
  db: Db,
  token: string,
  now = new Date(),
): Promise<User | undefined> {
  return db.transaction(async (tx) => {
    const [login] = await tx
      .update(loginTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(loginTokens.tokenHash, hash(token)),
          isNull(loginTokens.usedAt),
          gt(loginTokens.expiresAt, now),
        ),
      )
      .returning();
    if (!login) return undefined;

    const [existing] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${login.email}`);
    if (existing) {
      if (login.guestId && login.guestId !== existing.id) {
        await tx
          .update(places)
          .set({ ownerId: existing.id })
          .where(eq(places.ownerId, login.guestId));
      }
      return existing;
    }
    if (login.guestId) {
      const [upgraded] = await tx
        .update(users)
        .set({ kind: "member", email: login.email })
        .where(eq(users.id, login.guestId))
        .returning();
      if (upgraded) return upgraded;
    }
    const [created] = await tx
      .insert(users)
      .values({
        kind: "member",
        email: login.email,
        displayName: login.email.split("@")[0]!.slice(0, 20),
        colour: "#6c8cff",
      })
      .returning();
    return created;
  });
}

export async function createReport(
  db: Db,
  input: { reporterId: string | null; targetUserId: string | null; room: string; reason: string },
): Promise<void> {
  await db.insert(reports).values(input);
}

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Everyone who has entered SuperWorld. Guests become members by confirming an email address. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["guest", "member"] })
      .notNull()
      .default("guest"),
    displayName: text("display_name").notNull(),
    colour: text("colour").notNull(),
    email: text("email"),
    /** Item template ids carried between places, newest last. */
    inventory: jsonb("inventory").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)],
);

/** One-time email sign-in links. Only a hash of the token is stored. */
export const loginTokens = pgTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  /** The guest asking to keep their account, if any. */
  guestId: uuid("guest_id").references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Anywhere you can travel to. The plaza and districts are seeded from content/; spaces belong to players. */
export const places = pgTable(
  "places",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["plaza", "district", "arena", "space"] }).notNull(),
    name: text("name").notNull(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    visibility: text("visibility", { enum: ["public", "friends", "private"] })
      .notNull()
      .default("private"),
    /** The revision visitors see. Edits create new revisions; publishing moves this pointer. */
    publishedRevision: integer("published_revision").notNull().default(0),
    /** Creator studio drafts are spaces too, until the owner keeps one (the rest are deleted). */
    stage: text("stage", { enum: ["draft", "kept"] })
      .notNull()
      .default("kept"),
    /** For drafts: the idea they came from, their batch, and how background building went. */
    idea: text("idea"),
    batchId: text("batch_id"),
    buildState: text("build_state", { enum: ["building", "ready", "failed"] }),
    buildNote: text("build_note"),
    /** Set when the owner submits a kept space to the public gallery. */
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("places_owner_idx").on(t.ownerId)],
);

/** Immutable scene versions. `patch` holds the JSON Patch that produced this revision from the previous one. */
export const placeRevisions = pgTable(
  "place_revisions",
  {
    placeId: text("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    scene: jsonb("scene").notNull(),
    patch: jsonb("patch"),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    actor: text("actor", { enum: ["player", "agent", "mcp", "cli", "system"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.placeId, t.revision] })],
);

/** Player reports from the people panel, for review. */
export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
  targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
  room: text("room").notNull(),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["open", "reviewed", "dismissed"] })
    .notNull()
    .default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

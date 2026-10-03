import { and, desc, eq, sql } from "drizzle-orm";
import type { Scene } from "@superworld/schema";
import type { Db } from "./client.ts";
import { placeRevisions, places } from "./schema.ts";

export type Place = typeof places.$inferSelect;
export type Actor = (typeof placeRevisions.$inferInsert)["actor"];

/** Makes sure a team-built place (from content/) exists and its published revision matches the file. */
export async function seedPlace(
  db: Db,
  input: { id: string; kind: Place["kind"]; name: string; scene: Scene },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [place] = await tx.select().from(places).where(eq(places.id, input.id));
    if (!place) {
      await tx.insert(places).values({
        id: input.id,
        kind: input.kind,
        name: input.name,
        visibility: "public",
        publishedRevision: input.scene.revision,
      });
    } else if (place.publishedRevision === input.scene.revision) {
      return;
    } else {
      await tx
        .update(places)
        .set({ name: input.name, publishedRevision: input.scene.revision, updatedAt: new Date() })
        .where(eq(places.id, input.id));
    }
    await tx
      .insert(placeRevisions)
      .values({
        placeId: input.id,
        revision: input.scene.revision,
        scene: input.scene,
        actor: "system",
      })
      .onConflictDoUpdate({
        target: [placeRevisions.placeId, placeRevisions.revision],
        set: { scene: input.scene },
      });
  });
}

export async function createSpace(
  db: Db,
  input: { id: string; ownerId: string; name: string; scene: Scene },
): Promise<Place> {
  return db.transaction(async (tx) => {
    const [place] = await tx
      .insert(places)
      .values({
        id: input.id,
        kind: "space",
        name: input.name,
        ownerId: input.ownerId,
        visibility: "private",
        publishedRevision: input.scene.revision,
      })
      .returning();
    await tx.insert(placeRevisions).values({
      placeId: input.id,
      revision: input.scene.revision,
      scene: input.scene,
      authorId: input.ownerId,
      actor: "player",
    });
    return place!;
  });
}

export async function getPlace(db: Db, id: string): Promise<Place | undefined> {
  const [place] = await db.select().from(places).where(eq(places.id, id));
  return place;
}

export async function listSpaces(db: Db, ownerId: string): Promise<Place[]> {
  return db
    .select()
    .from(places)
    .where(and(eq(places.ownerId, ownerId), eq(places.kind, "space")))
    .orderBy(desc(places.updatedAt));
}

export async function getRevision(
  db: Db,
  placeId: string,
  revision: number,
): Promise<Scene | undefined> {
  const [row] = await db
    .select({ scene: placeRevisions.scene })
    .from(placeRevisions)
    .where(and(eq(placeRevisions.placeId, placeId), eq(placeRevisions.revision, revision)));
  return row?.scene as Scene | undefined;
}

export async function getPublishedScene(db: Db, placeId: string): Promise<Scene | undefined> {
  const place = await getPlace(db, placeId);
  return place ? getRevision(db, placeId, place.publishedRevision) : undefined;
}

export async function latestRevision(db: Db, placeId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${placeRevisions.revision}), -1)` })
    .from(placeRevisions)
    .where(eq(placeRevisions.placeId, placeId));
  return Number(row?.max ?? -1);
}

/**
 * Saves a new immutable revision (scene.revision is set to the next number) and optionally
 * publishes it. Returns the saved scene.
 */
export async function saveRevision(
  db: Db,
  input: {
    placeId: string;
    scene: Scene;
    patch?: unknown;
    authorId: string | null;
    actor: Actor;
    publish: boolean;
  },
): Promise<Scene> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ max: sql<number>`coalesce(max(${placeRevisions.revision}), -1)` })
      .from(placeRevisions)
      .where(eq(placeRevisions.placeId, input.placeId));
    const revision = Number(row?.max ?? -1) + 1;
    const scene: Scene = { ...input.scene, revision };
    await tx.insert(placeRevisions).values({
      placeId: input.placeId,
      revision,
      scene,
      patch: input.patch ?? null,
      authorId: input.authorId,
      actor: input.actor,
    });
    await tx
      .update(places)
      .set(
        input.publish
          ? { publishedRevision: revision, updatedAt: new Date() }
          : { updatedAt: new Date() },
      )
      .where(eq(places.id, input.placeId));
    return scene;
  });
}

export async function publishRevision(db: Db, placeId: string, revision: number): Promise<void> {
  await db
    .update(places)
    .set({ publishedRevision: revision, updatedAt: new Date() })
    .where(eq(places.id, placeId));
}

export async function setVisibility(
  db: Db,
  placeId: string,
  visibility: Place["visibility"],
): Promise<void> {
  await db.update(places).set({ visibility, updatedAt: new Date() }).where(eq(places.id, placeId));
}

export async function renamePlace(db: Db, placeId: string, name: string): Promise<void> {
  await db.update(places).set({ name, updatedAt: new Date() }).where(eq(places.id, placeId));
}

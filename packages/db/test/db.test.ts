import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Scene } from "@superworld/schema";
import {
  createGuest,
  createSpace,
  type Database,
  finishEmailLogin,
  getPublishedScene,
  getRevision,
  getUser,
  listSpaces,
  openDatabase,
  saveRevision,
  seedPlace,
  startEmailLogin,
} from "../src/index.ts";

const scene = (place: string, revision = 0): Scene => ({
  schema: "superworld.scene/1",
  place,
  revision,
  style: {},
  environment: { sky: "gradient", ground: { shape: "disc", radius: 20, colour: "ground" } },
  spawn: [{ at: [0, 0, 0], radius: 2 }],
  instances: [],
  portals: [],
  access: { visibility: "private" },
});

describe("database", () => {
  let database: Database;
  beforeAll(async () => {
    database = await openDatabase();
  });
  afterAll(async () => {
    await database.close();
  });

  it("creates guests", async () => {
    const guest = await createGuest(database.db, { displayName: "Ada", colour: "#ff8800" });
    expect(guest.kind).toBe("guest");
    expect((await getUser(database.db, guest.id))?.displayName).toBe("Ada");
  });

  it("turns a guest into a member with an email link, once", async () => {
    const guest = await createGuest(database.db, { displayName: "Grace", colour: "#3366ff" });
    const token = await startEmailLogin(database.db, {
      email: "Grace@Example.com",
      guestId: guest.id,
    });
    const member = await finishEmailLogin(database.db, token);
    expect(member).toMatchObject({ id: guest.id, kind: "member", email: "grace@example.com" });
    expect(await finishEmailLogin(database.db, token)).toBeUndefined();
  });

  it("signs a new device into the existing member and moves the guest's spaces", async () => {
    const phoneGuest = await createGuest(database.db, { displayName: "Grace", colour: "#3366ff" });
    await createSpace(database.db, {
      id: "space-phone",
      ownerId: phoneGuest.id,
      name: "Phone room",
      scene: scene("space-phone"),
    });
    const token = await startEmailLogin(database.db, {
      email: "grace@example.com",
      guestId: phoneGuest.id,
    });
    const member = await finishEmailLogin(database.db, token);
    expect(member?.email).toBe("grace@example.com");
    expect(member?.id).not.toBe(phoneGuest.id);
    expect((await listSpaces(database.db, member!.id)).map((p) => p.id)).toContain("space-phone");
  });

  it("rejects expired sign-in links", async () => {
    const token = await startEmailLogin(
      database.db,
      { email: "late@example.com" },
      new Date(Date.now() - 60 * 60_000),
    );
    expect(await finishEmailLogin(database.db, token)).toBeUndefined();
  });

  it("keeps immutable revisions and a published pointer", async () => {
    const owner = await createGuest(database.db, { displayName: "Owner", colour: "#000000" });
    await createSpace(database.db, {
      id: "space-rev",
      ownerId: owner.id,
      name: "Rev room",
      scene: scene("space-rev"),
    });
    const draft = await saveRevision(database.db, {
      placeId: "space-rev",
      scene: { ...scene("space-rev"), style: { light: "neon" } },
      patch: [{ op: "add", path: "/style/light", value: "neon" }],
      authorId: owner.id,
      actor: "agent",
      publish: false,
    });
    expect(draft.revision).toBe(1);
    expect((await getPublishedScene(database.db, "space-rev"))?.style).toEqual({});
    await saveRevision(database.db, {
      placeId: "space-rev",
      scene: draft,
      authorId: owner.id,
      actor: "player",
      publish: true,
    });
    expect((await getPublishedScene(database.db, "space-rev"))?.revision).toBe(2);
    expect((await getRevision(database.db, "space-rev", 1))?.style).toEqual({ light: "neon" });
  });

  it("seeds team-built places idempotently", async () => {
    await seedPlace(database.db, {
      id: "plaza",
      kind: "plaza",
      name: "Plaza",
      scene: scene("plaza", 1),
    });
    await seedPlace(database.db, {
      id: "plaza",
      kind: "plaza",
      name: "Plaza",
      scene: scene("plaza", 1),
    });
    await seedPlace(database.db, {
      id: "plaza",
      kind: "plaza",
      name: "Plaza",
      scene: scene("plaza", 2),
    });
    expect((await getPublishedScene(database.db, "plaza"))?.revision).toBe(2);
  });
});

describe("persistence", () => {
  const dir = mkdtempSync(join(tmpdir(), "superworld-db-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps a player's data across a restart", async () => {
    const first = await openDatabase({ dataDir: dir });
    const guest = await createGuest(first.db, { displayName: "Survivor", colour: "#123456" });
    await first.close();

    const second = await openDatabase({ dataDir: dir });
    expect((await getUser(second.db, guest.id))?.displayName).toBe("Survivor");
    await second.close();
  });
});

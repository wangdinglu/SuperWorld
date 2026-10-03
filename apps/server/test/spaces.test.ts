import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import { getPublishedScene, openDatabase, seedPlace } from "@superworld/db";
import {
  PROTOCOL_VERSION,
  type KnockBroadcast,
  type PlaceInfo,
  type ScenePatchBroadcast,
} from "@superworld/protocol";
import { createServer } from "../src/app.ts";
import { loadContent } from "../src/content.ts";

const port = 4500 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;
const content = loadContent();
const database = await openDatabase();
await seedPlace(database.db, {
  id: "plaza",
  kind: "plaza",
  name: "Plaza",
  scene: content.scenes.plaza!,
});
const server = createServer({
  content,
  db: database.db,
  mailer: { sendLoginLink: async () => {} },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rooms: Room[] = [];

async function api(path: string, body?: unknown, token?: string, method = body ? "POST" : "GET") {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function until(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await sleep(20);
  }
}

async function person(name: string) {
  const { body } = await api("/api/guest", { name, colour: "#336699" });
  return { token: body.token as string, id: body.user.id as string, name };
}

async function joinSpace(who: { token: string; name: string }, placeId: string) {
  const client = new Client(base);
  client.auth.token = who.token;
  const room = await client.joinOrCreate("space", {
    protocol: PROTOCOL_VERSION,
    name: who.name,
    colour: "#336699",
    placeId,
  });
  rooms.push(room);
  const info: {
    place?: PlaceInfo;
    patches: ScenePatchBroadcast[];
    knocks: KnockBroadcast[];
    results: any[];
  } = {
    patches: [],
    knocks: [],
    results: [],
  };
  room.onMessage("place", (m: PlaceInfo) => (info.place = m));
  room.onMessage("scene-patch", (m: ScenePatchBroadcast) => info.patches.push(m));
  room.onMessage("knock", (m: KnockBroadcast) => info.knocks.push(m));
  room.onMessage("edit-result", (m: any) => info.results.push(m));
  await until(() => info.place !== undefined);
  return { room, info };
}

beforeAll(async () => {
  await server.listen(port);
});
afterAll(async () => {
  for (const r of rooms) await r.leave().catch(() => {});
  await server.gracefullyShutdown(false);
  await database.close();
});

describe("spaces", () => {
  let owner: Awaited<ReturnType<typeof person>>;
  let spaceId: string;

  it("lets a player create one space as a guest", async () => {
    owner = await person("Owner");
    const created = await api("/api/spaces", { name: "My Room" }, owner.token);
    expect(created.status).toBe(201);
    spaceId = created.body.id;
    expect(spaceId).toMatch(/^s-[a-z0-9]{10}$/);
    expect((await api("/api/spaces", undefined, owner.token)).body).toHaveLength(1);
    const second = await api("/api/spaces", { name: "Another" }, owner.token);
    expect(second.status).toBe(403);
    expect(second.body.error).toContain("Keep your account");
  });

  it("keeps private spaces closed to visitors until the owner lets them in", async () => {
    const visitor = await person("Visitor");
    await expect(joinSpace(visitor, spaceId)).rejects.toThrow(/private/);

    // Nobody home: knocking fails fast.
    expect((await api(`/api/spaces/${spaceId}/knock`, {}, visitor.token)).body.allowed).toBe(false);

    const home = await joinSpace(owner, spaceId);
    expect(home.info.place).toMatchObject({
      kind: "space",
      name: "My Room",
      ownerName: "Owner",
      visibility: "private",
    });
    const knocking = api(`/api/spaces/${spaceId}/knock`, {}, visitor.token);
    await until(() => home.info.knocks.length === 1);
    expect(home.info.knocks[0]).toMatchObject({ userId: visitor.id, name: "Visitor" });
    home.room.send("admit", { userId: visitor.id, allow: true });
    expect((await knocking).body.allowed).toBe(true);
    const inside = await joinSpace(visitor, spaceId);
    expect(inside.info.place?.id).toBe(spaceId);
  });

  it("shows the owner's edits to everyone inside, live, and ignores visitors' edits", async () => {
    const [home, visitorRoom] = [rooms.at(-2)!, rooms.at(-1)!];
    const patches: ScenePatchBroadcast[] = [];
    visitorRoom.onMessage("scene-patch", (m: ScenePatchBroadcast) => patches.push(m));
    const results: any[] = [];
    home.onMessage("edit-result", (m: any) => results.push(m));

    home.send("edit", {
      tool: "scene_place_object",
      input: { template: "prim/fountain", x: 0, z: 5 },
    });
    await until(() => patches.length === 1 && results.length === 1);
    expect(results[0]).toMatchObject({ ok: true, output: { id: "fountain-1" } });
    expect(patches[0]!.draftSteps.at(-1)).toContain("Fountain");

    visitorRoom.send("edit", { tool: "scene_clear", input: { confirm: true } });
    home.send("edit", { tool: "scene_place_object", input: { template: "prim/nope", x: 0, z: 0 } });
    await until(() => results.length === 2);
    expect(results[1]).toMatchObject({
      ok: false,
      error: expect.stringContaining("Unknown template"),
    });
    expect(patches).toHaveLength(1);
  });

  it("edits the same draft through the API door, then saves a new revision", async () => {
    const edit = await api(
      `/api/spaces/${spaceId}/sdk/style_set`,
      { light: "golden" },
      owner.token,
    );
    expect(edit).toMatchObject({ status: 200, body: { ok: true } });
    const stranger = await person("Stranger");
    expect(
      (await api(`/api/spaces/${spaceId}/sdk/style_set`, { light: "neon" }, stranger.token)).status,
    ).toBe(403);

    const saved = await api(`/api/spaces/${spaceId}/save`, {}, owner.token);
    expect(saved.body.revision).toBe(1);
    const scene = await getPublishedScene(database.db, spaceId);
    expect(scene?.style).toEqual({ light: "golden" });
    expect(scene?.instances.some((i) => i.id === "fountain-1")).toBe(true);
  });

  it("opens public spaces to anyone", async () => {
    expect(
      (await api(`/api/spaces/${spaceId}`, { visibility: "public" }, owner.token, "PATCH")).body
        .visibility,
    ).toBe("public");
    const walkIn = await joinSpace(await person("Walker"), spaceId);
    expect(walkIn.info.place?.visibility).toBe("public");
  });

  it("lists the tools for outside agents", async () => {
    const tools = (await api("/api/sdk/tools")).body as { name: string }[];
    expect(tools.map((t) => t.name)).toContain("scene_place_object");
  });
});

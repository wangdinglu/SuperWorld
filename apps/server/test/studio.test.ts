import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import {
  createGuest,
  createSpace,
  getPublishedScene,
  openDatabase,
  seedPlace,
} from "@superworld/db";
import { PROTOCOL_VERSION, type PlaceInfo } from "@superworld/protocol";
import { createServer } from "../src/app.ts";
import { loadContent } from "../src/content.ts";
import { SpaceEditors } from "../src/editors.ts";
import { starterScene } from "../src/spaces.ts";
import { sketch } from "../src/studio.ts";

const port = 4950 + Math.floor(Math.random() * 400);
const base = `http://localhost:${port}`;
const content = loadContent();
const templates = new Map(content.templates.templates.map((t) => [t.id, t]));
const database = await openDatabase();
await seedPlace(database.db, {
  id: "plaza",
  kind: "plaza",
  name: "Plaza",
  scene: content.scenes.plaza!,
});
// The server calls no language model: the studio sketches drafts itself.
const server = createServer({
  content,
  db: database.db,
  mailer: { sendLoginLink: async () => {} },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rooms: Room[] = [];

async function api(path: string, token: string, body?: unknown, method?: string) {
  const res = await fetch(`${base}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function guest(name: string): Promise<string> {
  const res = await fetch(`${base}/api/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, colour: "#ff8800" }),
  });
  return ((await res.json()) as { token: string }).token;
}

beforeAll(async () => {
  await server.listen(port);
});
afterAll(async () => {
  for (const r of rooms) await r.leave().catch(() => {});
  await server.gracefullyShutdown(false);
  await database.close();
});

describe("sketches", () => {
  it("lays an idea out three ways in its theme, within the space's limits", async () => {
    const owner = await createGuest(database.db, { displayName: "S", colour: "#000000" });
    const editors = new SpaceEditors(database.db, templates);
    const layouts: string[] = [];
    for (const variant of [0, 1, 2]) {
      const id = `s-sketchtst${variant}`;
      await createSpace(database.db, {
        id,
        ownerId: owner.id,
        name: "x",
        scene: starterScene(id),
      });
      const editor = (await editors.get(id))!;
      const steps = sketch(editor, "a neon night club", variant);
      expect(steps.length).toBeGreaterThan(8);
      expect(editor.scene.style).toMatchObject({ light: "neon", atmosphere: "stars" });
      expect(editor.scene.instances.some((i) => i.template === "prim/holo-sign")).toBe(true);
      const r = editor.scene.environment.ground.radius;
      for (const i of editor.scene.instances) expect(Math.hypot(i.at[0], i.at[2])).toBeLessThan(r);
      layouts.push(JSON.stringify(editor.scene.instances.map((i) => i.at)));
    }
    expect(new Set(layouts).size).toBe(3);
  });
});

describe("creator studio", () => {
  let token: string;
  let drafts: { id: string; name: string; buildState: string }[];

  it("turns an idea into three drafts built in the background", async () => {
    token = await guest("Dreamer");
    expect((await api("/api/studio/drafts", token, { idea: "hi" })).status).toBe(400);
    const made = await api("/api/studio/drafts", token, { idea: "a flower garden for picnics" });
    expect(made.status).toBe(202);
    expect(made.body.drafts.map((d: any) => d.name)).toEqual([
      "a flower garden for picnics · A",
      "a flower garden for picnics · B",
      "a flower garden for picnics · C",
    ]);
    for (let i = 0; i < 100; i++) {
      drafts = (await api("/api/studio", token)).body.drafts;
      if (drafts.every((d) => d.buildState === "ready")) break;
      await sleep(50);
    }
    expect(drafts.map((d) => d.buildState)).toEqual(["ready", "ready", "ready"]);
    const scene = await getPublishedScene(database.db, drafts[1]!.id);
    expect(scene?.style).toMatchObject({ atmosphere: "petals" });
    // Drafts aren't spaces yet.
    expect((await api("/api/spaces", token)).body).toEqual([]);
  });

  it("lets the owner walk into a draft, keep it, and submit it to the gallery", async () => {
    const client = new Client(base);
    client.auth.token = token;
    const infos: PlaceInfo[] = [];
    const room = await client.joinOrCreate("space", {
      protocol: PROTOCOL_VERSION,
      name: "Dreamer",
      colour: "#ff8800",
      placeId: drafts[1]!.id,
    });
    rooms.push(room);
    room.onMessage("place", (m: PlaceInfo) => infos.push(m));
    for (let i = 0; i < 50 && infos.length === 0; i++) await sleep(20);
    expect(infos[0]).toMatchObject({ stage: "draft", submitted: false });

    const other = await guest("Nosy");
    expect((await api(`/api/studio/drafts/${drafts[1]!.id}/keep`, other, {})).status).toBe(404);

    const kept = await api(`/api/studio/drafts/${drafts[1]!.id}/keep`, token, {
      name: "Picnic Garden",
    });
    expect(kept.body).toEqual({ id: drafts[1]!.id, name: "Picnic Garden" });
    expect((await api("/api/studio", token)).body.drafts).toEqual([]);
    expect((await api("/api/spaces", token)).body.map((s: any) => s.name)).toEqual([
      "Picnic Garden",
    ]);
    for (let i = 0; i < 50 && infos.at(-1)?.stage !== "kept"; i++) await sleep(20);
    expect(infos.at(-1)).toMatchObject({ stage: "kept", name: "Picnic Garden" });

    expect((await api(`/api/spaces/${drafts[1]!.id}/submit`, token, {})).body).toEqual({
      ok: true,
    });
    const gallery = await api("/api/gallery", token);
    expect(gallery.body[0]).toMatchObject({ name: "Picnic Garden", ownerName: "Dreamer" });
    for (let i = 0; i < 50 && !infos.at(-1)?.submitted; i++) await sleep(20);
    expect(infos.at(-1)).toMatchObject({ visibility: "public", submitted: true });
  });

  it("respects the space limit when keeping, and a new idea replaces old drafts", async () => {
    const first = await api("/api/studio/drafts", token, { idea: "a quiet reading room" });
    let state = first.body.drafts;
    for (let i = 0; i < 100 && state.some((d: any) => d.buildState !== "ready"); i++) {
      await sleep(50);
      state = (await api("/api/studio", token)).body.drafts;
    }
    const keep = await api(`/api/studio/drafts/${state[0].id}/keep`, token, {});
    expect(keep.status).toBe(403);
    expect(keep.body.error).toMatch(/1 space/);
    const next = await api("/api/studio/drafts", token, { idea: "a party with music" });
    const ids = next.body.drafts.map((d: any) => d.id);
    expect(ids).not.toContain(state[0].id);
    await sleep(500);
    expect((await api("/api/studio", token)).body.idea).toBe("a party with music");
    await api("/api/studio/drafts", token, undefined, "DELETE");
    expect((await api("/api/studio", token)).body.drafts).toEqual([]);
  });
});

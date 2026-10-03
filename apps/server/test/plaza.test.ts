import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import {
  MoveInput,
  PROTOCOL_VERSION,
  quantiseAxis,
  type ChatBroadcast,
} from "@superworld/protocol";
import { openDatabase, seedPlace, tables } from "@superworld/db";
import { createServer } from "../src/app.ts";
import { loadContent } from "../src/content.ts";

const port = 3900 + Math.floor(Math.random() * 500);
const base = `http://localhost:${port}`;
const content = loadContent();
const database = await openDatabase();
await seedPlace(database.db, {
  id: "plaza",
  kind: "plaza",
  name: "Plaza",
  scene: content.scenes.plaza!,
});
const sentLinks: { to: string; link: string }[] = [];
const server = createServer({
  content,
  db: database.db,
  mailer: { sendLoginLink: async (to, link) => void sentLinks.push({ to, link }) },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function guest(name: string): Promise<string> {
  const res = await fetch(`${base}/api/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, colour: "#3366ff" }),
  });
  return ((await res.json()) as { token: string }).token;
}

async function api(path: string, body?: unknown, token?: string, method = body ? "POST" : "GET") {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function join(name: string): Promise<Room> {
  const client = new Client(base);
  client.auth.token = await guest(name);
  return client.joinOrCreate("plaza", { protocol: PROTOCOL_VERSION, name, colour: "#3366ff" });
}

async function until(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await sleep(20);
  }
}

const rooms: Room[] = [];
beforeAll(async () => {
  await server.listen(port);
});
afterAll(async () => {
  for (const r of rooms) await r.leave().catch(() => {});
  await server.gracefullyShutdown(false);
  await database.close();
});

describe("plaza room", () => {
  it("puts a joining player in the spawn area", async () => {
    const room = await join("Ada");
    rooms.push(room);
    await until(() => room.state.players?.get(room.sessionId) !== undefined);
    const me = room.state.players.get(room.sessionId);
    expect(me.name).toBe("Ada");
    expect(Math.hypot(me.x, me.z - 13)).toBeLessThanOrEqual(4.01);
  });

  it("moves the player by its inputs, at walking speed", async () => {
    const room = rooms[0]!;
    const me = room.state.players.get(room.sessionId);
    const startX = me.x;
    const input = room.input({ type: MoveInput, mode: "reliable" });
    for (let i = 0; i < 30; i++) {
      input.data.moveX = quantiseAxis(1);
      input.data.moveZ = 0;
      input.send();
      await sleep(1000 / 30);
    }
    await until(() => input.lastProcessed >= 30);
    await sleep(150);
    expect(me.x - startX).toBeGreaterThan(3.5);
    expect(me.x - startX).toBeLessThan(4.5);
  });

  it("shows nearby players to each other and relays chat with the word filter", async () => {
    const a = rooms[0]!;
    const b = await join("Grace");
    rooms.push(b);
    await until(() => a.state.players.size === 2 && b.state.players.size === 2);

    const received: ChatBroadcast[] = [];
    b.onMessage("chat", (m: ChatBroadcast) => received.push(m));
    a.send("chat", { text: "hello shit world" });
    await until(() => received.length === 1);
    expect(received[0]).toMatchObject({ name: "Ada", text: "hello **** world" });
  });

  it("accepts valid telemetry and ignores malformed telemetry", async () => {
    const room = rooms[0]!;
    const logs: string[] = [];
    const original = console.log;
    console.log = (line: string) => logs.push(String(line));
    try {
      room.send("telemetry", {
        fps: 58.5,
        tier: "high",
        backend: "webgl2",
        rttMs: 40,
        device: "desktop",
        viewport: [1280, 720],
      });
      room.send("telemetry", { fps: "fast" });
      await until(() => logs.some((l) => l.includes("client-telemetry")));
      await sleep(100);
    } finally {
      console.log = original;
    }
    const entries = logs.filter((l) => l.includes("client-telemetry")).map((l) => JSON.parse(l));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ fps: 58.5, tier: "high", device: "desktop" });
  });

  it("stores reports with both players' accounts", async () => {
    const [a, b] = [rooms[0]!, rooms[1]!];
    a.send("report", { sessionId: b.sessionId, reason: "test report" });
    await until(() => false, 300).catch(() => {});
    const stored = await database.db.select().from(tables.reports);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ reason: "test report" });
    expect(stored[0]!.reporterId).not.toBeNull();
    expect(stored[0]!.targetUserId).not.toBeNull();
  });

  it("rejects clients without a valid token or with an old protocol", async () => {
    const noToken = new Client(base);
    await expect(
      noToken.joinOrCreate("plaza", { protocol: PROTOCOL_VERSION, name: "X", colour: "#000000" }),
    ).rejects.toThrow();
    const old = new Client(base);
    old.auth.token = await guest("Old");
    await expect(
      old.joinOrCreate("plaza", { protocol: PROTOCOL_VERSION - 1, name: "Old", colour: "#000000" }),
    ).rejects.toThrow(/out of date/);
  });
});

describe("accounts", () => {
  it("returns the signed-in user and lets them rename", async () => {
    const created = await api("/api/guest", { name: "Lin", colour: "#00aa00" });
    expect(created.body.user).toMatchObject({ kind: "guest", name: "Lin" });
    const renamed = await api("/api/me", { name: "Lin Yu" }, created.body.token, "PATCH");
    expect(renamed.body.user.name).toBe("Lin Yu");
    expect((await api("/api/me", undefined, "bad.token")).status).toBe(401);
  });

  it("keeps a guest's account by email, and signs in a second device", async () => {
    const guest = await api("/api/guest", { name: "Mia", colour: "#aa00aa" });
    sentLinks.length = 0;
    expect(
      (await api("/api/auth/email/start", { email: "Mia@Example.com" }, guest.body.token)).body,
    ).toEqual({ ok: true });
    expect(sentLinks[0]?.to).toBe("mia@example.com");
    const token = new URL(sentLinks[0]!.link).searchParams.get("login")!;
    const member = await api("/api/auth/email/finish", { token });
    expect(member.body.user).toMatchObject({
      id: guest.body.user.id,
      kind: "member",
      email: "mia@example.com",
    });
    expect((await api("/api/auth/email/finish", { token })).status).toBe(400);

    // Another device signs in to the same account.
    const phone = await api("/api/guest", { name: "Mia phone", colour: "#aa00aa" });
    await api("/api/auth/email/start", { email: "mia@example.com" }, phone.body.token);
    const second = new URL(sentLinks[1]!.link).searchParams.get("login")!;
    expect((await api("/api/auth/email/finish", { token: second })).body.user.id).toBe(
      guest.body.user.id,
    );
  });

  it("puts sign-in links on this server, never on an address the request names", async () => {
    sentLinks.length = 0;
    await fetch(`${base}/api/auth/email/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        host: "evil.example",
      },
      body: JSON.stringify({ email: "victim@example.com" }),
    });
    expect(new URL(sentLinks[0]!.link).host).toBe(`localhost:${port}`);
  });
});

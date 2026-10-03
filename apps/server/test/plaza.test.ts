import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import {
  MoveInput,
  PROTOCOL_VERSION,
  quantiseAxis,
  type ChatBroadcast,
} from "@superworld/protocol";
import { createServer } from "../src/app.ts";
import { loadContent } from "../src/content.ts";

const port = 3900 + Math.floor(Math.random() * 500);
const base = `http://localhost:${port}`;
const server = createServer(loadContent());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function guest(name: string): Promise<string> {
  const res = await fetch(`${base}/api/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, colour: "#3366ff" }),
  });
  return ((await res.json()) as { token: string }).token;
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

describe("plaza room", () => {
  const rooms: Room[] = [];
  beforeAll(async () => {
    await server.listen(port);
  });
  afterAll(async () => {
    for (const r of rooms) await r.leave().catch(() => {});
    await server.gracefullyShutdown(false);
  });

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

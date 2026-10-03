// Load test: N bot players join the plaza and wander. Usage: pnpm bots [count] [serverUrl] [seconds]
import { Client, type Room } from "@colyseus/sdk";
import { MoveInput, PROTOCOL_VERSION, quantiseAxis, ROOM } from "@superworld/protocol";

const count = Number(process.argv[2] ?? 50);
const server = process.argv[3] ?? "http://localhost:2567";
const seconds = Number(process.argv[4] ?? 60);

// One guest token for all bots: the guest endpoint is rate-limited per IP, and tokens can be reused.
const res = await fetch(`${server}/api/guest`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Bot", colour: "#888888" }),
});
const { token } = (await res.json()) as { token: string };

async function bot(i: number): Promise<Room> {
  const name = `Bot ${i + 1}`;
  const client = new Client(server);
  client.auth.token = token;
  const room = await client.joinOrCreate(ROOM.plaza, {
    protocol: PROTOCOL_VERSION,
    name,
    colour: "#888888",
  });
  const input = room.input({ type: MoveInput, mode: "reliable" });
  let angle = Math.random() * Math.PI * 2;
  const timer = setInterval(() => {
    angle += (Math.random() - 0.5) * 0.3;
    input.data.moveX = quantiseAxis(Math.sin(angle));
    input.data.moveZ = quantiseAxis(Math.cos(angle));
    input.data.run = false;
    input.data.jump = Math.random() < 0.01;
    input.send();
  }, 1000 / 30);
  room.onLeave(() => clearInterval(timer));
  return room;
}

const rooms: Room[] = [];
for (let i = 0; i < count; i++) {
  rooms.push(await bot(i));
}
const roomIds = new Set(rooms.map((r) => r.roomId));
console.log(`${rooms.length} bots joined ${roomIds.size} room(s). Wandering for ${seconds}s…`);
await new Promise((r) => setTimeout(r, seconds * 1000));
for (const r of rooms) await r.leave();
console.log("Done.");
process.exit(0);

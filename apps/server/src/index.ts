import { join } from "node:path";
import { openDatabase, seedPlace } from "@superworld/db";
import { BuildingAgent } from "./agent.ts";
import { createServer } from "./app.ts";
import { loadContent } from "./content.ts";
import { createMailer } from "./mailer.ts";
import { assertTokenSecret } from "./tokens.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const port = Number(process.env.PORT ?? 2567);
assertTokenSecret();
const content = loadContent();

// DATABASE_URL → real Postgres (e.g. Neon). Without it, an embedded Postgres stores data in DATA_DIR.
const database = await openDatabase({
  ...(process.env.DATABASE_URL
    ? { url: process.env.DATABASE_URL }
    : { dataDir: process.env.DATA_DIR ?? join(repoRoot, ".data", "db") }),
  migrationsDir: join(repoRoot, "packages", "db", "migrations"),
});
if (database.kind === "embedded" && process.env.NODE_ENV === "production") {
  console.warn(
    "No DATABASE_URL: using the embedded database. On hosts without a persistent disk, accounts reset on restart.",
  );
}
for (const place of content.world.places) {
  const scene = content.scenes[place.id];
  if (scene && (place.kind === "plaza" || place.kind === "district")) {
    await seedPlace(database.db, { id: place.id, kind: place.kind, name: place.name, scene });
  }
}

const agent = BuildingAgent.fromEnv();
if (!agent)
  console.log("AI building agent is off: set ANTHROPIC_API_KEY and AGENT_MODEL to turn it on.");
// The MCP door is internal for now: on only when MCP_ENABLED=1.
const serverUrl =
  process.env.RENDER_EXTERNAL_URL ?? process.env.SERVER_URL ?? `http://localhost:${port}`;
const mcp =
  process.env.MCP_ENABLED === "1"
    ? { issuerUrl: serverUrl, consentUrl: process.env.PUBLIC_URL ?? serverUrl }
    : undefined;
if (mcp) console.log(`MCP door is on at ${serverUrl}/mcp`);
const server = createServer({
  content,
  db: database.db,
  mailer: createMailer(),
  ...(agent ? { agent } : {}),
  ...(mcp ? { mcp } : {}),
});
await server.listen(port, "0.0.0.0");
console.log(`SuperWorld game server listening on :${port} (database: ${database.kind})`);

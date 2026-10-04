import { join } from "node:path";
import { openDatabase, seedPlace } from "@superworld/db";
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

// The MCP door is how players' own AI agents build (the server calls no language model).
// On by default; MCP_ENABLED=0 turns it off.
const serverUrl =
  process.env.RENDER_EXTERNAL_URL ?? process.env.SERVER_URL ?? `http://localhost:${port}`;
// OAuth needs https, except on localhost.
const secureIssuer = /^https:|^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(serverUrl);
if (!secureIssuer) console.warn(`MCP door is off: ${serverUrl} isn't https (set SERVER_URL).`);
const mcp =
  process.env.MCP_ENABLED !== "0" && secureIssuer
    ? { issuerUrl: serverUrl, consentUrl: process.env.PUBLIC_URL ?? serverUrl }
    : undefined;
if (mcp) console.log(`MCP door is on at ${serverUrl}/mcp`);
const server = createServer({
  content,
  db: database.db,
  mailer: createMailer(),
  ...(mcp ? { mcp } : {}),
});
await server.listen(port, "0.0.0.0");
console.log(`SuperWorld game server listening on :${port} (database: ${database.kind})`);

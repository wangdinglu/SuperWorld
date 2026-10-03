import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { JoinOptions, ROOM } from "@superworld/protocol";
import type { Content } from "./content.ts";
import { issueGuestToken } from "./guest.ts";
import { maskText, RateLimiter } from "./moderation.ts";
import { PlazaRoom } from "./rooms/PlazaRoom.ts";

/** The built web client, served by this process when present (single-service deploys). */
const WEB_DIST = process.env.WEB_DIST ?? join(import.meta.dirname, "..", "..", "web", "dist");

export function createServer(content: Content) {
  const guestLimit = new RateLimiter(20, 60_000);
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return defineServer({
    transport: new WebSocketTransport(),
    rooms: {
      [ROOM.plaza]: defineRoom(PlazaRoom, { content, placeId: content.world.spawnPlace }),
    },
    express: async (app) => {
      const { default: express } = await import("express");
      app.use(express.json({ limit: "4kb" }));
      app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Vary", "Origin");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");
          res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        }
        if (req.method === "OPTIONS") return void res.sendStatus(204);
        next();
      });

      app.get("/health", (_req, res) => {
        res.json({ ok: true });
      });

      /** Issues a signed guest token for a display name and colour. */
      app.post("/api/guest", (req, res) => {
        if (!guestLimit.allow(req.ip ?? "unknown"))
          return void res.status(429).json({ error: "Too many requests" });
        const parsed = JoinOptions.omit({ protocol: true }).safeParse(req.body);
        if (!parsed.success)
          return void res
            .status(400)
            .json({ error: "Name (1–20 characters) and colour (#rrggbb) are required" });
        const { token, identity } = issueGuestToken(maskText(parsed.data.name), parsed.data.colour);
        res.json({ token, name: identity.name, colour: identity.colour });
      });

      /** World manifest, so the client can list places. */
      app.get("/api/world", (_req, res) => {
        res.json(content.world);
      });

      if (existsSync(WEB_DIST)) {
        app.use(express.static(WEB_DIST, { maxAge: "1h", index: "index.html" }));
        app.get(/^\/(p|s)\//, (_req, res) => res.sendFile(join(WEB_DIST, "index.html")));
      }
    },
  });
}

import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import {
  createGuest,
  type Db,
  finishEmailLogin,
  getUser,
  startEmailLogin,
  updateProfile,
  type User,
} from "@superworld/db";
import { JoinOptions, ROOM } from "@superworld/protocol";
import type { Request, Response } from "express";
import { z } from "zod";
import type { Content } from "./content.ts";
import type { Mailer } from "./mailer.ts";
import { maskText, RateLimiter } from "./moderation.ts";
import type { BuildingAgent } from "./agent.ts";
import { SpaceEditors } from "./editors.ts";
import { Knocks } from "./knocks.ts";
import { PlaceRoom } from "./rooms/PlaceRoom.ts";
import { registerSpaceRoutes } from "./spaces.ts";
import { bearer, issueToken, verifyToken } from "./tokens.ts";

/** The built web client, served by this process when present (single-service deploys). */
const WEB_DIST = process.env.WEB_DIST ?? join(import.meta.dirname, "..", "..", "web", "dist");

export interface Services {
  content: Content;
  db: Db;
  mailer: Mailer;
  /** The AI building agent; absent when not configured. */
  agent?: BuildingAgent;
}

const Profile = JoinOptions.omit({ protocol: true });
const EmailStart = z.object({ email: z.string().trim().email().max(254) });
const EmailFinish = z.object({ token: z.string().min(10).max(100) });

/** What the client gets back whenever it signs in: a fresh token and the public profile. */
function session(user: User) {
  const { token } = issueToken({
    userId: user.id,
    kind: user.kind,
    name: user.displayName,
    colour: user.colour,
  });
  return {
    token,
    user: {
      id: user.id,
      kind: user.kind,
      name: user.displayName,
      colour: user.colour,
      email: user.email,
    },
  };
}

export function createServer(services: Services) {
  const { content, db, mailer, agent } = services;
  const templates = new Map(content.templates.templates.map((t) => [t.id, t]));
  const editors = new SpaceEditors(db, templates);
  const knocks = new Knocks();
  const liveRooms = new Map<string, PlaceRoom>();
  const guestLimit = new RateLimiter(20, 60_000);
  const emailIpLimit = new RateLimiter(5, 60 * 60_000);
  const emailAddressLimit = new RateLimiter(3, 60 * 60_000);
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  /** The signed-in user for this request, or undefined (and a 401 sent). */
  async function requireUser(req: Request, res: Response): Promise<User | undefined> {
    const identity = verifyToken(bearer(req.headers.authorization));
    const user = identity ? await getUser(db, identity.userId) : undefined;
    if (!user) res.status(401).json({ error: "Please sign in again" });
    return user;
  }

  return defineServer({
    transport: new WebSocketTransport(),
    rooms: {
      [ROOM.plaza]: defineRoom(PlaceRoom, {
        content,
        db,
        editors,
        knocks,
        liveRooms,
        kind: "plaza",
        placeId: content.world.spawnPlace,
      }),
      // One room per space: clients join with { placeId }.
      [ROOM.space]: defineRoom(PlaceRoom, {
        content,
        db,
        editors,
        knocks,
        liveRooms,
        ...(agent ? { agent } : {}),
        kind: "space",
      }).filterBy(["placeId"]),
    },
    express: async (app) => {
      const { default: express } = await import("express");
      app.use(express.json({ limit: "4kb" }));
      app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Vary", "Origin");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
          res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
        }
        if (req.method === "OPTIONS") return void res.sendStatus(204);
        next();
      });

      app.get("/health", (_req, res) => {
        res.json({ ok: true });
      });

      /** Creates a guest account for a display name and colour. */
      app.post("/api/guest", async (req, res) => {
        if (!guestLimit.allow(req.ip ?? "unknown"))
          return void res.status(429).json({ error: "Too many requests" });
        const parsed = Profile.safeParse(req.body);
        if (!parsed.success) {
          return void res
            .status(400)
            .json({ error: "Name (1–20 characters) and colour (#rrggbb) are required" });
        }
        const user = await createGuest(db, {
          displayName: maskText(parsed.data.name),
          colour: parsed.data.colour,
        });
        res.json(session(user));
      });

      /** The signed-in user, with a refreshed token. */
      app.get("/api/me", async (req, res) => {
        const user = await requireUser(req, res);
        if (user) res.json(session(user));
      });

      /** Changes display name or colour. */
      app.patch("/api/me", async (req, res) => {
        const user = await requireUser(req, res);
        if (!user) return;
        const parsed = Profile.partial().safeParse(req.body);
        if (!parsed.success) return void res.status(400).json({ error: "Invalid name or colour" });
        await updateProfile(db, user.id, {
          ...(parsed.data.name ? { displayName: maskText(parsed.data.name) } : {}),
          ...(parsed.data.colour ? { colour: parsed.data.colour } : {}),
        });
        res.json(session((await getUser(db, user.id))!));
      });

      /**
       * Emails a one-time sign-in link. The link always points at PUBLIC_URL (or this server),
       * never at an address the request names, so links can't be redirected elsewhere.
       */
      app.post("/api/auth/email/start", async (req, res) => {
        const parsed = EmailStart.safeParse(req.body);
        if (!parsed.success)
          return void res.status(400).json({ error: "Please enter a valid email address" });
        const email = parsed.data.email.toLowerCase();
        if (!emailIpLimit.allow(req.ip ?? "unknown") || !emailAddressLimit.allow(email)) {
          return void res
            .status(429)
            .json({ error: "Too many sign-in emails. Try again in an hour." });
        }
        const identity = verifyToken(bearer(req.headers.authorization));
        const token = await startEmailLogin(db, {
          email,
          ...(identity ? { guestId: identity.userId } : {}),
        });
        const base = (process.env.PUBLIC_URL ?? `${req.protocol}://${req.get("host")}/`).replace(
          /\/?$/,
          "/",
        );
        try {
          await mailer.sendLoginLink(email, `${base}?login=${encodeURIComponent(token)}`);
        } catch (err) {
          console.error(err);
          return void res.status(502).json({ error: "Couldn't send the email. Try again later." });
        }
        // Same answer whether or not the address has an account.
        res.json({ ok: true });
      });

      /** Completes sign-in from an emailed link. */
      app.post("/api/auth/email/finish", async (req, res) => {
        const parsed = EmailFinish.safeParse(req.body);
        const user = parsed.success ? await finishEmailLogin(db, parsed.data.token) : undefined;
        if (!user)
          return void res
            .status(400)
            .json({ error: "This sign-in link has expired or was already used" });
        res.json(session(user));
      });

      registerSpaceRoutes(app, { db, editors, knocks, liveRooms, requireUser });

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

import { randomBytes } from "node:crypto";
import {
  createSpace,
  type Db,
  getPlace,
  getUser,
  listSpaces,
  renamePlace,
  setVisibility,
  type User,
} from "@superworld/db";
import { Scene } from "@superworld/schema";
import { toolDefinitions } from "@superworld/sdk";
import type { Application, Request, Response } from "express";
import { z } from "zod";
import type { SpaceEditors } from "./editors.ts";
import type { Knocks } from "./knocks.ts";
import { maskText } from "./moderation.ts";
import type { PlaceRoom } from "./rooms/PlaceRoom.ts";

const SPACE_LIMIT = { guest: 1, member: 5 } as const;
const NewSpace = z.object({ name: z.string().trim().min(1).max(40) });
const SpaceUpdate = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  visibility: z.enum(["public", "friends", "private"]).optional(),
});

/** A small, friendly starting point for a new space. */
export function starterScene(id: string): Scene {
  return Scene.parse({
    schema: "superworld.scene/1",
    place: id,
    revision: 0,
    style: {},
    environment: { sky: "gradient", ground: { shape: "disc", radius: 20, colour: "ground" } },
    spawn: [{ at: [0, 0, 8], radius: 2 }],
    instances: [
      { id: "tree-1", template: "prim/tree", at: [-8, 0, -6] },
      { id: "tree-2", template: "prim/tree", at: [9, 0, -4], scale: 1.2 },
      { id: "bench-1", template: "prim/bench", at: [0, 0, -3] },
      { id: "lamp-1", template: "prim/lamp", at: [3, 0, -3] },
    ],
    portals: [],
    access: { visibility: "private" },
  });
}

const newSpaceId = () =>
  `s-${[...randomBytes(10)].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("")}`;

export interface SpaceRouteDeps {
  db: Db;
  editors: SpaceEditors;
  knocks: Knocks;
  liveRooms: Map<string, PlaceRoom>;
  requireUser(req: Request, res: Response): Promise<User | undefined>;
}

export function registerSpaceRoutes(app: Application, deps: SpaceRouteDeps): void {
  const { db, editors, knocks, liveRooms, requireUser } = deps;

  /** The space, if the signed-in user owns it (sending 404/403 otherwise). */
  async function ownedSpace(req: Request, res: Response, user: User) {
    const place = await getPlace(db, String(req.params.id));
    if (!place || place.kind !== "space")
      return void res.status(404).json({ error: "No such space" });
    if (place.ownerId !== user.id)
      return void res.status(403).json({ error: "Only the owner can do that" });
    return place;
  }

  app.get("/api/spaces", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const spaces = await listSpaces(db, user.id);
    res.json(
      spaces.map((p) => ({
        id: p.id,
        name: p.name,
        visibility: p.visibility,
        updatedAt: p.updatedAt,
      })),
    );
  });

  app.post("/api/spaces", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const parsed = NewSpace.safeParse(req.body);
    if (!parsed.success)
      return void res.status(400).json({ error: "Give your space a name (1–40 characters)" });
    const owned = await listSpaces(db, user.id);
    if (owned.length >= SPACE_LIMIT[user.kind]) {
      const hint = user.kind === "guest" ? " Keep your account (add your email) to make more." : "";
      return void res
        .status(403)
        .json({ error: `You can have ${SPACE_LIMIT[user.kind]} space(s).${hint}` });
    }
    const id = newSpaceId();
    const place = await createSpace(db, {
      id,
      ownerId: user.id,
      name: maskText(parsed.data.name),
      scene: starterScene(id),
    });
    res.status(201).json({ id: place.id, name: place.name, visibility: place.visibility });
  });

  app.get("/api/spaces/:id", async (req, res) => {
    const place = await getPlace(db, String(req.params.id));
    if (!place || place.kind !== "space")
      return void res.status(404).json({ error: "No such space" });
    const owner = place.ownerId ? await getUser(db, place.ownerId) : undefined;
    res.json({
      id: place.id,
      name: place.name,
      visibility: place.visibility,
      ownerName: owner?.displayName ?? null,
    });
  });

  app.patch("/api/spaces/:id", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const place = await ownedSpace(req, res, user);
    if (!place) return;
    const parsed = SpaceUpdate.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "Invalid name or visibility" });
    if (parsed.data.visibility) await setVisibility(db, place.id, parsed.data.visibility);
    if (parsed.data.name) await renamePlace(db, place.id, maskText(parsed.data.name));
    await liveRooms.get(place.id)?.refreshPlace();
    const updated = await getPlace(db, place.id);
    res.json({ id: updated!.id, name: updated!.name, visibility: updated!.visibility });
  });

  /** Waits (up to a minute) for the owner, who must be inside, to answer a knock. */
  app.post("/api/spaces/:id/knock", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const place = await getPlace(db, String(req.params.id));
    if (!place || place.kind !== "space")
      return void res.status(404).json({ error: "No such space" });
    if (!liveRooms.has(place.id))
      return void res.json({ allowed: false, reason: "The owner isn't in their space right now" });
    const allowed = await knocks.knock(place.id, user.id, user.displayName);
    res.json({ allowed, ...(allowed ? {} : { reason: "The owner didn't let you in" }) });
  });

  // ---- Creator SDK, API door: the same tools the room and the agent use, on the same live draft ----

  app.get("/api/sdk/tools", (_req, res) => {
    res.json(toolDefinitions());
  });

  app.post("/api/spaces/:id/sdk/:tool", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const place = await ownedSpace(req, res, user);
    if (!place) return;
    const editor = await editors.get(place.id);
    const result = editor!.call(String(req.params.tool), req.body ?? {}, "player");
    res
      .status(result.ok ? 200 : 400)
      .json(result.ok ? { ok: true, summary: result.summary, output: result.output } : result);
  });

  app.post("/api/spaces/:id/save", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const place = await ownedSpace(req, res, user);
    if (!place) return;
    const saved = await (await editors.get(place.id))!.save(user.id);
    res.json({ revision: saved.revision });
  });
}

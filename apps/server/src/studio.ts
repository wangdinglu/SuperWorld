import { randomUUID } from "node:crypto";
import {
  createSpace,
  type Db,
  deletePlaces,
  expireDrafts,
  getPlace,
  getUser,
  keepDraft,
  listDrafts,
  listGallery,
  listSpaces,
  type Place,
  setBuildState,
  submitToGallery,
  type User,
} from "@superworld/db";
import type { Application, Request, Response } from "express";
import { z } from "zod";
import type { BuildingAgent } from "./agent.ts";
import type { SpaceEditor, SpaceEditors } from "./editors.ts";
import { maskText } from "./moderation.ts";
import type { PlaceRoom } from "./rooms/PlaceRoom.ts";
import { newSpaceId, SPACE_LIMIT, starterScene } from "./spaces.ts";

/** Three takes on every idea, each with its own direction. */
export const VARIANTS = [
  { label: "A", brief: "Make it cosy and close: a small, warm, sheltered layout." },
  { label: "B", brief: "Make it open and grand: wide spacing, a clear centrepiece and symmetry." },
  { label: "C", brief: "Make it playful: a surprising layout with things visitors can use." },
] as const;

const DRAFT_HOURS = 24;
const Idea = z.object({ idea: z.string().trim().min(3).max(300) });
const Keep = z.object({ name: z.string().trim().min(1).max(40).optional() });

interface Theme {
  words: RegExp;
  style: Record<string, unknown>;
  objects: string[];
  centre: string;
}

/** Keyword themes for sketches; the first that matches the idea wins. */
const THEMES: Theme[] = [
  {
    words: /garden|flower|park|forest|picnic|meadow|spring/i,
    style: { colour: "meadow", light: "golden", atmosphere: "petals", surface: "soft" },
    objects: ["prim/tree", "prim/planter", "prim/bench", "prim/lamp"],
    centre: "prim/pond",
  },
  {
    words: /night|neon|city|cyber|space|future|club|star/i,
    style: { colour: "dusk", light: "neon", atmosphere: "stars", postEffects: ["bloom"] },
    objects: ["prim/holo-sign", "prim/lamp", "prim/bench", "prim/glass-pavilion"],
    centre: "prim/holo-sign",
  },
  {
    words: /beach|sea|ocean|lake|water|island|pool/i,
    style: { colour: "mint", light: "noon", atmosphere: "clear", surface: "toon" },
    objects: ["prim/pond", "prim/chimes", "prim/bench", "prim/tree"],
    centre: "prim/fountain",
  },
  {
    words: /library|quiet|read|book|study|museum|gallery|calm/i,
    style: { colour: "mono", light: "overcast", atmosphere: "mist", surface: "ink" },
    objects: ["prim/notice-board", "prim/bench", "prim/lamp", "prim/statue"],
    centre: "prim/statue",
  },
  {
    words: /party|music|dance|concert|festival|game|play|birthday/i,
    style: { colour: "candy", light: "golden", atmosphere: "petals", postEffects: ["grain"] },
    objects: ["prim/drum", "prim/chimes", "prim/ball-basket", "prim/hat-stand", "prim/lamp"],
    centre: "prim/drum",
  },
];
const DEFAULT_THEME: Theme = {
  words: /./,
  style: { colour: "meadow", light: "noon" },
  objects: ["prim/tree", "prim/bench", "prim/lamp", "prim/planter"],
  centre: "prim/fountain",
};

/**
 * A quick sketch of an idea without the AI: a theme from its words, laid out three ways.
 * Goes through the same SDK tools (and budgets) as every other door.
 */
export function sketch(editor: SpaceEditor, idea: string, variant: number): string[] {
  const theme = THEMES.find((t) => t.words.test(idea)) ?? DEFAULT_THEME;
  const steps: string[] = [];
  const call = (tool: string, input: unknown) => {
    const result = editor.call(tool, input, "agent");
    if (result.ok && result.changed) steps.push(result.summary);
  };
  call("scene_clear", { confirm: true });
  call("style_set", theme.style);
  const radius = [16, 26, 20][variant]!;
  call("space_set_ground", { radius });
  call("space_set_spawn", { x: 0, z: radius - 4 });
  call("scene_place_object", { template: theme.centre, x: 0, z: 0 });
  const pick = (i: number) => theme.objects[i % theme.objects.length]!;
  if (variant === 0) {
    // Cosy: a tight ring facing the middle.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = 6.5;
      const yaw = (Math.atan2(-Math.sin(a), -Math.cos(a)) * 180) / Math.PI;
      call("scene_place_object", {
        template: pick(i),
        x: Math.sin(a) * r,
        z: Math.cos(a) * r,
        yawDegrees: Math.round(yaw),
      });
    }
  } else if (variant === 1) {
    // Grand: two mirrored avenues leading to the centrepiece.
    for (let i = 0; i < 5; i++) {
      for (const side of [-1, 1]) {
        call("scene_place_object", { template: pick(i), x: side * 7, z: 18 - i * 7 });
      }
    }
  } else {
    // Playful: clusters scattered on a spiral.
    for (let i = 0; i < 10; i++) {
      const a = i * 2.4;
      const r = 4 + i * 1.3;
      call("scene_place_object", {
        template: pick(i + 1),
        x: Math.sin(a) * r,
        z: Math.cos(a) * r,
        yawDegrees: Math.round((a * 180) / Math.PI) % 360,
      });
    }
  }
  return steps;
}

export interface StudioDeps {
  db: Db;
  editors: SpaceEditors;
  liveRooms: Map<string, PlaceRoom>;
  agent?: BuildingAgent;
  requireUser(req: Request, res: Response): Promise<User | undefined>;
}

const draftView = (p: Place) => ({
  id: p.id,
  name: p.name,
  variant: p.name.slice(-1),
  buildState: p.buildState,
  buildNote: p.buildNote,
});

/**
 * The creator studio: an idea becomes three draft spaces built in the background, which the
 * owner walks through, steers by talking, and then keeps (one), saves and submits.
 */
export function registerStudioRoutes(app: Application, deps: StudioDeps): void {
  const { db, editors, liveRooms, agent, requireUser } = deps;
  const running = new Set<string>();

  async function build(user: User, draft: Place, idea: string, variant: number): Promise<void> {
    const editor = await editors.get(draft.id);
    if (!editor) return;
    let note: string | null = null;
    try {
      if (agent) {
        const reply = await agent.run(
          editor,
          { id: user.id, kind: user.kind },
          `${idea}\n\n${VARIANTS[variant]!.brief} Start from an empty space: clear what's there first.`,
          () => {},
        );
        if (reply.error) {
          // Out of quota or the service failed: sketch it instead, and say so.
          note = `Sketched without the AI: ${reply.error}`;
          sketch(editor, idea, variant);
        }
      } else {
        sketch(editor, idea, variant);
      }
      if (!(await getPlace(db, draft.id))) return; // discarded while building
      await editor.save(user.id);
      await setBuildState(db, draft.id, "ready", note);
    } catch (err) {
      console.error(JSON.stringify({ event: "studio-error", place: draft.id, error: String(err) }));
      if (await getPlace(db, draft.id))
        await setBuildState(db, draft.id, "failed", "Building this draft failed.");
    }
  }

  async function removeDrafts(drafts: Place[]): Promise<void> {
    await deletePlaces(
      db,
      drafts.map((d) => d.id),
    );
    for (const d of drafts) agent?.forget(d.id);
  }

  app.get("/api/studio", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    await expireDrafts(db, new Date(Date.now() - DRAFT_HOURS * 3600_000));
    const drafts = await listDrafts(db, user.id);
    res.json({
      agentAvailable: Boolean(agent),
      idea: drafts[0]?.idea ?? null,
      drafts: drafts.map(draftView),
    });
  });

  app.post("/api/studio/drafts", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const parsed = Idea.safeParse(req.body);
    if (!parsed.success)
      return void res.status(400).json({ error: "Describe your idea in 3–300 characters" });
    if (running.has(user.id))
      return void res.status(429).json({ error: "Your drafts are still being built" });
    const idea = maskText(parsed.data.idea);
    // One batch at a time: a new idea replaces the old drafts.
    await removeDrafts(await listDrafts(db, user.id));
    const batchId = randomUUID();
    const title = idea.length > 30 ? `${idea.slice(0, 29)}…` : idea;
    const drafts: Place[] = [];
    for (const v of VARIANTS) {
      const id = newSpaceId();
      drafts.push(
        await createSpace(db, {
          id,
          ownerId: user.id,
          name: `${title} · ${v.label}`,
          scene: starterScene(id),
          draft: { idea, batchId },
        }),
      );
    }
    running.add(user.id);
    // Background: drafts build one after another while the owner can already walk in.
    void (async () => {
      try {
        for (const [i, d] of drafts.entries()) await build(user, d, idea, i);
      } finally {
        running.delete(user.id);
      }
    })();
    res.status(202).json({ agentAvailable: Boolean(agent), idea, drafts: drafts.map(draftView) });
  });

  app.delete("/api/studio/drafts", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    await removeDrafts(await listDrafts(db, user.id));
    res.json({ ok: true });
  });

  app.post("/api/studio/drafts/:id/keep", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const drafts = await listDrafts(db, user.id);
    const draft = drafts.find((d) => d.id === req.params.id);
    if (!draft) return void res.status(404).json({ error: "No such draft" });
    if (draft.buildState === "building")
      return void res.status(409).json({ error: "This draft is still being built" });
    const owned = await listSpaces(db, user.id);
    if (owned.length >= SPACE_LIMIT[user.kind]) {
      const hint = user.kind === "guest" ? " Keep your account (add your email) to make more." : "";
      return void res.status(403).json({
        error: `You can have ${SPACE_LIMIT[user.kind]} space(s). Remove one first.${hint}`,
      });
    }
    const parsed = Keep.safeParse(req.body ?? {});
    const name = maskText(parsed.data?.name ?? (draft.idea ?? draft.name).slice(0, 40));
    // Steering edits made since the draft was built are kept too.
    const editor = await editors.get(draft.id);
    if (editor && editor.draftSteps.length > 0) await editor.save(user.id);
    await keepDraft(db, draft.id, name);
    await removeDrafts(drafts.filter((d) => d.id !== draft.id));
    await liveRooms.get(draft.id)?.refreshPlace();
    res.json({ id: draft.id, name });
  });

  app.post("/api/spaces/:id/submit", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const place = await getPlace(db, String(req.params.id));
    if (!place || place.kind !== "space" || place.ownerId !== user.id)
      return void res.status(404).json({ error: "No such space" });
    if (place.stage !== "kept")
      return void res.status(409).json({ error: "Keep the draft before submitting it" });
    await submitToGallery(db, place.id);
    await liveRooms.get(place.id)?.refreshPlace();
    res.json({ ok: true });
  });

  app.get("/api/gallery", async (_req, res) => {
    const spaces = await listGallery(db);
    const owners = new Map<string, string>();
    for (const s of spaces) {
      if (s.ownerId && !owners.has(s.ownerId))
        owners.set(s.ownerId, (await getUser(db, s.ownerId))?.displayName ?? "");
    }
    res.json(
      spaces.map((s) => ({
        id: s.id,
        name: s.name,
        ownerName: s.ownerId ? (owners.get(s.ownerId) ?? null) : null,
        submittedAt: s.submittedAt,
      })),
    );
  });
}

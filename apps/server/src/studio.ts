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
import type { SpaceEditor, SpaceEditors } from "./editors.ts";
import { maskText } from "./moderation.ts";
import type { PlaceRoom } from "./rooms/PlaceRoom.ts";
import { newSpaceId, SPACE_LIMIT, starterScene } from "./spaces.ts";

/** Three takes on every idea, each with its own direction (also given to outside agents). */
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
}

/** A studio request that can't be done, with the HTTP status that says why. */
export class StudioError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface DraftView {
  id: string;
  name: string;
  variant: string;
  buildState: Place["buildState"];
  buildNote: string | null;
}

const draftView = (p: Place): DraftView => ({
  id: p.id,
  name: p.name,
  variant: p.name.slice(-1),
  buildState: p.buildState,
  buildNote: p.buildNote,
});

/**
 * The creator studio: an idea becomes three draft spaces, sketched in the background, which the
 * owner walks through, rebuilds with their own AI (through the MCP door), and keeps one of.
 * The server itself calls no language model. Used by the HTTP routes and the MCP tools alike.
 */
export class Studio {
  private readonly running = new Set<string>();

  constructor(private readonly deps: StudioDeps) {}

  private async sketchDraft(user: User, draft: Place, idea: string, variant: number) {
    const { db, editors } = this.deps;
    const editor = await editors.get(draft.id);
    if (!editor) return;
    try {
      sketch(editor, idea, variant);
      if (!(await getPlace(db, draft.id))) return; // discarded while building
      await editor.save(user.id);
      await setBuildState(db, draft.id, "ready");
    } catch (err) {
      console.error(JSON.stringify({ event: "studio-error", place: draft.id, error: String(err) }));
      if (await getPlace(db, draft.id))
        await setBuildState(db, draft.id, "failed", "Building this draft failed.");
    }
  }

  async list(userId: string): Promise<{ idea: string | null; drafts: DraftView[] }> {
    await expireDrafts(this.deps.db, new Date(Date.now() - DRAFT_HOURS * 3600_000));
    const drafts = await listDrafts(this.deps.db, userId);
    return { idea: drafts[0]?.idea ?? null, drafts: drafts.map(draftView) };
  }

  /**
   * Starts three drafts of an idea, replacing any old ones. Returns at once with the drafts
   * (still building) and a promise that settles when all three are sketched.
   */
  async make(
    user: User,
    rawIdea: string,
  ): Promise<{ idea: string; drafts: DraftView[]; ready: Promise<void> }> {
    const { db } = this.deps;
    const parsed = Idea.safeParse({ idea: rawIdea });
    if (!parsed.success) throw new StudioError(400, "Describe your idea in 3–300 characters");
    if (this.running.has(user.id)) throw new StudioError(429, "Your drafts are still being built");
    const idea = maskText(parsed.data.idea);
    await this.discard(user.id);
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
    this.running.add(user.id);
    // Background: drafts are sketched one after another while the owner can already walk in.
    const ready = (async () => {
      try {
        for (const [i, d] of drafts.entries()) await this.sketchDraft(user, d, idea, i);
      } finally {
        this.running.delete(user.id);
      }
    })();
    return { idea, drafts: drafts.map(draftView), ready };
  }

  async discard(userId: string): Promise<void> {
    const drafts = await listDrafts(this.deps.db, userId);
    await deletePlaces(
      this.deps.db,
      drafts.map((d) => d.id),
    );
  }

  /** Turns one draft into a private space (saving any edits since) and deletes the others. */
  async keep(user: User, draftId: string, rawName?: string): Promise<{ id: string; name: string }> {
    const { db, editors, liveRooms } = this.deps;
    const drafts = await listDrafts(db, user.id);
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) throw new StudioError(404, "No such draft");
    if (draft.buildState === "building")
      throw new StudioError(409, "This draft is still being built");
    const owned = await listSpaces(db, user.id);
    if (owned.length >= SPACE_LIMIT[user.kind]) {
      const hint = user.kind === "guest" ? " Keep your account (add your email) to make more." : "";
      throw new StudioError(
        403,
        `You can have ${SPACE_LIMIT[user.kind]} space(s). Remove one first.${hint}`,
      );
    }
    const parsed = Keep.safeParse({ name: rawName });
    const name = maskText(parsed.data?.name ?? (draft.idea ?? draft.name).slice(0, 40));
    const editor = await editors.get(draft.id);
    if (editor && editor.draftSteps.length > 0) await editor.save(user.id);
    await keepDraft(db, draft.id, name);
    await deletePlaces(
      db,
      drafts.filter((d) => d.id !== draft.id).map((d) => d.id),
    );
    await liveRooms.get(draft.id)?.refreshPlace();
    return { id: draft.id, name };
  }
}

/** HTTP routes for the studio, the gallery and submitting to it. */
export function registerStudioRoutes(
  app: Application,
  studio: Studio,
  deps: StudioDeps & { requireUser(req: Request, res: Response): Promise<User | undefined> },
): void {
  const { db, liveRooms, requireUser } = deps;
  const send = (res: Response, run: () => Promise<unknown>, status = 200) =>
    run()
      .then((body) => res.status(status).json(body))
      .catch((err) => {
        if (err instanceof StudioError) res.status(err.status).json({ error: err.message });
        else throw err;
      });

  app.get("/api/studio", async (req, res) => {
    const user = await requireUser(req, res);
    if (user) await send(res, () => studio.list(user.id));
  });

  app.post("/api/studio/drafts", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    await send(
      res,
      async () => {
        const { idea, drafts } = await studio.make(user, String(req.body?.idea ?? ""));
        return { idea, drafts };
      },
      202,
    );
  });

  app.delete("/api/studio/drafts", async (req, res) => {
    const user = await requireUser(req, res);
    if (user) await send(res, async () => (await studio.discard(user.id), { ok: true }));
  });

  app.post("/api/studio/drafts/:id/keep", async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const name = typeof req.body?.name === "string" ? req.body.name : undefined;
    await send(res, () => studio.keep(user, String(req.params.id), name));
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

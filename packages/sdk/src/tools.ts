import { z } from "zod";
import {
  Form,
  Light,
  Palette,
  type Scene,
  Surface,
  Atmosphere,
  PostEffect,
  type Template,
} from "@superworld/schema";
import type { PatchOp } from "./patch.ts";

/** Limits the engine enforces on every space, whatever door the edit comes through. */
export interface Budgets {
  maxObjects: number;
  maxParts: number;
  maxGroundRadius: number;
}

export const DEFAULT_BUDGETS: Budgets = { maxObjects: 300, maxParts: 2400, maxGroundRadius: 64 };

export interface ToolContext {
  scene: Scene;
  templates: ReadonlyMap<string, Template>;
  budgets: Budgets;
}

export interface ToolResult {
  /** Changes to the scene. Read-only tools return none. */
  patch?: PatchOp[];
  /** Data returned to the caller (e.g. a list for the agent). */
  output?: unknown;
  /** One line a person can read in the edit history. */
  summary: string;
}

export interface ToolDef<I = unknown> {
  name: string;
  module: "library" | "scene" | "style" | "space";
  description: string;
  input: z.ZodType<I>;
  readOnly?: boolean;
  run(ctx: ToolContext, input: I): ToolResult;
}

/** Thrown by a tool when the request can't be done; the message goes back to the caller. */
export class ToolError extends Error {}

export function defineTool<I>(def: ToolDef<I>): ToolDef<I> {
  return def;
}

const deg = (d: number) => (d * Math.PI) / 180;
const round = (n: number) => Math.round(n * 100) / 100;
const Coord = z.number().min(-200).max(200);

function instanceIndex(scene: Scene, id: string): number {
  const index = scene.instances.findIndex((i) => i.id === id);
  if (index < 0)
    throw new ToolError(`No object with id "${id}". Use scene_list_objects to see ids.`);
  return index;
}

/** What players can do with a template, in a few words for the agent. */
function describeUse(t: Template): string | undefined {
  const uses: string[] = [];
  if (t.item)
    uses.push(
      t.item.use === "wear"
        ? "wear it"
        : t.item.use === "throw"
          ? "take and throw it"
          : "take and hold it",
    );
  for (const b of t.behaviours) {
    if (b.kind === "sit") uses.push(`sit (${b.seats.length} seat${b.seats.length > 1 ? "s" : ""})`);
    if (b.kind === "give") uses.push(`take a ${b.item}`);
    if (b.kind === "play") uses.push(`play it (${b.sound})`);
    if (b.kind === "screen") uses.push("read it (set its text with scene_set_text)");
  }
  return uses.length > 0 ? uses.join(", ") : undefined;
}

function freshId(scene: Scene, template: string): string {
  const base = template
    .split("/")
    .pop()!
    .replace(/[^a-z0-9-]/g, "-");
  const taken = new Set(scene.instances.map((i) => i.id));
  for (let n = 1; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}

export const TOOLS = [
  defineTool({
    name: "library_list_templates",
    module: "library",
    description:
      "List the objects that can be placed in the space: their template ids, names, part counts and what players can do with them (sit, take an item, play, read). Call this before placing objects if you don't know the ids.",
    input: z.strictObject({}),
    readOnly: true,
    run: (ctx) => ({
      output: [...ctx.templates.values()].map((t) => ({
        id: t.id,
        name: t.name,
        parts: t.parts.length,
        ...(describeUse(t) ? { players: describeUse(t) } : {}),
      })),
      summary: "Listed the object library",
    }),
  }),
  defineTool({
    name: "scene_list_objects",
    module: "scene",
    description:
      "List every object currently in the space with its id, template, position (x, z in metres; the space is centred on 0,0), rotation in degrees and scale.",
    input: z.strictObject({}),
    readOnly: true,
    run: (ctx) => ({
      output: {
        groundRadius: ctx.scene.environment.ground.radius,
        objects: ctx.scene.instances.map((i) => ({
          id: i.id,
          template: i.template,
          x: round(i.at[0]),
          z: round(i.at[2]),
          yawDegrees: round((i.yaw * 180) / Math.PI),
          scale: i.scale,
          ...(i.text !== undefined ? { text: i.text } : {}),
        })),
      },
      summary: "Listed the objects in the space",
    }),
  }),
  defineTool({
    name: "scene_place_object",
    module: "scene",
    description:
      "Place one object from the library at (x, z) metres on the ground, optionally rotated (degrees, 0 faces +z) and scaled. Returns the new object's id.",
    input: z.strictObject({
      template: z.string().describe("Template id from library_list_templates, e.g. prim/bench"),
      x: Coord,
      z: Coord,
      yawDegrees: z.number().min(-360).max(360).optional(),
      scale: z.number().min(0.25).max(4).optional(),
    }),
    run: (ctx, input) => {
      if (!ctx.templates.has(input.template)) {
        throw new ToolError(`Unknown template "${input.template}". Use library_list_templates.`);
      }
      const id = freshId(ctx.scene, input.template);
      const instance = {
        id,
        template: input.template,
        at: [round(input.x), 0, round(input.z)],
        yaw: deg(input.yawDegrees ?? 0),
        scale: input.scale ?? 1,
      };
      return {
        patch: [{ op: "add", path: "/instances/-", value: instance }],
        output: { id },
        summary: `Placed ${ctx.templates.get(input.template)!.name} (${id}) at ${round(input.x)}, ${round(input.z)}`,
      };
    },
  }),
  defineTool({
    name: "scene_move_object",
    module: "scene",
    description: "Move, rotate or rescale an existing object. Only the fields you give change.",
    input: z.strictObject({
      id: z.string(),
      x: Coord.optional(),
      z: Coord.optional(),
      yawDegrees: z.number().min(-360).max(360).optional(),
      scale: z.number().min(0.25).max(4).optional(),
    }),
    run: (ctx, input) => {
      const index = instanceIndex(ctx.scene, input.id);
      const current = ctx.scene.instances[index]!;
      const next = {
        ...current,
        at: [round(input.x ?? current.at[0]), current.at[1], round(input.z ?? current.at[2])],
        yaw: input.yawDegrees === undefined ? current.yaw : deg(input.yawDegrees),
        scale: input.scale ?? current.scale,
      };
      return {
        patch: [{ op: "replace", path: `/instances/${index}`, value: next }],
        summary: `Moved ${input.id}`,
      };
    },
  }),
  defineTool({
    name: "scene_remove_object",
    module: "scene",
    description: "Remove one object from the space by id.",
    input: z.strictObject({ id: z.string() }),
    run: (ctx, input) => {
      const index = instanceIndex(ctx.scene, input.id);
      return {
        patch: [
          { op: "test", path: `/instances/${index}/id`, value: input.id },
          { op: "remove", path: `/instances/${index}` },
        ],
        summary: `Removed ${input.id}`,
      };
    },
  }),
  defineTool({
    name: "scene_set_text",
    module: "scene",
    description:
      "Set the text an object shows when a player reads it (for objects players can read, like a notice board). Plain text, up to 500 characters.",
    input: z.strictObject({ id: z.string(), text: z.string().max(500) }),
    run: (ctx, input) => {
      const index = instanceIndex(ctx.scene, input.id);
      const current = ctx.scene.instances[index]!;
      const template = ctx.templates.get(current.template);
      if (!template?.behaviours.some((b) => b.kind === "screen"))
        throw new ToolError(`${input.id} has nothing to read; only objects like notice boards do.`);
      return {
        patch: [
          { op: "replace", path: `/instances/${index}`, value: { ...current, text: input.text } },
        ],
        summary: `Changed the text on ${input.id}`,
      };
    },
  }),
  defineTool({
    name: "scene_clear",
    module: "scene",
    description:
      "Remove every object from the space, keeping the ground and style. Use only when starting over.",
    input: z.strictObject({ confirm: z.literal(true) }),
    run: () => ({
      patch: [{ op: "replace", path: "/instances", value: [] }],
      summary: "Cleared all objects",
    }),
  }),
  defineTool({
    name: "style_set",
    module: "style",
    description:
      "Set the space's art style. Topics you leave out keep inheriting from the world. form: lowpoly | smooth | voxel. surface: toon | soft | ink | pbr. colour palette: dusk | mint | candy | mono | meadow. light: golden | noon | overcast | neon. atmosphere: clear | mist | stars | petals. postEffects: the full list of screen effects to use, from outline | pixelate | grain | bloom ([] for none; phones may skip some).",
    input: z.strictObject({
      form: Form.optional(),
      surface: Surface.optional(),
      colour: Palette.optional(),
      light: Light.optional(),
      atmosphere: Atmosphere.optional(),
      postEffects: z
        .array(PostEffect)
        .max(4)
        .optional()
        .transform((list) => (list ? [...new Set(list)] : list)),
    }),
    run: (ctx, input) => {
      const style = {
        ...ctx.scene.style,
        ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
      };
      const changed = Object.entries(input)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}: ${v}`);
      return {
        patch: [{ op: "replace", path: "/style", value: style }],
        summary: `Style ${changed.join(", ") || "unchanged"}`,
      };
    },
  }),
  defineTool({
    name: "space_set_ground",
    module: "space",
    description: "Change the size (radius in metres) or colour of the space's round ground.",
    input: z.strictObject({
      radius: z.number().min(8).max(64).optional(),
      colour: z.enum(["ground", "stone", "wood", "leaf", "water", "base", "accent"]).optional(),
    }),
    run: (ctx, input) => {
      const ground = {
        ...ctx.scene.environment.ground,
        ...(input.radius ? { radius: input.radius } : {}),
        ...(input.colour ? { colour: input.colour } : {}),
      };
      return {
        patch: [{ op: "replace", path: "/environment/ground", value: ground }],
        summary: "Changed the ground",
      };
    },
  }),
  defineTool({
    name: "space_set_spawn",
    module: "space",
    description: "Set where visitors arrive in the space, at (x, z) metres.",
    input: z.strictObject({ x: Coord, z: Coord }),
    run: (_ctx, input) => ({
      patch: [
        {
          op: "replace",
          path: "/spawn",
          value: [{ at: [round(input.x), 0, round(input.z)], radius: 2 }],
        },
      ],
      summary: `Moved the arrival point to ${round(input.x)}, ${round(input.z)}`,
    }),
  }),
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

export const TOOLS_BY_NAME: ReadonlyMap<string, ToolDef<unknown>> = new Map(
  TOOLS.map((t) => [t.name, t as unknown as ToolDef<unknown>]),
);

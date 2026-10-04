import { z } from "zod";
import { ColourRef, Id, Vec3 } from "./common.ts";

const PartBase = {
  /** Offset from the instance origin. */
  at: Vec3.default([0, 0, 0]),
  /** Rotation around Y, radians. */
  yaw: z.number().default(0),
  colour: ColourRef,
  /** Solid parts get a collider; decorative parts don't. */
  solid: z.boolean().default(false),
  /** Glows (lamps, signs). */
  emissive: z.boolean().default(false),
};

/** Primitive shapes. Phase 1 builds every template from these; models arrive in Phase 2. */
export const Part = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("box"), size: Vec3, ...PartBase }),
  z.object({
    shape: z.literal("cylinder"),
    radius: z.number().positive(),
    height: z.number().positive(),
    ...PartBase,
  }),
  z.object({ shape: z.literal("sphere"), radius: z.number().positive(), ...PartBase }),
  z.object({
    shape: z.literal("cone"),
    radius: z.number().positive(),
    height: z.number().positive(),
    ...PartBase,
  }),
]);
export type Part = z.infer<typeof Part>;

/** Where an avatar sits, relative to the instance origin: feet position and facing. */
export const Seat = z.object({ at: Vec3, yaw: z.number().default(0) });
export type Seat = z.infer<typeof Seat>;

export const SOUNDS = ["chime", "drum", "bell", "pluck"] as const;

/**
 * What players can do with an object. The engine implements each kind once, so a new
 * template gets behaviour from data alone: no new code per item.
 */
export const Behaviour = z.discriminatedUnion("kind", [
  /** Players can sit on it. */
  z.object({ kind: z.literal("sit"), seats: z.array(Seat).min(1).max(8) }),
  /** Hands out an item (a template with `item`) to whoever uses it. */
  z.object({ kind: z.literal("give"), item: Id }),
  /** Plays a sound; each use plays the next note (semitones from the base pitch). */
  z.object({
    kind: z.literal("play"),
    sound: z.enum(SOUNDS),
    notes: z.array(z.number().int().min(-24).max(24)).min(1).max(16).default([0]),
  }),
  /** Opens a screen with text (an instance can override the text). */
  z.object({
    kind: z.literal("screen"),
    title: z.string().min(1).max(60),
    text: z.string().max(500),
  }),
]);
export type Behaviour = z.infer<typeof Behaviour>;

/** An item can be carried: held in the hand, held and thrown, or worn on the head. */
export const ItemUse = z.enum(["hold", "throw", "wear"]);
export type ItemUse = z.infer<typeof ItemUse>;

export const Template = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  parts: z.array(Part).min(1).max(64),
  behaviours: z.array(Behaviour).max(4).default([]),
  /** Set on templates that are items. Placing an item in a scene makes a stand that hands it out. */
  item: z.object({ use: ItemUse }).optional(),
});
export type Template = z.infer<typeof Template>;

export const TemplateLibrary = z.object({
  schema: z.literal("superworld.templates/1"),
  templates: z.array(Template),
});
export type TemplateLibrary = z.infer<typeof TemplateLibrary>;

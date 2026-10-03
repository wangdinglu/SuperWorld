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

export const Template = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  parts: z.array(Part).min(1).max(64),
});
export type Template = z.infer<typeof Template>;

export const TemplateLibrary = z.object({
  schema: z.literal("superworld.templates/1"),
  templates: z.array(Template),
});
export type TemplateLibrary = z.infer<typeof TemplateLibrary>;

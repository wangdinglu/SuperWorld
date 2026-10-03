import { z } from "zod";

/** Metres, Y up, ground on the XZ plane (three.js convention). */
export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

/** Lower-case slug or path-like id, e.g. "plaza" or "prim/bench". */
export const Id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9/_-]*$/, "use lower-case letters, digits, '/', '_' or '-'");

/** A named palette slot (resolved through the style) or a literal #rrggbb colour. */
export const ColourRef = z.union([
  z.enum(["base", "accent", "stone", "wood", "leaf", "water", "metal", "light", "ground"]),
  z.string().regex(/^#[0-9a-fA-F]{6}$/),
]);
export type ColourRef = z.infer<typeof ColourRef>;

import { z } from "zod";
import { Id } from "./common.ts";
import { ResolvedStyle } from "./style.ts";

export const PlaceKind = z.enum(["plaza", "district", "arena", "space", "studio"]);

export const PlaceEntry = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  kind: PlaceKind,
  /** Scene file under content/world, or null while the place isn't built yet. */
  scene: z.string().nullable(),
  /** Position on the atlas map, 0–100 on both axes. */
  atlas: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]),
  /** Phase in which the place opens. */
  phase: z.number().int().min(1).max(4),
});
export type PlaceEntry = z.infer<typeof PlaceEntry>;

export const World = z.object({
  schema: z.literal("superworld.world/1"),
  name: z.string(),
  spawnPlace: Id,
  defaultStyle: ResolvedStyle,
  places: z.array(PlaceEntry).min(1),
});
export type World = z.infer<typeof World>;

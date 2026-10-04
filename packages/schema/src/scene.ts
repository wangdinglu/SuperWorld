import { z } from "zod";
import { ColourRef, Id, Vec3 } from "./common.ts";
import { StyleProfile } from "./style.ts";

export const Instance = z.object({
  id: Id,
  template: Id,
  at: Vec3,
  yaw: z.number().default(0),
  scale: z.number().positive().max(20).default(1),
  /** Text for objects that show some (a notice board's screen). */
  text: z.string().max(500).optional(),
});
export type Instance = z.infer<typeof Instance>;

export const SpawnArea = z.object({ at: Vec3, radius: z.number().positive().max(50) });
export type SpawnArea = z.infer<typeof SpawnArea>;

export const Portal = z.object({
  id: Id,
  /** Target place id from the world manifest. */
  target: Id,
  label: z.string().max(40),
  at: Vec3,
  yaw: z.number().default(0),
});
export type Portal = z.infer<typeof Portal>;

export const Scene = z.object({
  schema: z.literal("superworld.scene/1"),
  place: Id,
  revision: z.number().int().nonnegative(),
  style: StyleProfile.default({}),
  environment: z.object({
    sky: z.literal("gradient"),
    ground: z.object({
      shape: z.literal("disc"),
      radius: z.number().positive().max(300),
      colour: ColourRef.default("ground"),
    }),
  }),
  spawn: z.array(SpawnArea).min(1),
  instances: z.array(Instance).max(2000),
  portals: z.array(Portal).default([]),
  access: z.object({ visibility: z.enum(["public", "friends", "private"]) }),
});
export type Scene = z.infer<typeof Scene>;

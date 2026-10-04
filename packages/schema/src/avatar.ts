import { z } from "zod";
import { Id } from "./common.ts";
import { Form, Palette, Surface } from "./style.ts";

/**
 * One avatar in the default set. Each one is drawn in a single style, so its style topics say how
 * it looks: the shape language (form), the shading (surface) and the palette it is coloured from.
 * Avatars made by others have no palette (they bring their own textures) and say where they came from.
 */
export const AvatarEntry = z.object({
  id: Id,
  name: z.string().min(1).max(32),
  /** VRM file (1.0, or 0.x for downloaded avatars) next to the library. */
  file: z.string().regex(/^[a-z0-9-]+\.vrm$/, "a lower-case .vrm file name"),
  style: z.object({ form: Form, surface: Surface, colour: Palette.optional() }),
  /** One line for the avatar picker. */
  about: z.string().min(1).max(160),
  /** Set for avatars downloaded rather than made in tools/avatars. Only open licences. */
  source: z
    .object({
      author: z.string().min(1).max(80),
      collection: z.string().max(80).optional(),
      url: z.url(),
      license: z.enum(["CC0", "CC-BY"]),
      /** The original file, fetched by `pnpm avatars:import`, and its SHA-256. */
      download: z.url().optional(),
      sha256: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .optional(),
      /** Repairs the import applies so the file meets the VRM spec (see tools/avatars/import.ts). */
      fixes: z
        .array(z.enum(["mirrorZ", "tPose"]))
        .max(2)
        .optional(),
    })
    .optional(),
});
export type AvatarEntry = z.infer<typeof AvatarEntry>;

export const AvatarLibrary = z
  .object({
    schema: z.literal("superworld.avatars/1"),
    /** The avatar a new player starts as. */
    default: Id,
    avatars: z.array(AvatarEntry).min(1).max(64),
  })
  .superRefine((lib, ctx) => {
    const ids = new Set<string>();
    for (const a of lib.avatars) {
      if (!a.source && !a.style.colour)
        ctx.addIssue({
          code: "custom",
          message: `avatar "${a.id}" needs a palette (style.colour)`,
        });
      if (ids.has(a.id))
        ctx.addIssue({ code: "custom", message: `avatar "${a.id}" is listed twice` });
      ids.add(a.id);
    }
    if (!ids.has(lib.default))
      ctx.addIssue({
        code: "custom",
        path: ["default"],
        message: `"${lib.default}" is not listed`,
      });
  });
export type AvatarLibrary = z.infer<typeof AvatarLibrary>;

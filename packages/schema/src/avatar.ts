import { z } from "zod";
import { Id } from "./common.ts";
import { Form, Palette, Surface } from "./style.ts";

/**
 * One avatar in the default set. Each one is drawn in a single style, so its style topics say how
 * it looks: the shape language (form), the shading (surface) and the palette it is coloured from.
 */
export const AvatarEntry = z.object({
  id: Id,
  name: z.string().min(1).max(32),
  /** VRM 1.0 file next to the library. */
  file: z.string().regex(/^[a-z0-9-]+\.vrm$/, "a lower-case .vrm file name"),
  style: z.object({ form: Form, surface: Surface, colour: Palette }),
  /** One line for the avatar picker. */
  about: z.string().min(1).max(160),
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

import { z } from "zod";

export const Form = z.enum(["lowpoly", "smooth", "voxel"]);
export const Surface = z.enum(["toon", "soft", "ink", "pbr"]);
export const Palette = z.enum(["dusk", "mint", "candy", "mono", "meadow"]);
export const Light = z.enum(["golden", "noon", "overcast", "neon"]);
export const Atmosphere = z.enum(["clear", "mist", "stars", "petals"]);
export const PostEffect = z.enum(["outline", "pixelate", "grain", "bloom"]);

/** Every topic set: what the world default must provide, and what the resolver returns. */
export const ResolvedStyle = z.object({
  form: Form,
  surface: Surface,
  colour: Palette,
  light: Light,
  atmosphere: Atmosphere,
  postEffects: z.array(PostEffect).max(4),
  motion: z.string().max(32),
  sound: z.string().max(32),
  look2d: z.string().max(32),
});
export type ResolvedStyle = z.infer<typeof ResolvedStyle>;

/** A style profile at any level (district, space, object): every topic optional. */
export const StyleProfile = ResolvedStyle.partial();
export type StyleProfile = z.infer<typeof StyleProfile>;

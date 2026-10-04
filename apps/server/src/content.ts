import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AvatarLibrary, checkContent, Scene, TemplateLibrary, World } from "@superworld/schema";

export interface Content {
  world: World;
  templates: TemplateLibrary;
  scenes: Record<string, Scene>;
  avatars: AvatarLibrary;
}

/** Repo-relative content folder; the same depth from src/ (dev) and dist/ (built). */
export const CONTENT_DIR =
  process.env.CONTENT_DIR ?? join(import.meta.dirname, "..", "..", "..", "content", "world");

/** The avatar library sits next to the world folder (content/avatars). */
export const AVATAR_DIR = process.env.AVATAR_DIR ?? join(CONTENT_DIR, "..", "avatars");

/** Loads and validates the world content. Throws if anything is invalid, so a bad deploy fails fast. */
export function loadContent(dir = CONTENT_DIR, avatarDir = AVATAR_DIR): Content {
  const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), "utf8"));
  const world = World.parse(read("world.json"));
  const templates = TemplateLibrary.parse(read("templates.json"));
  const scenes: Record<string, Scene> = {};
  for (const place of world.places) {
    if (place.scene) scenes[place.id] = Scene.parse(read(place.scene));
  }
  const problems = checkContent(world, templates, scenes);
  if (problems.length > 0) throw new Error(`Invalid content:\n- ${problems.join("\n- ")}`);
  const avatars = AvatarLibrary.parse(
    JSON.parse(readFileSync(join(avatarDir, "avatars.json"), "utf8")),
  );
  return { world, templates, scenes, avatars };
}

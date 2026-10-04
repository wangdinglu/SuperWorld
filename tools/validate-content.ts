// Validates every document under content/ against the schemas and checks cross-references.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AvatarLibrary, checkContent, Scene, TemplateLibrary, World } from "@superworld/schema";
import { checkVrm } from "./avatars/check-vrm.ts";

const dir = join(import.meta.dirname, "..", "content", "world");
const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), "utf8"));

const problems: string[] = [];
const parse = <T>(
  label: string,
  schema: {
    safeParse(
      v: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  value: unknown,
): T | undefined => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    problems.push(`${label}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  return undefined;
};

const world = parse("world.json", World, read("world.json"));
const templates = parse("templates.json", TemplateLibrary, read("templates.json"));
const scenes: Record<string, Scene> = {};
for (const place of world?.places ?? []) {
  if (!place.scene) continue;
  const scene = parse(place.scene, Scene, read(place.scene));
  if (scene) scenes[place.id] = scene;
}
if (world && templates) problems.push(...checkContent(world, templates, scenes));

// Avatars: every listed file is a VRM 1.0 avatar that records the style the library says it has.
const avatarDir = join(import.meta.dirname, "..", "content", "avatars");
const avatars = parse(
  "avatars.json",
  AvatarLibrary,
  JSON.parse(readFileSync(join(avatarDir, "avatars.json"), "utf8")),
);
for (const avatar of avatars?.avatars ?? []) {
  const file = join(avatarDir, avatar.file);
  if (!existsSync(file)) {
    problems.push(`avatars.json: "${avatar.id}" names ${avatar.file}, which is missing`);
    continue;
  }
  for (const p of checkVrm(readFileSync(file), avatar)) problems.push(`${avatar.file}: ${p}`);
  if (!existsSync(join(avatarDir, `${avatar.id}.png`)))
    problems.push(`avatars.json: "${avatar.id}" has no thumbnail (run pnpm avatars:thumbnails)`);
}

if (problems.length > 0) {
  console.error(`Content has ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `Content OK: ${Object.keys(scenes).length} scene(s), ${templates?.templates.length} template(s), ${avatars?.avatars.length} avatar(s).`,
);

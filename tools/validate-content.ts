// Validates every document under content/ against the schemas and checks cross-references.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkContent, Scene, TemplateLibrary, World } from "@superworld/schema";

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

if (problems.length > 0) {
  console.error(`Content has ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `Content OK: ${Object.keys(scenes).length} scene(s), ${templates?.templates.length} template(s).`,
);

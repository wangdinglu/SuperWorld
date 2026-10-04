import type { Scene } from "./scene.ts";
import type { TemplateLibrary } from "./template.ts";
import type { World } from "./world.ts";

/** Checks references between documents that a single schema can't see. Returns problems found. */
export function checkContent(
  world: World,
  templates: TemplateLibrary,
  scenes: Record<string, Scene>,
): string[] {
  const problems: string[] = [];
  const templateIds = new Set<string>();
  for (const t of templates.templates) {
    if (templateIds.has(t.id)) problems.push(`template "${t.id}" is defined twice`);
    templateIds.add(t.id);
  }
  const items = new Set(templates.templates.filter((t) => t.item).map((t) => t.id));
  for (const t of templates.templates) {
    for (const b of t.behaviours) {
      if (b.kind === "give" && !items.has(b.item))
        problems.push(`template "${t.id}" gives "${b.item}", which is not an item template`);
    }
  }
  const placeIds = new Set(world.places.map((p) => p.id));
  if (!placeIds.has(world.spawnPlace))
    problems.push(`spawnPlace "${world.spawnPlace}" is not a place`);

  for (const place of world.places) {
    if (!place.scene) continue;
    const scene = scenes[place.id];
    if (!scene) {
      problems.push(`place "${place.id}" names scene "${place.scene}" but it was not loaded`);
      continue;
    }
    if (scene.place !== place.id) {
      problems.push(`scene for "${place.id}" says place "${scene.place}"`);
    }
    const ids = new Set<string>();
    for (const inst of scene.instances) {
      if (ids.has(inst.id)) problems.push(`${place.id}: instance id "${inst.id}" is used twice`);
      ids.add(inst.id);
      if (!templateIds.has(inst.template)) {
        problems.push(
          `${place.id}: instance "${inst.id}" uses unknown template "${inst.template}"`,
        );
      }
      const [x, , z] = inst.at;
      if (Math.hypot(x, z) > scene.environment.ground.radius) {
        problems.push(`${place.id}: instance "${inst.id}" is outside the ground`);
      }
    }
    for (const portal of scene.portals) {
      if (!placeIds.has(portal.target)) {
        problems.push(
          `${place.id}: portal "${portal.id}" targets unknown place "${portal.target}"`,
        );
      }
    }
  }
  return problems;
}

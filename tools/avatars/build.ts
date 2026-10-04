// Builds every avatar listed in content/avatars/avatars.json into a VRM 1.0 file next to it.
// Each avatar is coloured from its style's palette and records its style in the file.
// Run with `pnpm avatars` (all) or `pnpm avatars inky` (one). Thumbnails (<id>.png), when present,
// are embedded as the VRM thumbnail; `pnpm avatars:thumbnails` renders them.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AvatarLibrary } from "@superworld/schema";
import { PALETTES } from "@superworld/style";
import * as bolt from "./bolt.ts";
import * as inky from "./inky.ts";
import type { Palette } from "./lib/palette.ts";
import type { AvatarBuilder } from "./lib/vrm.ts";
import * as pip from "./pip.ts";
import * as sprout from "./sprout.ts";

const builders: Record<string, (palette: Palette) => AvatarBuilder> = {
  sprout: sprout.build,
  pip: pip.build,
  inky: inky.build,
  bolt: bolt.build,
};

const dir = join(import.meta.dirname, "..", "..", "content", "avatars");
const library = AvatarLibrary.parse(JSON.parse(readFileSync(join(dir, "avatars.json"), "utf8")));
const only = process.argv.slice(2);

for (const avatar of library.avatars) {
  if (only.length && !only.includes(avatar.id)) continue;
  if (avatar.source) continue; // downloaded, not built here
  const build = builders[avatar.id];
  if (!build) throw new Error(`No builder for avatar "${avatar.id}" in tools/avatars/build.ts`);
  if (!avatar.style.colour) throw new Error(`Avatar "${avatar.id}" needs a palette`);
  const builder = build(PALETTES[avatar.style.colour]);
  const thumbnailPath = join(dir, `${avatar.id}.png`);
  const thumbnail = existsSync(thumbnailPath) ? readFileSync(thumbnailPath) : undefined;
  const glb = builder.build(
    {
      name: avatar.name,
      copyright: `SuperWorld default avatar (${avatar.style.form} / ${avatar.style.surface} / ${avatar.style.colour}), made in code by tools/avatars`,
    },
    { superworld: { avatar: avatar.id, style: avatar.style } },
    thumbnail,
  );
  writeFileSync(join(dir, avatar.file), glb);
  console.log(
    `${avatar.file.padEnd(11)} ${String(Math.round(glb.length / 1024)).padStart(4)} KiB  ${String(builder.triangles()).padStart(5)} triangles  ${avatar.style.form} / ${avatar.style.surface} / ${avatar.style.colour}`,
  );
}

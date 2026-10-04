import type { AvatarEntry, AvatarLibrary } from "@superworld/schema";
import libraryJson from "../../../content/avatars/avatars.json";

/** The default avatar set (checked by `pnpm validate:content`). */
export const avatarLibrary = libraryJson as AvatarLibrary;

// Vite copies the files into the build and gives each a hashed URL.
const files = import.meta.glob<string>("../../../content/avatars/*.{vrm,png}", {
  query: "?url",
  import: "default",
  eager: true,
});
const fileUrl = (name: string) => files[`../../../content/avatars/${name}`];

/** The library entry for an id, falling back to the default avatar. */
export function avatarEntry(id: string): AvatarEntry {
  return (
    avatarLibrary.avatars.find((a) => a.id === id) ??
    avatarLibrary.avatars.find((a) => a.id === avatarLibrary.default)!
  );
}

export const avatarUrl = (id: string): string => fileUrl(avatarEntry(id).file)!;
export const avatarThumbnail = (id: string): string | undefined => fileUrl(`${id}.png`);

import type { ColourRef, ResolvedStyle, StyleProfile } from "@superworld/schema";

/**
 * Resolves a style through the nesting chain: world default → district → space → object.
 * Later levels win; topics a level leaves unset are inherited.
 */
export function resolveStyle(
  worldDefault: ResolvedStyle,
  ...levels: (StyleProfile | undefined)[]
): ResolvedStyle {
  const out: ResolvedStyle = { ...worldDefault, postEffects: [...worldDefault.postEffects] };
  for (const level of levels) {
    if (!level) continue;
    for (const [key, value] of Object.entries(level) as [keyof ResolvedStyle, unknown][]) {
      if (value === undefined) continue;
      (out as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return out;
}

type Slot = Exclude<ColourRef, `#${string}`>;

/** Colours for each named palette slot. */
export const PALETTES: Record<ResolvedStyle["colour"], Record<Slot, string>> = {
  meadow: {
    base: "#f2785c",
    accent: "#6c8cff",
    stone: "#d8d2c4",
    wood: "#9a6b47",
    leaf: "#5fae6b",
    water: "#6cc4e0",
    metal: "#4a5160",
    light: "#ffe7a3",
    ground: "#b9d48a",
  },
  dusk: {
    base: "#f2785c",
    accent: "#6c4fb3",
    stone: "#c9b8c8",
    wood: "#7a4e3a",
    leaf: "#2e9c8a",
    water: "#7fb6e6",
    metal: "#3b3550",
    light: "#ffd36e",
    ground: "#8f7aa8",
  },
  mint: {
    base: "#3fbf9b",
    accent: "#f58da8",
    stone: "#e3efe8",
    wood: "#8c6a4f",
    leaf: "#9bd46b",
    water: "#7fdcd0",
    metal: "#1f6f5e",
    light: "#fff2b3",
    ground: "#c9ebd6",
  },
  candy: {
    base: "#ff6fb5",
    accent: "#59c3e8",
    stone: "#f6e6f0",
    wood: "#c98f6b",
    leaf: "#b28dff",
    water: "#8fe3ff",
    metal: "#7a6a9a",
    light: "#ffe066",
    ground: "#ffd1e8",
  },
  mono: {
    base: "#6b7080",
    accent: "#2a2d34",
    stone: "#d9dbe1",
    wood: "#8a8d96",
    leaf: "#a9aebb",
    water: "#c3c7d0",
    metal: "#2a2d34",
    light: "#ffffff",
    ground: "#e6e8ee",
  },
};

export function colourOf(ref: ColourRef, style: ResolvedStyle): string {
  return ref.startsWith("#") ? ref : (PALETTES[style.colour][ref as Slot] ?? "#ff00ff");
}

/** Sky and sun settings for each light topic. */
export const LIGHT_RIGS: Record<
  ResolvedStyle["light"],
  {
    skyTop: string;
    skyBottom: string;
    sun: string;
    sunIntensity: number;
    ambient: string;
    ambientIntensity: number;
    sunDir: [number, number, number];
    fog: string;
  }
> = {
  noon: {
    skyTop: "#5fb2f5",
    skyBottom: "#d3edff",
    sun: "#fff6e0",
    sunIntensity: 2.4,
    ambient: "#cfe6ff",
    ambientIntensity: 1.1,
    sunDir: [0.3, 1, 0.2],
    fog: "#d3edff",
  },
  golden: {
    skyTop: "#ff9d6c",
    skyBottom: "#ffdca6",
    sun: "#ffc98a",
    sunIntensity: 2.2,
    ambient: "#ffd9b8",
    ambientIntensity: 0.9,
    sunDir: [-0.8, 0.35, 0.4],
    fog: "#ffdca6",
  },
  overcast: {
    skyTop: "#8e97a5",
    skyBottom: "#cdd2da",
    sun: "#eef1f5",
    sunIntensity: 1.0,
    ambient: "#dfe3ea",
    ambientIntensity: 1.6,
    sunDir: [0.2, 1, 0.1],
    fog: "#cdd2da",
  },
  neon: {
    skyTop: "#0f0a2b",
    skyBottom: "#3b1670",
    sun: "#b9a8ff",
    sunIntensity: 0.6,
    ambient: "#5a3fa0",
    ambientIntensity: 0.9,
    sunDir: [0.4, 1, -0.3],
    fog: "#2a1352",
  },
};

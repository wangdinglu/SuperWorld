import type { PALETTES } from "@superworld/style";

/** The colours of one style palette, by slot (base, accent, stone, wood, leaf, …). */
export type Palette = (typeof PALETTES)[keyof typeof PALETTES];

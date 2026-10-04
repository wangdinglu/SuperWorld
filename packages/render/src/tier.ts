import type { ResolvedStyle } from "@superworld/schema";

export type Tier = "low" | "medium" | "high";

export interface TierSettings {
  pixelRatioCap: number;
  shadows: "blob" | "realtime";
  /** Avatars drawn at full detail; the rest are hidden beyond `farAvatarDistance`. */
  fullDetailAvatars: number;
  farAvatarDistance: number;
  /** Frame-time budget in ms; the governor steps down when it stays over this. */
  frameBudgetMs: number;
  antialias: boolean;
  /** Animated TSL materials (water, glass, holograms) or static stand-ins. */
  materials: "full" | "lite";
  /** Ink outlines (drawn as a second, inside-out copy of each part). */
  outlines: boolean;
  /** Screen effects this tier may run when a style asks for them. */
  postEffects: ResolvedStyle["postEffects"];
  /** Multiplier on atmosphere particle counts (stars, petals). */
  particles: number;
}

/** Starting targets from docs/ARCHITECTURE.md §8, tuned in testing. */
export const TIERS: Record<Tier, TierSettings> = {
  low: {
    pixelRatioCap: 1,
    shadows: "blob",
    fullDetailAvatars: 12,
    farAvatarDistance: 45,
    frameBudgetMs: 1000 / 30,
    antialias: false,
    materials: "lite",
    outlines: false,
    postEffects: ["pixelate"],
    particles: 0.35,
  },
  medium: {
    pixelRatioCap: 1.5,
    shadows: "blob",
    fullDetailAvatars: 24,
    farAvatarDistance: 70,
    frameBudgetMs: 1000 / 45,
    antialias: true,
    materials: "full",
    outlines: true,
    postEffects: ["outline", "pixelate", "grain"],
    particles: 0.7,
  },
  high: {
    pixelRatioCap: 2,
    shadows: "realtime",
    fullDetailAvatars: 40,
    farAvatarDistance: 120,
    frameBudgetMs: 1000 / 60,
    antialias: true,
    materials: "full",
    outlines: true,
    postEffects: ["outline", "pixelate", "grain", "bloom"],
    particles: 1,
  },
};

const ORDER: Tier[] = ["low", "medium", "high"];

/** First guess from device signals. The governor corrects it at runtime. */
export function detectTier(): Tier {
  const forced = new URLSearchParams(location.search).get("tier");
  if (forced === "low" || forced === "medium" || forced === "high") return forced;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const touch = matchMedia("(pointer: coarse)").matches;
  const memory = nav.deviceMemory ?? 4;
  const cores = nav.hardwareConcurrency ?? 4;
  if (touch) return memory >= 6 && cores >= 8 ? "medium" : "low";
  if (memory <= 4 || cores <= 4) return "medium";
  return "high";
}

/** Drops a tier when frame time stays over budget; never raises it again in the same session. */
export class FrameGovernor {
  private samples: number[] = [];
  private cooldownUntil = 0;
  constructor(
    public tier: Tier,
    private readonly onChange: (tier: Tier) => void,
  ) {}

  /** Call once per frame with the frame time in ms and the current time in ms. */
  sample(frameMs: number, now: number): void {
    if (document.hidden || now < this.cooldownUntil) return;
    this.samples.push(Math.min(frameMs, 250));
    if (this.samples.length < 120) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.samples = [];
    const index = ORDER.indexOf(this.tier);
    if (avg > TIERS[this.tier].frameBudgetMs * 1.25 && index > 0) {
      this.tier = ORDER[index - 1]!;
      this.cooldownUntil = now + 5000;
      this.onChange(this.tier);
    }
  }
}

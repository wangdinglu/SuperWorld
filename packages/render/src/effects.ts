import * as THREE from "three/webgpu";
import { float, floor, pass, screenSize, screenUV } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { film } from "three/addons/tsl/display/FilmNode.js";
import type { ResolvedStyle } from "@superworld/schema";
import { type Tier, TIERS } from "./tier.ts";

type ScreenEffect = "pixelate" | "grain" | "bloom";
/** Size of a pixelate block, in screen pixels. */
const PIXEL = 4;

/** The screen effects a style asks for that this tier can afford (outlines are drawn as geometry). */
export function screenEffects(style: ResolvedStyle, tier: Tier): ScreenEffect[] {
  const allowed = new Set(TIERS[tier].postEffects);
  return style.postEffects.filter((e): e is ScreenEffect => e !== "outline" && allowed.has(e));
}

/**
 * Draws the frame, through a TSL post-processing chain when the style has screen effects
 * (pixelate, film grain, bloom) and straight to the canvas when it has none.
 */
export class StylePipeline {
  private pipeline: THREE.RenderPipeline | undefined;
  private key = "";

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {}

  /** Rebuilds the chain when the style or tier changes what it needs. */
  configure(style: ResolvedStyle, tier: Tier): void {
    const effects = screenEffects(style, tier);
    const key = effects.join(",");
    if (key === this.key) return;
    this.key = key;
    this.pipeline?.dispose();
    this.pipeline = undefined;
    if (effects.length === 0) return;

    const scenePass = pass(this.scene, this.camera);
    let output: THREE.Node<"vec4"> = scenePass;
    if (effects.includes("pixelate")) {
      // Every block of PIXEL × PIXEL screen pixels takes the colour at its centre.
      const blocks = screenSize.div(PIXEL);
      output = scenePass.getTextureNode().sample(floor(screenUV.mul(blocks)).add(0.5).div(blocks));
    }
    if (effects.includes("bloom")) output = output.add(bloom(scenePass, 0.7, 0.35, 0.82));
    const pipeline = new THREE.RenderPipeline(this.renderer);
    pipeline.outputNode = effects.includes("grain") ? film(output, float(0.22)) : output;
    this.pipeline = pipeline;
  }

  /** The effects currently applied, for tests and the debug pill. */
  get active(): string[] {
    return this.key ? this.key.split(",") : [];
  }

  render(): void {
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.pipeline?.dispose();
  }
}

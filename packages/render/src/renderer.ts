import { WebGPURenderer } from "three/webgpu";
import { type Tier, TIERS } from "./tier.ts";

export interface RendererInfo {
  renderer: WebGPURenderer;
  backend: "webgpu" | "webgl2";
}

/** Creates the renderer: WebGPU where available, WebGL2 otherwise (three.js falls back by itself). */
export async function createRenderer(canvas: HTMLCanvasElement, tier: Tier): Promise<RendererInfo> {
  const forceWebGL = new URLSearchParams(location.search).has("webgl");
  const renderer = new WebGPURenderer({ canvas, antialias: TIERS[tier].antialias, forceWebGL, powerPreference: "high-performance" });
  await renderer.init();
  applyTier(renderer, tier);
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? "webgpu" : "webgl2";
  return { renderer, backend };
}

export function applyTier(renderer: WebGPURenderer, tier: Tier): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIERS[tier].pixelRatioCap));
  renderer.shadowMap.enabled = TIERS[tier].shadows === "realtime";
}

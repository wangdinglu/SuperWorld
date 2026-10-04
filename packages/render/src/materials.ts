import * as THREE from "three/webgpu";
import {
  color,
  float,
  mix,
  normalize,
  normalView,
  positionLocal,
  positionViewDirection,
  positionWorld,
  sin,
  time,
} from "three/tsl";
import type { Finish, ResolvedStyle } from "@superworld/schema";

/**
 * How rich materials are. "full" uses animated, view-dependent TSL materials; "lite" uses
 * static stand-ins with the same colours, for phones and the low tier.
 */
export type MaterialQuality = "full" | "lite";

export interface MaterialOptions {
  emissive?: boolean;
  finish?: Finish;
  quality?: MaterialQuality;
  /** Reflections for metal and glass. */
  environment?: THREE.Texture;
}

const cache = new Map<string, THREE.Material>();

/** How far outlines stand off the surface, in metres. */
const OUTLINE_WIDTH = 0.05;
const outlineMaterials = new Map<string, THREE.Material>();

/** One-minus-facing: 0 where the surface faces the camera, 1 at grazing angles. */
const fresnel = () => float(1).sub(normalView.dot(positionViewDirection).abs()).pow(2);

function surfaceMaterial(colour: string, style: ResolvedStyle): THREE.Material {
  const flatShading = style.form === "lowpoly";
  switch (style.surface) {
    case "toon":
      return new THREE.MeshToonMaterial({ color: colour });
    case "ink":
      // Pale fills; the outline carries the drawing.
      return new THREE.MeshToonMaterial({
        color: new THREE.Color(colour).lerp(new THREE.Color("#ffffff"), 0.55),
      });
    case "pbr":
      return new THREE.MeshStandardMaterial({
        color: colour,
        roughness: 0.6,
        metalness: 0.1,
        flatShading,
      });
    case "soft":
      return new THREE.MeshLambertMaterial({ color: colour, flatShading });
  }
}

function finishMaterial(
  colour: string,
  finish: Finish,
  quality: MaterialQuality,
  environment: THREE.Texture | undefined,
): THREE.Material {
  const base = new THREE.Color(colour);
  switch (finish) {
    case "metal": {
      const m = new THREE.MeshStandardNodeMaterial({ color: base, metalness: 0.9, roughness: 0.3 });
      if (environment) m.envMap = environment;
      return m;
    }
    case "glass": {
      const m = new THREE.MeshStandardNodeMaterial({
        color: base.clone().lerp(new THREE.Color("#ffffff"), 0.5),
        metalness: 0,
        roughness: 0.05,
        transparent: true,
        depthWrite: false,
        opacity: 0.3,
      });
      if (environment) m.envMap = environment;
      // Glass reflects more at grazing angles.
      if (quality === "full") m.opacityNode = mix(float(0.18), float(0.75), fresnel());
      return m;
    }
    case "water": {
      const m = new THREE.MeshStandardNodeMaterial({
        color: base,
        metalness: 0,
        roughness: 0.15,
        transparent: true,
        opacity: 0.85,
      });
      if (environment) m.envMap = environment;
      if (quality === "full") {
        // Slow crossing ripples of lighter colour.
        const w = sin(positionWorld.x.mul(1.3).add(time.mul(1.5)))
          .mul(sin(positionWorld.z.mul(1.1).sub(time.mul(1.2))))
          .mul(0.5)
          .add(0.5);
        m.colorNode = mix(
          color(base),
          color(base.clone().lerp(new THREE.Color("#ffffff"), 0.45)),
          w,
        );
      }
      return m;
    }
    case "hologram": {
      const m = new THREE.MeshBasicNodeMaterial({
        color: base,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        opacity: 0.55,
      });
      if (quality === "full") {
        // Scanlines drifting up, a bright rim, and a faint flicker.
        const scan = sin(positionWorld.y.mul(48).sub(time.mul(5)))
          .mul(0.5)
          .add(0.5);
        const flicker = sin(time.mul(23)).mul(0.04).add(0.96);
        m.opacityNode = scan.mul(0.35).add(fresnel().mul(0.8)).add(0.15).mul(flicker);
      }
      return m;
    }
  }
}

/** Library materials for a part. Shared and cached, so many objects cost few materials. */
export function materialFor(
  colour: string,
  style: ResolvedStyle,
  options: MaterialOptions = {},
): THREE.Material {
  const quality = options.quality ?? "full";
  const key = [
    colour,
    style.surface,
    style.form,
    options.emissive ? "e" : "",
    options.finish ?? "",
    options.finish ? quality : "",
    options.finish === "metal" || options.finish === "glass" || options.finish === "water"
      ? (options.environment?.uuid ?? "")
      : "",
  ].join("|");
  let material = cache.get(key);
  if (!material) {
    if (options.finish) {
      material = finishMaterial(colour, options.finish, quality, options.environment);
    } else if (options.emissive) {
      material = new THREE.MeshBasicMaterial({ color: colour });
    } else {
      material = surfaceMaterial(colour, style);
    }
    cache.set(key, material);
  }
  return material;
}

/**
 * The ink line around a part: the same mesh drawn again, inside out and pushed outward. Vertices
 * move along their direction from the part's centre, so shared corners stay joined (no cracks).
 */
export function outlineMaterial(ink: string): THREE.Material {
  let material = outlineMaterials.get(ink);
  if (!material) {
    const m = new THREE.MeshBasicNodeMaterial({ color: ink, side: THREE.BackSide });
    m.positionNode = positionLocal.add(normalize(positionLocal).mul(OUTLINE_WIDTH));
    outlineMaterials.set(ink, m);
    material = m;
  }
  return material;
}

/** Whether a style asks for outlines (the ink surface always has them). */
export function wantsOutline(style: ResolvedStyle): boolean {
  return style.surface === "ink" || style.postEffects.includes("outline");
}

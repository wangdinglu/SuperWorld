import * as THREE from "three/webgpu";
import type { ResolvedStyle } from "@superworld/schema";
import { LIGHT_RIGS, PALETTES } from "@superworld/style";

/** Particles and sky details for the atmosphere topic. `update` runs once per frame. */
export interface Atmosphere {
  object: THREE.Object3D;
  update(dt: number, around: THREE.Vector3): void;
  dispose(): void;
}

const STARS = 900;
const PETALS = 260;
/** Petals fill a box this big around the camera's target and wrap at its edges. */
const BOX = 36;
const HEIGHT = 14;

function stars(style: ResolvedStyle, density: number): Atmosphere {
  const count = Math.round(STARS * density);
  const positions = new Float32Array(count * 3);
  // A fixed seed so every visitor sees the same sky.
  let seed = 12345;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < count; i++) {
    const theta = rand() * Math.PI * 2;
    const y = 0.08 + rand() * 0.92;
    const r = Math.sqrt(1 - y * y);
    positions.set([Math.cos(theta) * r * 380, y * 380, Math.sin(theta) * r * 380], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  // Bright against night skies, faint in daylight.
  const night = style.light === "neon" || style.light === "golden";
  const material = new THREE.PointsMaterial({
    color: "#ffffff",
    size: 2,
    sizeAttenuation: false,
    transparent: true,
    opacity: night ? 0.95 : 0.45,
    fog: false,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = -1;
  return {
    object: points,
    update: (_dt, around) => points.position.set(around.x, 0, around.z),
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

function petals(style: ResolvedStyle, density: number): Atmosphere {
  const count = Math.round(PETALS * density);
  const geometry = new THREE.PlaneGeometry(0.14, 0.09);
  const tint = new THREE.Color(PALETTES[style.colour].base).lerp(new THREE.Color("#ffffff"), 0.55);
  const material = new THREE.MeshLambertMaterial({ color: tint, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  let seed = 777;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const petals = Array.from({ length: count }, () => ({
    x: (rand() - 0.5) * BOX,
    y: rand() * HEIGHT,
    z: (rand() - 0.5) * BOX,
    fall: 0.5 + rand() * 0.6,
    sway: rand() * Math.PI * 2,
    spin: (rand() - 0.5) * 4,
  }));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let t = 0;
  const wrap = (v: number, centre: number) =>
    centre + ((((v - centre + BOX / 2) % BOX) + BOX) % BOX) - BOX / 2;
  return {
    object: mesh,
    update(dt, around) {
      t += dt;
      petals.forEach((petal, i) => {
        petal.y -= petal.fall * dt;
        if (petal.y < 0) petal.y += HEIGHT;
        petal.x = wrap(petal.x + Math.sin(t * 0.7 + petal.sway) * 0.4 * dt + 0.25 * dt, around.x);
        petal.z = wrap(petal.z + Math.cos(t * 0.5 + petal.sway) * 0.3 * dt, around.z);
        p.set(petal.x, petal.y, petal.z);
        q.setFromEuler(e.set(t * petal.spin, petal.sway + t * 0.3, t * petal.spin * 0.6));
        mesh.setMatrixAt(i, m.compose(p, q, one));
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Builds the atmosphere for a style; "clear" and "mist" (fog only) have no particles. */
export function buildAtmosphere(style: ResolvedStyle, density: number): Atmosphere | undefined {
  if (density <= 0) return undefined;
  if (style.atmosphere === "stars") return stars(style, density);
  if (style.atmosphere === "petals") return petals(style, density);
  return undefined;
}

/** Fog colour and range for the light and atmosphere topics. */
export function fogFor(style: ResolvedStyle): THREE.Fog {
  const rig = LIGHT_RIGS[style.light];
  const near = style.atmosphere === "mist" ? 6 : 70;
  const far = style.atmosphere === "mist" ? 70 : 260;
  return new THREE.Fog(style.atmosphere === "mist" ? mistColour(rig.fog) : rig.fog, near, far);
}

/** Mist is paler than the light's fog colour. */
function mistColour(fog: string): string {
  return `#${new THREE.Color(fog).lerp(new THREE.Color("#ffffff"), 0.35).getHexString()}`;
}

// Small mesh primitives for the avatar builders. Everything is plain arrays, no three.js, so the
// tools run in Node with no dependencies.

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export interface Part {
  pos: Vec3[];
  nrm: Vec3[];
  uv: Vec2[];
  idx: number[];
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export type Axis = "x" | "y" | "z";
export type Rotation = [Axis, number];

export function rotate(v: Vec3, [axis, a]: Rotation): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (axis === "x") return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
  if (axis === "y") return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}
export const rotateAll = (v: Vec3, rotations: Rotation[] = []): Vec3 =>
  rotations.reduce((o, r) => rotate(o, r), v);

/** The front (+Z) surface of an ellipsoid at (x, y): where to stick a face feature. */
export function frontOf(radii: Vec3, centre: Vec3, x: number, y: number): number {
  const dx = (x - centre[0]) / radii[0];
  const dy = (y - centre[1]) / radii[1];
  return centre[2] + radii[2] * Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
}

/** How many whole texture tiles fit across a surface, so a tiling texture keeps one density. */
export const tiles = (length: number, tile: number) => Math.max(1, Math.round(length / tile));

/**
 * A latitude/longitude ellipsoid around the origin. `stretch` pulls the two halves apart along Y,
 * which makes a capsule.
 */
export function ellipsoid(
  radii: Vec3,
  opts: { segments?: number; rings?: number; stretch?: number; uvRepeat?: Vec2 } = {},
): Part {
  const { segments = 24, rings = 16, stretch = 0, uvRepeat = [1, 1] } = opts;
  const part: Part = { pos: [], nrm: [], uv: [], idx: [] };
  const half = rings / 2;
  const ringList: [lat: number, offset: number, v: number][] = [];
  for (let r = 0; r <= rings; r++) {
    const lat = Math.PI / 2 - (r / rings) * Math.PI;
    const v = r / rings;
    if (stretch > 0 && r === half) {
      // The equator ring is duplicated so each hemisphere keeps its own offset.
      ringList.push([lat, stretch / 2, v], [lat, -stretch / 2, v]);
    } else {
      ringList.push([lat, stretch === 0 ? 0 : r < half ? stretch / 2 : -stretch / 2, v]);
    }
  }
  for (const [lat, offset, v] of ringList) {
    for (let s = 0; s <= segments; s++) {
      const lon = (s / segments) * Math.PI * 2;
      const u: Vec3 = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
      part.pos.push([u[0] * radii[0], u[1] * radii[1] + offset, u[2] * radii[2]]);
      part.nrm.push(normalize([u[0] / radii[0], u[1] / radii[1], u[2] / radii[2]]));
      part.uv.push([(s / segments) * uvRepeat[0], v * uvRepeat[1]]);
    }
  }
  grid(part, ringList.length, segments);
  return part;
}

/** Index a (rows × (segments+1)) vertex grid into triangles, wound counter-clockwise from outside. */
function grid(part: Part, rows: number, segments: number, base = 0) {
  const row = segments + 1;
  for (let r = 0; r < rows - 1; r++) {
    for (let s = 0; s < segments; s++) {
      const a = base + r * row + s;
      const b = a + row;
      part.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
}

/**
 * A patch of an ellipsoid's surface, pushed out by `lift` along the normal: a decal that follows the
 * body exactly (a belly, a face plate) without the jagged seam two intersecting shapes make.
 * The patch is centred on the +Z direction and spans ±`halfAngles` (longitude, latitude) radians.
 */
export function patch(
  radii: Vec3,
  halfAngles: Vec2,
  opts: { latCentre?: number; lift?: number; rings?: number; segments?: number } = {},
): Part {
  const { latCentre = 0, lift = 0.004, rings = 10, segments = 24 } = opts;
  const part: Part = { pos: [], nrm: [], uv: [], idx: [] };
  for (let r = 0; r <= rings; r++) {
    for (let s = 0; s <= segments; s++) {
      const phi = (s / segments) * Math.PI * 2;
      const t = r / rings;
      const lon = Math.sin(phi) * halfAngles[0] * t;
      const lat = latCentre + Math.cos(phi) * halfAngles[1] * t;
      const u: Vec3 = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
      const n = normalize([u[0] / radii[0], u[1] / radii[1], u[2] / radii[2]]);
      part.pos.push(add([u[0] * radii[0], u[1] * radii[1], u[2] * radii[2]], scale(n, lift)));
      part.nrm.push(n);
      part.uv.push([0.5 + Math.sin(phi) * t * 0.5, 0.5 + Math.cos(phi) * t * 0.5]);
    }
  }
  // Rings grow outward from the centre; flip the winding so faces point out.
  const row = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * row + s;
      const b = a + row;
      part.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return part;
}

/** An axis-aligned box with flat faces (24 vertices). */
export function box(size: Vec3, uvRepeat: Vec2 = [1, 1]): Part {
  const part: Part = { pos: [], nrm: [], uv: [], idx: [] };
  const h = scale(size, 0.5);
  const faces: [Vec3, Vec3, Vec3][] = [
    [
      [1, 0, 0],
      [0, 0, -1],
      [0, 1, 0],
    ],
    [
      [-1, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
    ],
    [
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, -1],
    ],
    [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, -1],
      [-1, 0, 0],
      [0, 1, 0],
    ],
  ];
  for (const [n, u, v] of faces) {
    const base = part.pos.length;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const p: Vec3 = [0, 1, 2].map(
        (k) => (n[k]! + u[k]! * su + v[k]! * sv) * h[k]!,
      ) as unknown as Vec3;
      part.pos.push(p);
      part.nrm.push(n);
      part.uv.push([((su + 1) / 2) * uvRepeat[0], ((1 - sv) / 2) * uvRepeat[1]]);
    }
    part.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return part;
}

/** A cone along +Y from a base circle at y=0 to a tip at y=height, with a closed base. */
export function cone(radius: number, height: number, segments = 16, rings = 4): Part {
  const part: Part = { pos: [], nrm: [], uv: [], idx: [] };
  const slope = radius / height;
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const rr = radius * (1 - t);
      part.pos.push([Math.sin(a) * rr, height * t, Math.cos(a) * rr]);
      part.nrm.push(normalize([Math.sin(a), slope, Math.cos(a)]));
      part.uv.push([s / segments, 1 - t]);
    }
  }
  // Rows go upward; flip winding relative to the ellipsoid grid (which goes downward).
  const row = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * row + s;
      const b = a + row;
      part.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const centre = part.pos.length;
  part.pos.push([0, 0, 0]);
  part.nrm.push([0, -1, 0]);
  part.uv.push([0.5, 0.5]);
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    part.pos.push([Math.sin(a) * radius, 0, Math.cos(a) * radius]);
    part.nrm.push([0, -1, 0]);
    part.uv.push([0.5 + Math.sin(a) * 0.5, 0.5 + Math.cos(a) * 0.5]);
  }
  for (let s = 0; s < segments; s++) part.idx.push(centre, centre + 2 + s, centre + 1 + s);
  return part;
}

/** A ring around the Y axis. */
export function torus(major: number, minor: number, segments = 24, sides = 10): Part {
  const part: Part = { pos: [], nrm: [], uv: [], idx: [] };
  for (let i = 0; i <= sides; i++) {
    const v = (i / sides) * Math.PI * 2;
    for (let s = 0; s <= segments; s++) {
      const u = (s / segments) * Math.PI * 2;
      const n: Vec3 = [Math.cos(v) * Math.sin(u), Math.sin(v), Math.cos(v) * Math.cos(u)];
      part.pos.push([
        (major + minor * Math.cos(v)) * Math.sin(u),
        minor * Math.sin(v),
        (major + minor * Math.cos(v)) * Math.cos(u),
      ]);
      part.nrm.push(n);
      part.uv.push([s / segments, i / sides]);
    }
  }
  const row = segments + 1;
  for (let i = 0; i < sides; i++) {
    for (let s = 0; s < segments; s++) {
      const a = i * row + s;
      const b = a + row;
      part.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return part;
}

/** Scale (non-uniform), then rotate in order, then translate. Normals follow correctly. */
export function transform(part: Part, f: { scale?: Vec3; rotate?: Rotation[]; at?: Vec3 }): Part {
  const s = f.scale ?? [1, 1, 1];
  const at = f.at ?? [0, 0, 0];
  return {
    pos: part.pos.map((p) => add(rotateAll([p[0] * s[0], p[1] * s[1], p[2] * s[2]], f.rotate), at)),
    nrm: part.nrm.map((n) =>
      rotateAll(normalize([n[0] / s[0], n[1] / s[1], n[2] / s[2]]), f.rotate),
    ),
    uv: part.uv,
    idx: part.idx,
  };
}

/** Low-poly look: every triangle gets its own vertices and a face normal. */
export function flatShade(part: Part): Part {
  const out: Part = { pos: [], nrm: [], uv: [], idx: [] };
  for (let i = 0; i < part.idx.length; i += 3) {
    const [a, b, c] = [part.idx[i]!, part.idx[i + 1]!, part.idx[i + 2]!];
    const [pa, pb, pc] = [part.pos[a]!, part.pos[b]!, part.pos[c]!];
    const n = cross(sub(pb, pa), sub(pc, pa));
    // Degenerate triangles (at the poles) have no area: drop them.
    if (Math.hypot(...n) < 1e-12) continue;
    const nn = normalize(n);
    for (const k of [a, b, c]) {
      out.idx.push(out.pos.length);
      out.pos.push(part.pos[k]!);
      out.nrm.push(nn);
      out.uv.push(part.uv[k]!);
    }
  }
  return out;
}

/** Deterministic random numbers, so rebuilding an avatar gives the same bytes. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

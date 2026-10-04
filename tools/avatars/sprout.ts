// Builds content/avatars/sprout.vrm: a cartoon sprout creature as a VRM 1.0 avatar, made entirely
// in code (no outside assets, no licence questions). Run with `pnpm avatar:sprout`.
//
// What the file carries:
// - a VRM humanoid skeleton in T-pose facing +Z (bone rotations are identity, as VRM 1.0 wants);
// - smooth-skinned body, MToon toon materials with outlines (plain PBR colours as fallback);
// - every preset expression (blink, emotions, visemes) as morph targets on the face;
// - bone look-at driving the eyes, and a spring-bone leaf on the head.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Vec3 = [number, number, number];
type Weights = [number, number][]; // [bone index, weight]

// ---------------------------------------------------------------------------------------------
// Skeleton (world positions in metres; the character's left is +X)

const boneDefs: [name: string, parent: string | null, position: Vec3][] = [
  ["Root", null, [0, 0, 0]],
  ["Hips", "Root", [0, 0.56, 0]],
  ["Spine", "Hips", [0, 0.66, 0]],
  ["Chest", "Spine", [0, 0.8, 0]],
  ["Neck", "Chest", [0, 0.9, 0]],
  ["Head", "Neck", [0, 0.94, 0]],
  ["LeftEye", "Head", [0.11, 1.19, 0.12]],
  ["RightEye", "Head", [-0.11, 1.19, 0.12]],
  ["Leaf0", "Head", [0, 1.42, 0]],
  ["Leaf1", "Leaf0", [0, 1.52, 0]],
  ["Leaf2", "Leaf1", [0, 1.64, 0]],
  ["LeftUpperLeg", "Hips", [0.12, 0.52, 0]],
  ["LeftLowerLeg", "LeftUpperLeg", [0.12, 0.3, 0]],
  ["LeftFoot", "LeftLowerLeg", [0.12, 0.09, 0]],
  ["RightUpperLeg", "Hips", [-0.12, 0.52, 0]],
  ["RightLowerLeg", "RightUpperLeg", [-0.12, 0.3, 0]],
  ["RightFoot", "RightLowerLeg", [-0.12, 0.09, 0]],
  ["LeftShoulder", "Chest", [0.1, 0.84, 0]],
  ["LeftUpperArm", "LeftShoulder", [0.22, 0.84, 0]],
  ["LeftLowerArm", "LeftUpperArm", [0.38, 0.84, 0]],
  ["LeftHand", "LeftLowerArm", [0.52, 0.84, 0]],
  ["RightShoulder", "Chest", [-0.1, 0.84, 0]],
  ["RightUpperArm", "RightShoulder", [-0.22, 0.84, 0]],
  ["RightLowerArm", "RightUpperArm", [-0.38, 0.84, 0]],
  ["RightHand", "RightLowerArm", [-0.52, 0.84, 0]],
];
const boneIndex = new Map(boneDefs.map(([name], i) => [name, i]));
const bone = (name: string): number => boneIndex.get(name)!;

// VRM humanoid bone name → our bone name.
const humanBones: Record<string, string> = {
  hips: "Hips",
  spine: "Spine",
  chest: "Chest",
  neck: "Neck",
  head: "Head",
  leftEye: "LeftEye",
  rightEye: "RightEye",
  leftUpperLeg: "LeftUpperLeg",
  leftLowerLeg: "LeftLowerLeg",
  leftFoot: "LeftFoot",
  rightUpperLeg: "RightUpperLeg",
  rightLowerLeg: "RightLowerLeg",
  rightFoot: "RightFoot",
  leftShoulder: "LeftShoulder",
  leftUpperArm: "LeftUpperArm",
  leftLowerArm: "LeftLowerArm",
  leftHand: "LeftHand",
  rightShoulder: "RightShoulder",
  rightUpperArm: "RightUpperArm",
  rightLowerArm: "RightLowerArm",
  rightHand: "RightHand",
};

// ---------------------------------------------------------------------------------------------
// Geometry

interface Part {
  pos: Vec3[];
  nrm: Vec3[];
  idx: number[];
}

const rotY = (v: Vec3, a: number): Vec3 => [
  v[0] * Math.cos(a) + v[2] * Math.sin(a),
  v[1],
  -v[0] * Math.sin(a) + v[2] * Math.cos(a),
];
const rotZ = (v: Vec3, a: number): Vec3 => [
  v[0] * Math.cos(a) - v[1] * Math.sin(a),
  v[0] * Math.sin(a) + v[1] * Math.cos(a),
  v[2],
];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const normalize = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** A latitude/longitude ellipsoid around the origin; `stretch` pulls the halves apart (a capsule). */
function ellipsoid(radii: Vec3, segments = 24, rings = 16, stretch = 0): Part {
  const part: Part = { pos: [], nrm: [], idx: [] };
  const half = rings / 2;
  // With stretch the equator ring is duplicated so each hemisphere keeps its own offset.
  const ringList: [lat: number, offset: number][] = [];
  for (let r = 0; r <= rings; r++) {
    const lat = Math.PI / 2 - (r / rings) * Math.PI;
    if (stretch > 0 && r === half) {
      ringList.push([lat, stretch / 2], [lat, -stretch / 2]);
    } else {
      ringList.push([lat, stretch === 0 ? 0 : r < half ? stretch / 2 : -stretch / 2]);
    }
  }
  for (const [lat, offset] of ringList) {
    for (let s = 0; s <= segments; s++) {
      const lon = (s / segments) * Math.PI * 2;
      const u: Vec3 = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
      part.pos.push([u[0] * radii[0], u[1] * radii[1] + offset, u[2] * radii[2]]);
      part.nrm.push(normalize([u[0] / radii[0], u[1] / radii[1], u[2] / radii[2]]));
    }
  }
  const row = segments + 1;
  for (let r = 0; r < ringList.length - 1; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * row + s;
      const b = a + row;
      part.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return part;
}

function transform(part: Part, f: { rotZ?: number; rotY?: number; swapXY?: boolean; at: Vec3 }) {
  const map = (v: Vec3, translate: boolean): Vec3 => {
    let o: Vec3 = f.swapXY ? [v[1], -v[0], v[2]] : v;
    if (f.rotZ) o = rotZ(o, f.rotZ);
    if (f.rotY) o = rotY(o, f.rotY);
    return translate ? add(o, f.at) : o;
  };
  return {
    pos: part.pos.map((v) => map(v, true)),
    nrm: part.nrm.map((v) => map(v, false)),
    idx: part.idx,
  };
}

/** Linear blend between bones placed along one axis value (y for the body, x for arms). */
function along(value: number, anchors: [at: number, bone: string][]): Weights {
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (value <= first[0]) return [[bone(first[1]), 1]];
  if (value >= last[0]) return [[bone(last[1]), 1]];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [a, boneA] = anchors[i]!;
    const [b, boneB] = anchors[i + 1]!;
    if (value <= b) {
      const t = (value - a) / (b - a);
      const s = t * t * (3 - 2 * t);
      if (boneA === boneB) return [[bone(boneA), 1]];
      return [
        [bone(boneA), 1 - s],
        [bone(boneB), s],
      ];
    }
  }
  return [[bone(last[1]), 1]];
}

// ---------------------------------------------------------------------------------------------
// Materials (colours are sRGB hex; glTF wants linear)

const linear = (hex: string): Vec3 => {
  const c = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [c(0), c(1), c(2)];
};

interface MaterialDef {
  name: string;
  color: string;
  shade: string;
  outline: boolean;
}
const materials: MaterialDef[] = [
  { name: "Body", color: "#7fd36e", shade: "#4e9e57", outline: true },
  { name: "Belly", color: "#fff4d8", shade: "#e3c99c", outline: false },
  { name: "Leaf", color: "#3fbf5a", shade: "#25823d", outline: true },
  { name: "Cheek", color: "#ff9fb4", shade: "#f08aa2", outline: false },
  { name: "Eye", color: "#1f2431", shade: "#151821", outline: false },
  { name: "EyeHighlight", color: "#ffffff", shade: "#ffffff", outline: false },
  { name: "Mouth", color: "#6e2433", shade: "#561b28", outline: false },
];
const mat = (name: string) => materials.findIndex((m) => m.name === name);

// ---------------------------------------------------------------------------------------------
// Body mesh (no morph targets)

interface Primitive {
  material: number;
  pos: Vec3[];
  nrm: Vec3[];
  idx: number[];
  weights: Weights[];
  targets?: Vec3[][];
}

const bodyPrims = new Map<number, Primitive>();
function addBody(material: string, part: Part, weigh: (p: Vec3) => Weights) {
  const m = mat(material);
  let prim = bodyPrims.get(m);
  if (!prim) bodyPrims.set(m, (prim = { material: m, pos: [], nrm: [], idx: [], weights: [] }));
  const base = prim.pos.length;
  prim.pos.push(...part.pos);
  prim.nrm.push(...part.nrm);
  prim.weights.push(...part.pos.map(weigh));
  prim.idx.push(...part.idx.map((i) => i + base));
}

const torsoWeights = (p: Vec3) =>
  along(p[1], [
    [0.58, "Hips"],
    [0.7, "Spine"],
    [0.86, "Chest"],
  ]);
addBody(
  "Body",
  transform(ellipsoid([0.25, 0.27, 0.22], 40, 32), { at: [0, 0.72, 0] }),
  torsoWeights,
);
addBody(
  "Belly",
  transform(ellipsoid([0.17, 0.19, 0.1], 40, 28), { at: [0, 0.68, 0.135] }),
  torsoWeights,
);
addBody("Body", transform(ellipsoid([0.31, 0.28, 0.28], 32, 24), { at: [0, 1.15, 0] }), () => [
  [bone("Head"), 1],
]);

for (const side of [1, -1]) {
  const L = side === 1 ? "Left" : "Right";
  // Arm: one capsule along X, bending smoothly at the elbow.
  addBody(
    "Body",
    transform(ellipsoid([0.065, 0.065, 0.065], 16, 12, 0.3), {
      swapXY: true,
      at: [side * 0.34, 0.84, 0],
    }),
    (p) =>
      along(Math.abs(p[0]), [
        [0.18, `${L}Shoulder`],
        [0.24, `${L}UpperArm`],
        [0.33, `${L}UpperArm`],
        [0.42, `${L}LowerArm`],
      ]),
  );
  addBody(
    "Body",
    transform(ellipsoid([0.085, 0.08, 0.08], 16, 12), { at: [side * 0.55, 0.84, 0] }),
    () => [[bone(`${L}Hand`), 1]],
  );
  // Leg: one capsule along Y, bending at the knee.
  addBody(
    "Body",
    transform(ellipsoid([0.085, 0.085, 0.085], 16, 12, 0.3), { at: [side * 0.12, 0.31, 0] }),
    (p) =>
      along(p[1], [
        [0.26, `${L}LowerLeg`],
        [0.36, `${L}UpperLeg`],
        [0.52, `${L}UpperLeg`],
        [0.6, "Hips"],
      ]),
  );
  addBody(
    "Body",
    transform(ellipsoid([0.1, 0.065, 0.14], 16, 12), { at: [side * 0.12, 0.065, 0.04] }),
    () => [[bone(`${L}Foot`), 1]],
  );
  // Rosy cheeks, turned to sit on the curve of the face.
  addBody(
    "Cheek",
    transform(ellipsoid([0.05, 0.03, 0.02], 16, 10), {
      rotY: side * 0.65,
      at: [side * 0.19, 1.08, 0.205],
    }),
    () => [[bone("Head"), 1]],
  );
}

// The sprout: a stem and two leaves, weighted along the spring-bone chain so they sway.
const leafWeights = (p: Vec3) =>
  along(p[1], [
    [1.44, "Leaf0"],
    [1.56, "Leaf1"],
  ]);
addBody(
  "Leaf",
  transform(ellipsoid([0.02, 0.02, 0.02], 10, 8, 0.12), { at: [0, 1.48, 0] }),
  leafWeights,
);
for (const side of [1, -1]) {
  addBody(
    "Leaf",
    transform(ellipsoid([0.1, 0.022, 0.055], 20, 12), {
      rotZ: side * 0.5,
      at: [side * 0.075, 1.6, 0],
    }),
    leafWeights,
  );
}

// ---------------------------------------------------------------------------------------------
// Face mesh: eyes and mouth, with one morph target per expression.

const expressionNames = [
  "blink",
  "blinkLeft",
  "blinkRight",
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
] as const;
type Expression = (typeof expressionNames)[number];

/** Each feature is built in its own local space; an expression maps local positions to new ones. */
type Shape = (p: Vec3, expression: Expression) => Vec3;

const facePrims = new Map<number, Primitive>();
function addFeature(
  material: string,
  part: Part,
  place: { at: Vec3; rotY: number },
  weights: Weights,
  shape: Shape,
) {
  const m = mat(material);
  let prim = facePrims.get(m);
  if (!prim) {
    prim = {
      material: m,
      pos: [],
      nrm: [],
      idx: [],
      weights: [],
      targets: expressionNames.map(() => []),
    };
    facePrims.set(m, prim);
  }
  const base = prim.pos.length;
  const placed = transform(part, place);
  prim.pos.push(...placed.pos);
  prim.nrm.push(...placed.nrm);
  prim.idx.push(...part.idx.map((i) => i + base));
  for (const _ of part.pos) prim.weights.push(weights);
  expressionNames.forEach((e, t) => {
    for (const p of part.pos) prim.targets![t]!.push(rotY(sub(shape(p, e), p), place.rotY));
  });
}

const eyeShape =
  (side: number, highlight: boolean): Shape =>
  ([x, y, z], e) => {
    const closed = (to: number): Vec3 =>
      highlight ? [x * 0.05, -0.02 + y * 0.05, z * 0.05] : [x, y * to - 0.02, z * 0.9];
    switch (e) {
      case "blink":
        return closed(0.12);
      case "blinkLeft":
        return side === 1 ? closed(0.12) : [x, y, z];
      case "blinkRight":
        return side === -1 ? closed(0.12) : [x, y, z];
      case "happy": // ∩-shaped smiling eyes
        return highlight
          ? [x * 0.05, y * 0.05, z * 0.05]
          : [x, y * 0.3 + 0.012 - 9 * x * x, z * 0.9];
      case "relaxed":
        return highlight ? [x * 0.05, -0.015, z * 0.05] : [x, y * 0.35 - 0.015, z * 0.9];
      case "sad": // inner corners raised
        return [x, y * 0.75 - side * x * 0.45 - 0.008, z];
      case "angry": // inner corners lowered
        return [x, y * 0.6 + side * x * 0.6 - 0.006, z];
      case "surprised":
        return [x * 1.2, y * 1.2, z];
      default:
        return [x, y, z];
    }
  };

// The mouth sits on the curved face, so when it stretches it follows the curvature (z ≈ −(x²+y²)/2R).
const curve = 1 / (2 * 0.28);
const mouthShape: Shape = ([x, y, z], e) => {
  const to = (sx: number, sy: number, dy = 0, bend = 0): Vec3 => {
    const nx = x * sx;
    const ny = y * sy + dy + bend * nx * nx;
    return [nx, ny, z - curve * (nx * nx - x * x + ny * ny - y * y)];
  };
  switch (e) {
    case "happy":
      return to(1.3, 1.5, -0.006, 12);
    case "relaxed":
      return to(1.1, 1.1, -0.002, 6);
    case "sad":
      return to(1.0, 1.2, 0.008, -12);
    case "angry":
      return to(0.85, 1.1, 0.004, -7);
    case "surprised":
      return to(0.65, 2.8, -0.01);
    case "aa":
      return to(1.15, 3.0, -0.015);
    case "ih":
      return to(1.25, 1.7, -0.004);
    case "ou":
      return to(0.55, 2.0, -0.006);
    case "ee":
      return to(1.45, 1.5, -0.004);
    case "oh":
      return to(0.8, 2.7, -0.012);
    default:
      return [x, y, z];
  }
};

for (const side of [1, -1]) {
  const eyeBone = bone(side === 1 ? "LeftEye" : "RightEye");
  const place = { at: [side * 0.11, 1.19, 0.25] as Vec3, rotY: side * 0.35 };
  addFeature(
    "Eye",
    ellipsoid([0.055, 0.075, 0.035], 24, 16),
    place,
    [[eyeBone, 1]],
    eyeShape(side, false),
  );
  const glint = transform(ellipsoid([0.017, 0.017, 0.01], 12, 8), { at: [0.015, 0.028, 0.032] });
  addFeature("EyeHighlight", glint, place, [[eyeBone, 1]], eyeShape(side, true));
}
addFeature(
  "Mouth",
  ellipsoid([0.045, 0.016, 0.03], 24, 12),
  { at: [0, 1.06, 0.25], rotY: 0 },
  [[bone("Head"), 1]],
  mouthShape,
);

// ---------------------------------------------------------------------------------------------
// glTF / VRM writer

const chunks: Buffer[] = [];
let byteLength = 0;
const bufferViews: object[] = [];
const accessors: object[] = [];

function pushView(data: Buffer, target?: number): number {
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    byteLength += pad;
  }
  bufferViews.push({
    buffer: 0,
    byteOffset: byteLength,
    byteLength: data.length,
    ...(target ? { target } : {}),
  });
  chunks.push(data);
  byteLength += data.length;
  return bufferViews.length - 1;
}

const FLOAT = 5126;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

function vec3Accessor(values: Vec3[]): number {
  const data = Buffer.alloc(values.length * 12);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  values.forEach((v, i) =>
    v.forEach((c, k) => {
      const f = Math.fround(c);
      data.writeFloatLE(f, i * 12 + k * 4);
      min[k] = Math.min(min[k]!, f);
      max[k] = Math.max(max[k]!, f);
    }),
  );
  accessors.push({
    bufferView: pushView(data, ARRAY_BUFFER),
    componentType: FLOAT,
    count: values.length,
    type: "VEC3",
    min,
    max,
  });
  return accessors.length - 1;
}

function skinAccessors(weights: Weights[]): { joints: number; weights: number } {
  const j = Buffer.alloc(weights.length * 4);
  const w = Buffer.alloc(weights.length * 16);
  weights.forEach((list, i) => {
    const total = list.reduce((s, [, x]) => s + x, 0);
    list.slice(0, 4).forEach(([b, x], k) => {
      j.writeUInt8(b, i * 4 + k);
      w.writeFloatLE(x / total, i * 16 + k * 4);
    });
  });
  accessors.push({
    bufferView: pushView(j, ARRAY_BUFFER),
    componentType: UNSIGNED_BYTE,
    count: weights.length,
    type: "VEC4",
  });
  const joints = accessors.length - 1;
  accessors.push({
    bufferView: pushView(w, ARRAY_BUFFER),
    componentType: FLOAT,
    count: weights.length,
    type: "VEC4",
  });
  return { joints, weights: accessors.length - 1 };
}

function indexAccessor(idx: number[]): number {
  if (Math.max(...idx) > 65535) throw new Error("primitive too large for 16-bit indices");
  const data = Buffer.alloc(idx.length * 2);
  idx.forEach((v, i) => data.writeUInt16LE(v, i * 2));
  accessors.push({
    bufferView: pushView(data, ELEMENT_ARRAY_BUFFER),
    componentType: UNSIGNED_SHORT,
    count: idx.length,
    type: "SCALAR",
  });
  return accessors.length - 1;
}

function primitiveJson(p: Primitive) {
  const skin = skinAccessors(p.weights);
  return {
    attributes: {
      POSITION: vec3Accessor(p.pos),
      NORMAL: vec3Accessor(p.nrm),
      JOINTS_0: skin.joints,
      WEIGHTS_0: skin.weights,
    },
    indices: indexAccessor(p.idx),
    material: p.material,
    mode: 4,
    ...(p.targets ? { targets: p.targets.map((t) => ({ POSITION: vec3Accessor(t) })) } : {}),
  };
}

// Nodes: bones first (so node index == bone index), then the two mesh nodes.
const nodes: Record<string, unknown>[] = boneDefs.map(([name, parent, position]) => {
  const parentPos = parent ? boneDefs[bone(parent)]![2] : ([0, 0, 0] as Vec3);
  const children = boneDefs.flatMap(([, p], i) => (p === name ? [i] : []));
  return {
    name,
    translation: sub(position, parentPos).map((v) => Math.round(v * 1e6) / 1e6),
    ...(children.length ? { children } : {}),
  };
});
const bodyNode = nodes.length;
nodes.push({ name: "Body", mesh: 0, skin: 0 });
const faceNode = nodes.length;
nodes.push({ name: "Face", mesh: 1, skin: 0 });

const meshes = [
  { name: "Body", primitives: [...bodyPrims.values()].map(primitiveJson) },
  {
    name: "Face",
    primitives: [...facePrims.values()].map(primitiveJson),
    weights: expressionNames.map(() => 0),
    extras: { targetNames: [...expressionNames] },
  },
];

// Bones have no rotation, so each inverse bind matrix is just a translation by −position.
const ibm = Buffer.alloc(boneDefs.length * 64);
boneDefs.forEach(([, , [x, y, z]], i) => {
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1];
  m.forEach((v, k) => ibm.writeFloatLE(v, i * 64 + k * 4));
});
accessors.push({
  bufferView: pushView(ibm),
  componentType: FLOAT,
  count: boneDefs.length,
  type: "MAT4",
});
const skins = [
  {
    name: "Armature",
    inverseBindMatrices: accessors.length - 1,
    joints: boneDefs.map((_, i) => i),
    skeleton: 0,
  },
];

const materialsJson = materials.map((m) => {
  const [r, g, b] = linear(m.color);
  const outline = linear("#24452b");
  return {
    name: m.name,
    pbrMetallicRoughness: { baseColorFactor: [r, g, b, 1], metallicFactor: 0, roughnessFactor: 1 },
    extensions: {
      VRMC_materials_mtoon: {
        specVersion: "1.0",
        transparentWithZWrite: false,
        renderQueueOffsetNumber: 0,
        shadeColorFactor: linear(m.shade),
        shadingShiftFactor: -0.05,
        shadingToonyFactor: 0.92,
        giEqualizationFactor: 0.9,
        matcapFactor: [0, 0, 0],
        parametricRimColorFactor: [0, 0, 0],
        parametricRimFresnelPowerFactor: 5,
        parametricRimLiftFactor: 0,
        rimLightingMixFactor: 1,
        outlineWidthMode: m.outline ? "worldCoordinates" : "none",
        outlineWidthFactor: m.outline ? 0.006 : 0,
        outlineColorFactor: outline,
        outlineLightingMixFactor: 1,
      },
    },
  };
});

const bind = (expression: Expression) => ({
  morphTargetBinds: [{ node: faceNode, index: expressionNames.indexOf(expression), weight: 1 }],
  isBinary: false,
  overrideBlink: ["happy", "relaxed", "angry", "sad", "surprised"].includes(expression)
    ? "block"
    : "none",
  overrideLookAt: "none",
  overrideMouth: "none",
});
const headPos = boneDefs[bone("Head")]![2];
const eyePos = boneDefs[bone("LeftEye")]![2];

const vrm = {
  specVersion: "1.0",
  meta: {
    name: "Sprout",
    version: "1.0",
    authors: ["SuperWorld"],
    copyrightInformation: "SuperWorld default avatar, generated by tools/avatars/sprout.ts",
    licenseUrl: "https://vrm.dev/licenses/1.0/",
    avatarPermission: "everyone",
    allowExcessivelyViolentUsage: false,
    allowExcessivelySexualUsage: false,
    commercialUsage: "corporation",
    allowPoliticalOrReligiousUsage: false,
    allowAntisocialOrHateUsage: false,
    creditNotation: "unnecessary",
    allowRedistribution: true,
    modification: "allowModificationRedistribution",
  },
  humanoid: {
    humanBones: Object.fromEntries(
      Object.entries(humanBones).map(([k, v]) => [k, { node: bone(v) }]),
    ),
  },
  firstPerson: {
    meshAnnotations: [
      { node: bodyNode, type: "auto" },
      { node: faceNode, type: "thirdPersonOnly" },
    ],
  },
  lookAt: {
    offsetFromHeadBone: [0, eyePos[1] - headPos[1], 0.2],
    type: "bone",
    rangeMapHorizontalInner: { inputMaxValue: 90, outputScale: 12 },
    rangeMapHorizontalOuter: { inputMaxValue: 90, outputScale: 12 },
    rangeMapVerticalDown: { inputMaxValue: 90, outputScale: 10 },
    rangeMapVerticalUp: { inputMaxValue: 90, outputScale: 10 },
  },
  expressions: {
    preset: {
      ...Object.fromEntries(expressionNames.map((e) => [e, bind(e)])),
      neutral: { morphTargetBinds: [], isBinary: false },
    },
  },
};

const springBone = {
  specVersion: "1.0",
  colliders: [
    { node: bone("Head"), shape: { sphere: { offset: [0, 1.15 - headPos[1], 0], radius: 0.24 } } },
  ],
  colliderGroups: [{ name: "Head", colliders: [0] }],
  springs: [
    {
      name: "Leaf",
      joints: ["Leaf0", "Leaf1", "Leaf2"].map((name) => ({
        node: bone(name),
        hitRadius: 0.02,
        stiffness: 1.4,
        gravityPower: 0.15,
        gravityDir: [0, -1, 0],
        dragForce: 0.3,
      })),
      colliderGroups: [0],
    },
  ],
};

const bin = Buffer.concat(chunks);
const gltf = {
  asset: { version: "2.0", generator: "SuperWorld tools/avatars/sprout.ts" },
  extensionsUsed: ["VRMC_vrm", "VRMC_springBone", "VRMC_materials_mtoon"],
  extensions: { VRMC_vrm: vrm, VRMC_springBone: springBone },
  scene: 0,
  scenes: [{ name: "Sprout", nodes: [0, bodyNode, faceNode] }],
  nodes,
  meshes,
  skins,
  materials: materialsJson,
  accessors,
  bufferViews,
  buffers: [{ byteLength: bin.length }],
};

// GLB container: header, JSON chunk (space padded), BIN chunk (zero padded).
const pad4 = (b: Buffer, fill: number) =>
  Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
const json = pad4(Buffer.from(JSON.stringify(gltf)), 0x20);
const binChunk = pad4(bin, 0);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // "glTF"
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + binChunk.length, 8);
const chunkHeader = (length: number, type: number) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(length, 0);
  h.writeUInt32LE(type, 4);
  return h;
};
const glb = Buffer.concat([
  header,
  chunkHeader(json.length, 0x4e4f534a), // "JSON"
  json,
  chunkHeader(binChunk.length, 0x004e4942), // "BIN\0"
  binChunk,
]);

const out = join(import.meta.dirname, "..", "..", "content", "avatars", "sprout.vrm");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, glb);
const triangles = [...bodyPrims.values(), ...facePrims.values()].reduce(
  (n, p) => n + p.idx.length / 3,
  0,
);
console.log(
  `wrote ${out}: ${(glb.length / 1024).toFixed(0)} KiB, ${triangles} triangles, ${boneDefs.length} bones`,
);

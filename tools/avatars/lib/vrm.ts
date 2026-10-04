// Assembles skinned parts, face morph targets, materials and spring bones into a VRM 1.0 file
// (a glTF binary with the VRMC_vrm, VRMC_springBone and VRMC_materials_mtoon extensions).
import { type Part, type Rotation, rotateAll, sub, type Vec3 } from "./geometry.ts";

export type Weights = [bone: string, weight: number][];

/** Where a face feature sits on the face. */
export interface Place {
  at: Vec3;
  rotate?: Rotation[];
}

/** Every preset expression, in morph-target order. `neutral` is added with no binds. */
export const EXPRESSIONS = [
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
export type Expression = (typeof EXPRESSIONS)[number];

/** Maps a face vertex (in its feature's local space) to where it sits for an expression. */
export type Shape = (p: Vec3, expression: Expression) => Vec3;

export interface MToonMaterial {
  kind: "mtoon";
  name: string;
  colour: string;
  shade: string;
  /** 0 = smooth gradient, 1 = hard two-tone cel shading. */
  toony?: number;
  shift?: number;
  outline?: number;
  outlineColour?: string;
  rim?: { colour: string; power: number; lift: number };
  emissive?: string;
  baseTexture?: Buffer;
  shadeTexture?: Buffer;
  outlineWidthTexture?: Buffer;
  doubleSided?: boolean;
}
export interface PbrMaterial {
  kind: "pbr";
  name: string;
  colour: string;
  metallic: number;
  roughness: number;
  emissive?: string;
  doubleSided?: boolean;
}
export type MaterialSpec = MToonMaterial | PbrMaterial;

export interface SpringSpec {
  name: string;
  joints: string[];
  stiffness: number;
  gravity: number;
  drag: number;
  hitRadius: number;
}

interface Primitive {
  material: number;
  pos: Vec3[];
  nrm: Vec3[];
  uv: [number, number][];
  idx: number[];
  weights: Weights[];
  targets?: Vec3[][];
}

/** VRM humanoid bone name → the builder's bone name, for the bones every avatar here has. */
const HUMAN_BONES = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "leftEye",
  "rightEye",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
] as const;
const boneName = (human: string) => human[0]!.toUpperCase() + human.slice(1);

/** Where the humanoid joints sit, in metres. The character's left is +X, and it faces +Z. */
export interface Proportions {
  hips: number;
  spine: number;
  chest: number;
  neck: number;
  head: number;
  /** Left eye position; the right eye mirrors it. Put it behind the eye so look-at slides the eye. */
  eye: Vec3;
  shoulder: [x: number, y: number];
  /** X of the upper arm, lower arm and hand joints (left side). */
  arm: [upper: number, lower: number, hand: number];
  /** X of the legs and Y of the upper leg, lower leg and foot joints. */
  leg: [x: number, upper: number, lower: number, foot: number];
}

export interface AvatarMeta {
  name: string;
  copyright: string;
}

export class AvatarBuilder {
  private readonly bones: { name: string; parent: string | null; pos: Vec3 }[] = [];
  private readonly materials: MaterialSpec[] = [];
  private readonly bodyPrims = new Map<number, Primitive>();
  private readonly facePrims = new Map<number, Primitive>();
  private readonly springs: SpringSpec[] = [];
  private readonly springColliders: { bone: string; offset: Vec3; radius: number }[] = [];

  constructor(p: Proportions) {
    const [ax, ay] = p.shoulder;
    const [ux, lx, hx] = p.arm;
    const [legX, up, low, foot] = p.leg;
    this.bone("Root", null, [0, 0, 0]);
    this.bone("Hips", "Root", [0, p.hips, 0]);
    this.bone("Spine", "Hips", [0, p.spine, 0]);
    this.bone("Chest", "Spine", [0, p.chest, 0]);
    this.bone("Neck", "Chest", [0, p.neck, 0]);
    this.bone("Head", "Neck", [0, p.head, 0]);
    for (const [side, s] of [
      ["Left", 1],
      ["Right", -1],
    ] as const) {
      this.bone(`${side}Eye`, "Head", [s * p.eye[0], p.eye[1], p.eye[2]]);
      this.bone(`${side}UpperLeg`, "Hips", [s * legX, up, 0]);
      this.bone(`${side}LowerLeg`, `${side}UpperLeg`, [s * legX, low, 0]);
      this.bone(`${side}Foot`, `${side}LowerLeg`, [s * legX, foot, 0]);
      this.bone(`${side}Shoulder`, "Chest", [s * ax, ay, 0]);
      this.bone(`${side}UpperArm`, `${side}Shoulder`, [s * ux, ay, 0]);
      this.bone(`${side}LowerArm`, `${side}UpperArm`, [s * lx, ay, 0]);
      this.bone(`${side}Hand`, `${side}LowerArm`, [s * hx, ay, 0]);
    }
  }

  /** Adds a non-humanoid bone (spring-bone chains for hair, leaves, tails, antennae). */
  bone(name: string, parent: string | null, pos: Vec3): void {
    if (this.bones.some((b) => b.name === name)) throw new Error(`duplicate bone ${name}`);
    if (parent && !this.bones.some((b) => b.name === parent)) throw new Error(`no bone ${parent}`);
    this.bones.push({ name, parent, pos });
  }

  pos(name: string): Vec3 {
    const b = this.bones.find((x) => x.name === name);
    if (!b) throw new Error(`no bone ${name}`);
    return b.pos;
  }

  private index(name: string): number {
    const i = this.bones.findIndex((b) => b.name === name);
    if (i < 0) throw new Error(`no bone ${name}`);
    return i;
  }

  material(spec: MaterialSpec): string {
    this.materials.push(spec);
    return spec.name;
  }

  private materialIndex(name: string): number {
    const i = this.materials.findIndex((m) => m.name === name);
    if (i < 0) throw new Error(`no material ${name}`);
    return i;
  }

  private prim(map: Map<number, Primitive>, material: string, morphs: boolean): Primitive {
    const m = this.materialIndex(material);
    let prim = map.get(m);
    if (!prim) {
      prim = { material: m, pos: [], nrm: [], uv: [], idx: [], weights: [] };
      if (morphs) prim.targets = EXPRESSIONS.map(() => []);
      map.set(m, prim);
    }
    return prim;
  }

  /** Adds a skinned body part; `weigh` gives each vertex its bones. */
  body(material: string, part: Part, weigh: (p: Vec3) => Weights): void {
    const prim = this.prim(this.bodyPrims, material, false);
    const base = prim.pos.length;
    prim.pos.push(...part.pos);
    prim.nrm.push(...part.nrm);
    prim.uv.push(...part.uv);
    prim.weights.push(...part.pos.map(weigh));
    prim.idx.push(...part.idx.map((i) => i + base));
  }

  /**
   * Adds a face feature with a morph target per expression. The part is built around its own
   * origin; `place` puts it on the face, and `shape` says how it moves for each expression.
   */
  feature(material: string, part: Part, place: Place, weights: Weights, shape: Shape): void {
    const prim = this.prim(this.facePrims, material, true);
    const base = prim.pos.length;
    for (let i = 0; i < part.pos.length; i++) {
      const p = part.pos[i]!;
      prim.pos.push(rotateAll(p, place.rotate).map((v, k) => v + place.at[k]!) as Vec3);
      prim.nrm.push(rotateAll(part.nrm[i]!, place.rotate));
      prim.uv.push(part.uv[i]!);
      prim.weights.push(weights);
      EXPRESSIONS.forEach((e, t) => {
        prim.targets![t]!.push(rotateAll(sub(shape(p, e), p), place.rotate));
      });
    }
    prim.idx.push(...part.idx.map((i) => i + base));
  }

  spring(spec: SpringSpec): void {
    this.springs.push(spec);
  }

  /** A sphere the spring bones can't pass through (in the bone's space). */
  collider(bone: string, offset: Vec3, radius: number): void {
    this.springColliders.push({ bone, offset, radius });
  }

  triangles(): number {
    return [...this.bodyPrims.values(), ...this.facePrims.values()].reduce(
      (n, p) => n + p.idx.length / 3,
      0,
    );
  }

  /** Writes the VRM. `extras` lands on the scene (three.js puts it in `scene.userData`). */
  build(meta: AvatarMeta, extras: Record<string, unknown>, thumbnail?: Buffer): Buffer {
    return new GlbWriter().write(this, meta, extras, thumbnail);
  }

  /** @internal for the writer */
  parts() {
    return {
      bones: this.bones,
      materials: this.materials,
      body: [...this.bodyPrims.values()],
      face: [...this.facePrims.values()],
      springs: this.springs,
      colliders: this.springColliders,
      index: (name: string) => this.index(name),
    };
  }
}

/** Smooth blend between bones placed along one coordinate (y for a body, |x| for an arm). */
export function along(value: number, anchors: [at: number, bone: string][]): Weights {
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (value <= first[0]) return [[first[1], 1]];
  if (value >= last[0]) return [[last[1], 1]];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [a, boneA] = anchors[i]!;
    const [b, boneB] = anchors[i + 1]!;
    if (value <= b) {
      if (boneA === boneB) return [[boneA, 1]];
      const t = (value - a) / (b - a);
      const s = t * t * (3 - 2 * t);
      return [
        [boneA, 1 - s],
        [boneB, s],
      ];
    }
  }
  return [[last[1], 1]];
}

export const rigid = (bone: string) => (): Weights => [[bone, 1]];

/** sRGB hex → linear RGB, as glTF colour factors want. */
export function linear(hex: string): Vec3 {
  const c = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [c(0), c(1), c(2)];
}

/** Mixes two sRGB hex colours (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return (
    "#" +
    [0, 1, 2]
      .map((i) =>
        Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

// ---------------------------------------------------------------------------------------------

const FLOAT = 5126;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

class GlbWriter {
  private readonly chunks: Buffer[] = [];
  private byteLength = 0;
  private readonly bufferViews: object[] = [];
  private readonly accessors: object[] = [];
  private readonly images: object[] = [];
  private readonly textures: object[] = [];

  private view(data: Buffer, target?: number): number {
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) {
      this.chunks.push(Buffer.alloc(pad));
      this.byteLength += pad;
    }
    this.bufferViews.push({
      buffer: 0,
      byteOffset: this.byteLength,
      byteLength: data.length,
      ...(target ? { target } : {}),
    });
    this.chunks.push(data);
    this.byteLength += data.length;
    return this.bufferViews.length - 1;
  }

  private accessor(a: object): number {
    this.accessors.push(a);
    return this.accessors.length - 1;
  }

  private floats(values: number[][], type: "VEC2" | "VEC3", minMax: boolean): number {
    const n = type === "VEC2" ? 2 : 3;
    const data = Buffer.alloc(values.length * n * 4);
    const min = Array<number>(n).fill(Infinity);
    const max = Array<number>(n).fill(-Infinity);
    values.forEach((v, i) => {
      for (let k = 0; k < n; k++) {
        const f = Math.fround(v[k]!);
        data.writeFloatLE(f, (i * n + k) * 4);
        min[k] = Math.min(min[k]!, f);
        max[k] = Math.max(max[k]!, f);
      }
    });
    return this.accessor({
      bufferView: this.view(data, ARRAY_BUFFER),
      componentType: FLOAT,
      count: values.length,
      type,
      ...(minMax ? { min, max } : {}),
    });
  }

  private readonly textureOf = new Map<Buffer, number>();

  /** A texture for a PNG; materials that share a PNG share one texture. */
  private image(png: Buffer): number {
    const known = this.textureOf.get(png);
    if (known !== undefined) return known;
    this.images.push({ bufferView: this.view(png), mimeType: "image/png" });
    this.textures.push({ source: this.images.length - 1, sampler: 0 });
    this.textureOf.set(png, this.textures.length - 1);
    return this.textures.length - 1;
  }

  private primitive(p: Primitive, textured: boolean, index: (bone: string) => number) {
    const joints = Buffer.alloc(p.weights.length * 4);
    const weights = Buffer.alloc(p.weights.length * 16);
    p.weights.forEach((list, i) => {
      const merged = new Map<number, number>();
      for (const [bone, w] of list) {
        const b = index(bone);
        merged.set(b, (merged.get(b) ?? 0) + w);
      }
      const entries = [...merged.entries()].filter(([, w]) => w > 0).slice(0, 4);
      const total = entries.reduce((s, [, w]) => s + w, 0);
      entries.forEach(([b, w], k) => {
        joints.writeUInt8(b, i * 4 + k);
        weights.writeFloatLE(w / total, i * 16 + k * 4);
      });
    });
    if (p.pos.length > 65535) throw new Error("primitive too large for 16-bit indices");
    const idx = Buffer.alloc(p.idx.length * 2);
    p.idx.forEach((v, i) => idx.writeUInt16LE(v, i * 2));
    return {
      attributes: {
        POSITION: this.floats(p.pos, "VEC3", true),
        NORMAL: this.floats(p.nrm, "VEC3", false),
        ...(textured ? { TEXCOORD_0: this.floats(p.uv, "VEC2", false) } : {}),
        JOINTS_0: this.accessor({
          bufferView: this.view(joints, ARRAY_BUFFER),
          componentType: UNSIGNED_BYTE,
          count: p.weights.length,
          type: "VEC4",
        }),
        WEIGHTS_0: this.accessor({
          bufferView: this.view(weights, ARRAY_BUFFER),
          componentType: FLOAT,
          count: p.weights.length,
          type: "VEC4",
        }),
      },
      indices: this.accessor({
        bufferView: this.view(idx, ELEMENT_ARRAY_BUFFER),
        componentType: UNSIGNED_SHORT,
        count: p.idx.length,
        type: "SCALAR",
      }),
      material: p.material,
      mode: 4,
      ...(p.targets
        ? { targets: p.targets.map((t) => ({ POSITION: this.floats(t, "VEC3", true) })) }
        : {}),
    };
  }

  private materialJson(m: MaterialSpec) {
    const [r, g, b] = linear(m.colour);
    const emissive = m.emissive ? { emissiveFactor: linear(m.emissive) } : {};
    const side = m.doubleSided ? { doubleSided: true } : {};
    if (m.kind === "pbr") {
      return {
        name: m.name,
        pbrMetallicRoughness: {
          baseColorFactor: [r, g, b, 1],
          metallicFactor: m.metallic,
          roughnessFactor: m.roughness,
        },
        ...emissive,
        ...side,
      };
    }
    const base = m.baseTexture ? { baseColorTexture: { index: this.image(m.baseTexture) } } : {};
    const shadeTex = m.shadeTexture
      ? { shadeMultiplyTexture: { index: this.image(m.shadeTexture) } }
      : {};
    const outlineTex = m.outlineWidthTexture
      ? { outlineWidthMultiplyTexture: { index: this.image(m.outlineWidthTexture) } }
      : {};
    return {
      name: m.name,
      pbrMetallicRoughness: {
        baseColorFactor: [r, g, b, 1],
        metallicFactor: 0,
        roughnessFactor: 1,
        ...base,
      },
      ...emissive,
      ...side,
      extensions: {
        VRMC_materials_mtoon: {
          specVersion: "1.0",
          transparentWithZWrite: false,
          renderQueueOffsetNumber: 0,
          shadeColorFactor: linear(m.shade),
          ...shadeTex,
          shadingShiftFactor: m.shift ?? 0,
          shadingToonyFactor: m.toony ?? 0.9,
          giEqualizationFactor: 0.9,
          matcapFactor: [0, 0, 0],
          parametricRimColorFactor: m.rim ? linear(m.rim.colour) : [0, 0, 0],
          parametricRimFresnelPowerFactor: m.rim?.power ?? 5,
          parametricRimLiftFactor: m.rim?.lift ?? 0,
          rimLightingMixFactor: 1,
          outlineWidthMode: m.outline ? "worldCoordinates" : "none",
          outlineWidthFactor: m.outline ?? 0,
          ...outlineTex,
          outlineColorFactor: linear(m.outlineColour ?? "#000000"),
          outlineLightingMixFactor: 1,
        },
      },
    };
  }

  write(
    builder: AvatarBuilder,
    meta: AvatarMeta,
    extras: Record<string, unknown>,
    thumbnail?: Buffer,
  ): Buffer {
    const { bones, materials, body, face, springs, colliders, index } = builder.parts();
    const textured = (p: Primitive) => {
      const m = materials[p.material]!;
      return m.kind === "mtoon" && !!(m.baseTexture || m.shadeTexture || m.outlineWidthTexture);
    };

    // Nodes: bones first (node index == bone index), then the two mesh nodes.
    const nodes: Record<string, unknown>[] = bones.map(({ name, parent, pos }) => {
      const parentPos = parent ? bones[index(parent)]!.pos : ([0, 0, 0] as Vec3);
      const children = bones.flatMap((b, i) => (b.parent === name ? [i] : []));
      return {
        name,
        translation: sub(pos, parentPos).map((v) => Math.round(v * 1e6) / 1e6),
        ...(children.length ? { children } : {}),
      };
    });
    const bodyNode = nodes.length;
    nodes.push({ name: "Body", mesh: 0, skin: 0 });
    const faceNode = nodes.length;
    nodes.push({ name: "Face", mesh: 1, skin: 0 });

    const meshes = [
      { name: "Body", primitives: body.map((p) => this.primitive(p, textured(p), index)) },
      {
        name: "Face",
        primitives: face.map((p) => this.primitive(p, textured(p), index)),
        weights: EXPRESSIONS.map(() => 0),
        extras: { targetNames: [...EXPRESSIONS] },
      },
    ];

    // Bones carry no rotation, so each inverse bind matrix is a translation by −position.
    const ibm = Buffer.alloc(bones.length * 64);
    bones.forEach(({ pos: [x, y, z] }, i) => {
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1].forEach((v, k) =>
        ibm.writeFloatLE(v, i * 64 + k * 4),
      );
    });
    const skins = [
      {
        name: "Armature",
        inverseBindMatrices: this.accessor({
          bufferView: this.view(ibm),
          componentType: FLOAT,
          count: bones.length,
          type: "MAT4",
        }),
        joints: bones.map((_, i) => i),
        skeleton: 0,
      },
    ];

    const materialsJson = materials.map((m) => this.materialJson(m));
    const thumbnailImage = thumbnail
      ? (() => {
          this.images.push({ bufferView: this.view(thumbnail), mimeType: "image/png" });
          return this.images.length - 1;
        })()
      : undefined;

    const emotions = new Set<Expression>(["happy", "relaxed", "angry", "sad", "surprised"]);
    const head = bones[index("Head")]!.pos;
    const eye = bones[index("LeftEye")]!.pos;
    const vrm = {
      specVersion: "1.0",
      meta: {
        name: meta.name,
        version: "1.0",
        authors: ["SuperWorld"],
        copyrightInformation: meta.copyright,
        licenseUrl: "https://vrm.dev/licenses/1.0/",
        ...(thumbnailImage !== undefined ? { thumbnailImage } : {}),
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
        humanBones: Object.fromEntries(HUMAN_BONES.map((h) => [h, { node: index(boneName(h)) }])),
      },
      firstPerson: {
        meshAnnotations: [
          { node: bodyNode, type: "auto" },
          { node: faceNode, type: "thirdPersonOnly" },
        ],
      },
      lookAt: {
        offsetFromHeadBone: [0, eye[1] - head[1], eye[2] + 0.1],
        type: "bone",
        rangeMapHorizontalInner: { inputMaxValue: 90, outputScale: 12 },
        rangeMapHorizontalOuter: { inputMaxValue: 90, outputScale: 12 },
        rangeMapVerticalDown: { inputMaxValue: 90, outputScale: 10 },
        rangeMapVerticalUp: { inputMaxValue: 90, outputScale: 10 },
      },
      expressions: {
        preset: {
          ...Object.fromEntries(
            EXPRESSIONS.map((e, i) => [
              e,
              {
                morphTargetBinds: [{ node: faceNode, index: i, weight: 1 }],
                isBinary: false,
                // Emotions reshape the eyes, so blinking on top of them would look broken.
                overrideBlink: emotions.has(e) ? "block" : "none",
                overrideLookAt: "none",
                overrideMouth: "none",
              },
            ]),
          ),
          neutral: { morphTargetBinds: [], isBinary: false },
        },
      },
    };

    const springBone = {
      specVersion: "1.0",
      colliders: colliders.map((c) => ({
        node: index(c.bone),
        shape: { sphere: { offset: c.offset, radius: c.radius } },
      })),
      colliderGroups: colliders.length
        ? [{ name: "Body", colliders: colliders.map((_, i) => i) }]
        : [],
      springs: springs.map((s) => ({
        name: s.name,
        joints: s.joints.map((j) => ({
          node: index(j),
          hitRadius: s.hitRadius,
          stiffness: s.stiffness,
          gravityPower: s.gravity,
          gravityDir: [0, -1, 0],
          dragForce: s.drag,
        })),
        ...(colliders.length ? { colliderGroups: [0] } : {}),
      })),
    };

    const usesMToon = materials.some((m) => m.kind === "mtoon");
    const bin = Buffer.concat(this.chunks);
    const gltf = {
      asset: { version: "2.0", generator: "SuperWorld tools/avatars" },
      extensionsUsed: [
        "VRMC_vrm",
        ...(springs.length ? ["VRMC_springBone"] : []),
        ...(usesMToon ? ["VRMC_materials_mtoon"] : []),
      ],
      extensions: { VRMC_vrm: vrm, ...(springs.length ? { VRMC_springBone: springBone } : {}) },
      scene: 0,
      scenes: [{ name: meta.name, nodes: [0, bodyNode, faceNode], extras }],
      nodes,
      meshes,
      skins,
      materials: materialsJson,
      ...(this.images.length ? { images: this.images } : {}),
      ...(this.textures.length
        ? {
            textures: this.textures,
            samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
          }
        : {}),
      accessors: this.accessors,
      bufferViews: this.bufferViews,
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
    return Buffer.concat([
      header,
      chunkHeader(json.length, 0x4e4f534a), // "JSON"
      json,
      chunkHeader(binChunk.length, 0x004e4942), // "BIN\0"
      binChunk,
    ]);
  }
}

// Downloads the avatars in content/avatars/avatars.json that other people made (entries with a
// `source.download`), checks each download against its pinned SHA-256, and applies
//
// the fixes the library lists for it, so the file meets the VRM spec the game relies on:
//
// - "mirrorZ": a VRM 0.x model must face −Z with its left side on −X. Some exporters write the mesh
//   facing +Z while the skeleton is labelled for −Z (left and right swapped). Mirroring along Z
//   makes it face −Z with labels and body agreeing.
// - "tPose": VRM requires a T-pose. Models rigged in an A-pose get their arms raised to horizontal
//   and that pose baked in as the new rest pose (vertices, normals, morph targets, inverse binds).
//
// Run with `pnpm avatars:import`. Everything else in the file (materials, expressions, licence
// metadata) is kept as the author made it.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AvatarLibrary } from "@superworld/schema";

type V3 = [number, number, number];
type M3 = [V3, V3, V3];

const dir = join(import.meta.dirname, "..", "..", "content", "avatars");
const library = AvatarLibrary.parse(JSON.parse(readFileSync(join(dir, "avatars.json"), "utf8")));

// ---------------------------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function repair(file: Buffer, fixes: readonly string[]): { glb: Buffer; notes: string[] } {
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8"));
  const binStart = 20 + jsonLength + 8;
  const bin = Buffer.from(file.subarray(binStart, binStart + file.readUInt32LE(20 + jsonLength)));
  const notes: string[] = [];

  const vrm0 = json.extensions?.VRM;
  if (!vrm0) return { glb: file, notes: ["not VRM 0.x, left as is"] };
  const human = new Map<string, number>(
    vrm0.humanoid.humanBones.map((b: { bone: string; node: number }) => [b.bone, b.node]),
  );
  const nodes: any[] = json.nodes;
  for (const n of nodes) {
    const r = n.rotation ?? [0, 0, 0, 1];
    const s = n.scale ?? [1, 1, 1];
    if (n.matrix || r[0] || r[1] || r[2] || r[3] !== 1 || s.some((v: number) => v !== 1))
      throw new Error(`node "${n.name}" has a rotation or scale; only translations are handled`);
  }
  const parent = new Map<number, number>();
  nodes.forEach((n, i) => (n.children ?? []).forEach((c: number) => parent.set(c, i)));
  const world = (i: number): V3 => {
    const t: V3 = nodes[i].translation ?? [0, 0, 0];
    const p = parent.get(i);
    return p === undefined ? [...t] : add(world(p), t);
  };

  if (fixes.includes("mirrorZ")) {
    mirrorZ(json, bin);
    notes.push("mirrored along Z (the mesh faced +Z but the skeleton was labelled for −Z)");
  }
  if (fixes.includes("tPose")) {
    const a = world(human.get("leftUpperArm")!);
    const b = world(human.get("leftLowerArm")!);
    const droop = Math.atan2(a[1] - b[1], Math.hypot(b[0] - a[0], b[2] - a[2]));
    bakeTPose(json, bin, human, parent, world);
    notes.push(
      `baked a T-pose (the arms rested ${Math.round((droop * 180) / Math.PI)}° below horizontal)`,
    );
  }

  // Positions moved: refresh every position accessor's bounds.
  for (const m of json.meshes) {
    for (const p of m.primitives) {
      for (const idx of [p.attributes.POSITION, ...(p.targets ?? []).map((t: any) => t.POSITION)]) {
        if (idx === undefined) continue;
        const a = accessor(json, bin, idx);
        const min: V3 = [Infinity, Infinity, Infinity];
        const max: V3 = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < a.count; i++) {
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k]!, a.get(i, k));
            max[k] = Math.max(max[k]!, a.get(i, k));
          }
        }
        json.accessors[idx].min = min;
        json.accessors[idx].max = max;
      }
    }
  }
  return { glb: writeGlb(json, bin), notes };
}

/** Mirrors the whole model through the XY plane (z → −z), keeping triangles facing outward. */
function mirrorZ(json: any, bin: Buffer): void {
  for (const n of json.nodes) if (n.translation) n.translation[2] = -n.translation[2];
  const done = new Set<number>();
  const flipZ = (idx: number | undefined) => {
    if (idx === undefined || done.has(idx)) return;
    done.add(idx);
    const a = accessor(json, bin, idx);
    for (let i = 0; i < a.count; i++) a.set(i, 2, -a.get(i, 2));
  };
  for (const m of json.meshes) {
    for (const p of m.primitives) {
      flipZ(p.attributes.POSITION);
      flipZ(p.attributes.NORMAL);
      for (const t of p.targets ?? []) {
        flipZ(t.POSITION);
        flipZ(t.NORMAL);
      }
      if (p.indices !== undefined && !done.has(p.indices)) {
        done.add(p.indices);
        const ix = accessor(json, bin, p.indices);
        for (let i = 0; i + 2 < ix.count; i += 3) {
          const b = ix.get(i + 1, 0);
          ix.set(i + 1, 0, ix.get(i + 2, 0));
          ix.set(i + 2, 0, b);
        }
      }
    }
  }
  // Inverse binds: S·M·S with S = diag(1, 1, −1, 1) negates entries in exactly one of row/column 2.
  for (const skin of json.skins) {
    const a = accessor(json, bin, skin.inverseBindMatrices);
    for (let i = 0; i < a.count; i++) {
      for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
          if ((row === 2) !== (col === 2)) a.set(i, col * 4 + row, -a.get(i, col * 4 + row));
        }
      }
    }
  }
  const offset = json.extensions.VRM.firstPerson?.firstPersonBoneOffset;
  if (offset) offset.z = -offset.z;
}

/**
 * Rotates each upper arm to horizontal and each forearm in line with it, then makes that the rest
 * pose: vertices are skinned into it, bones move to their posed places (still unrotated), and the
 * inverse bind matrices are rebuilt.
 */
function bakeTPose(
  json: any,
  bin: Buffer,
  human: Map<string, number>,
  parent: Map<number, number>,
  world: (i: number) => V3,
): void {
  const nodes: any[] = json.nodes;
  // Each moved node's map: a list of rotations about pivots, applied in order.
  const turns = new Map<number, { pivot: V3; r: M3 }[]>();
  const descendants = (i: number): number[] => [
    i,
    ...(nodes[i].children ?? []).flatMap((c: number) => descendants(c)),
  ];
  const apply = (list: { pivot: V3; r: M3 }[] | undefined, p: V3): V3 =>
    (list ?? []).reduce((q, t) => add(t.pivot, mul(t.r, sub(q, t.pivot))), p);

  for (const side of ["left", "right"] as const) {
    const [upper, lower, hand] = (["UpperArm", "LowerArm", "Hand"] as const).map((b) =>
      human.get(`${side}${b}`)!,
    );
    const target: V3 = [Math.sign(world(lower)[0] - world(upper)[0]), 0, 0];
    const pUpper = world(upper);
    const r1 = between(sub(world(lower), pUpper), target);
    for (const n of descendants(upper)) turns.set(n, [{ pivot: pUpper, r: r1 }]);
    const pLower = apply(turns.get(lower), world(lower));
    const pHand = apply(turns.get(lower), world(hand));
    const r2 = between(sub(pHand, pLower), target);
    for (const n of descendants(lower)) turns.get(n)!.push({ pivot: pLower, r: r2 });
  }
  const rotationOf = (n: number): M3 =>
    (turns.get(n) ?? []).reduce<M3>(
      (m, t) => matmul(t.r, m),
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    );

  // Skin every vertex into the pose, with each joint's map.
  for (const m of json.meshes) {
    for (const p of m.primitives) {
      const skin = json.skins[0];
      const joints = accessor(json, bin, p.attributes.JOINTS_0);
      const weights = accessor(json, bin, p.attributes.WEIGHTS_0);
      const pos = accessor(json, bin, p.attributes.POSITION);
      const nrm =
        p.attributes.NORMAL !== undefined ? accessor(json, bin, p.attributes.NORMAL) : null;
      const targets = (p.targets ?? []).flatMap((t: any) =>
        [t.POSITION, t.NORMAL].filter((x) => x !== undefined).map((x) => accessor(json, bin, x)),
      );
      for (let i = 0; i < pos.count; i++) {
        let v: V3 = [0, 0, 0];
        const r: M3 = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ];
        const rest: V3 = [pos.get(i, 0), pos.get(i, 1), pos.get(i, 2)];
        for (let k = 0; k < 4; k++) {
          const w = weights.get(i, k);
          if (!w) continue;
          const node = skin.joints[joints.get(i, k)];
          v = add(v, scale(apply(turns.get(node), rest), w));
          const jr = rotationOf(node);
          for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) r[a]![b]! += jr[a]![b]! * w;
        }
        for (let k = 0; k < 3; k++) pos.set(i, k, v[k]!);
        if (nrm) {
          const n = normalize(mul(r, [nrm.get(i, 0), nrm.get(i, 1), nrm.get(i, 2)]));
          for (let k = 0; k < 3; k++) nrm.set(i, k, n[k]!);
        }
        for (const t of targets) {
          const d = mul(r, [t.get(i, 0), t.get(i, 1), t.get(i, 2)]);
          for (let k = 0; k < 3; k++) t.set(i, k, d[k]!);
        }
      }
    }
  }

  // Bones move to their posed places, unrotated; inverse binds follow.
  const posed = nodes.map((_, i) => apply(turns.get(i), world(i)));
  nodes.forEach((n, i) => {
    if (!n.translation && !turns.has(i)) return;
    const p = parent.get(i);
    n.translation = round(p === undefined ? posed[i]! : sub(posed[i]!, posed[p]!));
  });
  for (const skin of json.skins) {
    const ibm = accessor(json, bin, skin.inverseBindMatrices);
    skin.joints.forEach((node: number, i: number) => {
      const [x, y, z] = posed[node]!;
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1].forEach((v, k) => ibm.set(i, k, v));
    });
  }
}

// ---------------------------------------------------------------------------------------------

const SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Typed access to one accessor's elements, in place in the binary chunk. */
function accessor(json: any, bin: Buffer, index: number) {
  const a = json.accessors[index];
  if (a.sparse) throw new Error("sparse accessors aren't handled");
  const view = json.bufferViews[a.bufferView];
  const size = SIZE[a.componentType]!;
  const n = COMPONENTS[a.type]!;
  const stride = view.byteStride ?? size * n;
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const at = (i: number, k: number) => base + i * stride + k * size;
  const read: Record<number, (o: number) => number> = {
    5121: (o) => bin.readUInt8(o),
    5123: (o) => bin.readUInt16LE(o),
    5125: (o) => bin.readUInt32LE(o),
    5126: (o) => bin.readFloatLE(o),
  };
  const write: Record<number, (v: number, o: number) => void> = {
    5121: (v, o) => bin.writeUInt8(v, o),
    5123: (v, o) => bin.writeUInt16LE(v, o),
    5125: (v, o) => bin.writeUInt32LE(v, o),
    5126: (v, o) => bin.writeFloatLE(v, o),
  };
  return {
    count: a.count as number,
    get: (i: number, k: number) => read[a.componentType]!(at(i, k)),
    set: (i: number, k: number, v: number) => write[a.componentType]!(v, at(i, k)),
  };
}

function writeGlb(json: any, bin: Buffer): Buffer {
  const pad = (b: Buffer, fill: number) =>
    Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const b = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const chunk = (length: number, type: number) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(length, 0);
    h.writeUInt32LE(type, 4);
    return h;
  };
  return Buffer.concat([header, chunk(j.length, 0x4e4f534a), j, chunk(b.length, 0x004e4942), b]);
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: V3): V3 => scale(a, 1 / (Math.hypot(...a) || 1));
const round = (a: V3): V3 => a.map((v) => Math.round(v * 1e6) / 1e6) as V3;
const mul = (m: M3, v: V3): V3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
const matmul = (a: M3, b: M3): M3 =>
  [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) => a[i]![0] * b[0][j]! + a[i]![1] * b[1][j]! + a[i]![2] * b[2][j]!),
  ) as M3;

/** The rotation turning direction `from` onto direction `to` (Rodrigues). */
function between(from: V3, to: V3): M3 {
  const a = normalize(from);
  const b = normalize(to);
  const axis = cross(a, b);
  const s = Math.hypot(...axis);
  const c = dot(a, b);
  if (s < 1e-9)
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  const [x, y, z] = scale(axis, 1 / s);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

// Runs last, so every helper above is initialised.
for (const avatar of library.avatars) {
  const source = avatar.source;
  if (!source?.download) continue;
  const res = await fetch(source.download);
  if (!res.ok) throw new Error(`${avatar.id}: download failed (${res.status})`);
  const original = Buffer.from(await res.arrayBuffer());
  const sha = createHash("sha256").update(original).digest("hex");
  if (source.sha256 && sha !== source.sha256)
    throw new Error(`${avatar.id}: download changed (sha256 ${sha}, pinned ${source.sha256})`);
  const { glb, notes } = repair(original, source.fixes ?? []);
  writeFileSync(join(dir, avatar.file), glb);
  console.log(`${avatar.file}: ${notes.length ? notes.join("; ") : "no repairs needed"}`);
}

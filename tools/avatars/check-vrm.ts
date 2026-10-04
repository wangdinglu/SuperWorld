// Structural checks on a VRM 1.0 file: what the game relies on when it loads an avatar.
import type { AvatarEntry } from "@superworld/schema";
import { EXPRESSIONS } from "./lib/vrm.ts";

/** Humanoid bones VRM 1.0 requires, plus the ones the game's animation drives. */
const REQUIRED_BONES = [
  "hips",
  "spine",
  "chest",
  "head",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
];

/** Returns the problems found (empty when the file is fine). */
export function checkVrm(glb: Buffer, avatar: AvatarEntry): string[] {
  if (glb.length < 20 || glb.readUInt32LE(0) !== 0x46546c67 || glb.readUInt32LE(4) !== 2)
    return ["not a glTF 2.0 binary"];
  if (glb.readUInt32LE(16) !== 0x4e4f534a) return ["first chunk is not JSON"];
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"));
  const problems: string[] = [];
  const vrm = json.extensions?.VRMC_vrm;
  if (vrm?.specVersion !== "1.0") return ["no VRMC_vrm 1.0 extension"];
  const bones = vrm.humanoid?.humanBones ?? {};
  for (const bone of REQUIRED_BONES) {
    if (typeof bones[bone]?.node !== "number") problems.push(`humanoid bone "${bone}" is missing`);
  }
  const presets = vrm.expressions?.preset ?? {};
  for (const e of EXPRESSIONS) {
    if (!presets[e]) problems.push(`expression "${e}" is missing`);
  }
  if (vrm.meta?.name !== avatar.name)
    problems.push(`is named "${vrm.meta?.name}", the library says "${avatar.name}"`);
  if (vrm.meta?.avatarPermission !== "everyone" || vrm.meta?.allowRedistribution !== true)
    problems.push("licence must let everyone use and redistribute it");
  const recorded = json.scenes?.[json.scene ?? 0]?.extras?.superworld;
  if (recorded?.avatar !== avatar.id) problems.push(`records avatar "${recorded?.avatar}"`);
  for (const topic of ["form", "surface", "colour"] as const) {
    if (recorded?.style?.[topic] !== avatar.style[topic])
      problems.push(
        `records ${topic} "${recorded?.style?.[topic]}", the library says "${avatar.style[topic]}"`,
      );
  }
  if (glb.length > 2 * 1024 * 1024) problems.push("is over the 2 MiB avatar budget");
  return problems;
}

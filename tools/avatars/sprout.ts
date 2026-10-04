// Sprout — smooth form, soft surface, meadow palette: the default avatar, drawn like the plaza.
// Rounded shapes, gentle gradient shading with no outlines, and a leaf that sways on spring bones.
import { ellipsoid, patch, torus, transform, type Vec3 } from "./lib/geometry.ts";
import { eyeShape, mouthShape } from "./lib/face.ts";
import type { Palette } from "./lib/palette.ts";
import { AvatarBuilder, along, mix, type Place, rigid } from "./lib/vrm.ts";

export function build(c: Palette): AvatarBuilder {
  const b = new AvatarBuilder({
    hips: 0.56,
    spine: 0.66,
    chest: 0.8,
    neck: 0.9,
    head: 0.94,
    eye: [0.11, 1.19, 0.12],
    shoulder: [0.1, 0.84],
    arm: [0.22, 0.38, 0.52],
    leg: [0.12, 0.52, 0.3, 0.09],
  });
  b.bone("Leaf0", "Head", [0, 1.42, 0]);
  b.bone("Leaf1", "Leaf0", [0, 1.52, 0]);
  b.bone("Leaf2", "Leaf1", [0, 1.64, 0]);

  // Soft surface: a wide, smooth light-to-shade gradient and a faint sky-coloured rim.
  const soft = (name: string, colour: string, shadeTowards = c.metal) =>
    b.material({
      kind: "mtoon",
      name,
      colour,
      shade: mix(colour, shadeTowards, 0.32),
      toony: 0.35,
      shift: -0.15,
      rim: { colour: mix("#000000", c.light, 0.3), power: 5, lift: 0 },
    });
  const skin = soft("Body", c.leaf);
  const belly = soft("Belly", c.light, c.wood);
  const sprout = soft("Leaf", c.ground, c.leaf);
  const cheek = soft("Cheek", mix(c.base, c.light, 0.35), c.base);
  const accent = soft("Accent", c.accent);
  const eye = soft("Eye", c.metal);
  const glint = soft("EyeHighlight", "#ffffff", "#ffffff");
  const mouth = soft("Mouth", mix(c.wood, c.metal, 0.5));

  const torsoWeights = (p: Vec3) =>
    along(p[1], [
      [0.58, "Hips"],
      [0.7, "Spine"],
      [0.86, "Chest"],
    ]);
  const torso: Vec3 = [0.25, 0.27, 0.22];
  b.body(
    skin,
    transform(ellipsoid(torso, { segments: 28, rings: 20 }), { at: [0, 0.72, 0] }),
    torsoWeights,
  );
  b.body(
    belly,
    transform(patch(torso, [0.75, 0.7], { latCentre: -0.15 }), { at: [0, 0.72, 0] }),
    torsoWeights,
  );
  b.body(
    skin,
    transform(ellipsoid([0.31, 0.28, 0.28], { segments: 28, rings: 20 }), { at: [0, 1.15, 0] }),
    rigid("Head"),
  );
  // A neckerchief in the player's colour.
  b.body(
    accent,
    transform(torus(0.18, 0.04, 24, 8), { scale: [1, 1, 0.92], at: [0, 0.93, 0.01] }),
    (p) =>
      along(p[1], [
        [0.9, "Chest"],
        [0.96, "Neck"],
      ]),
  );

  for (const s of [1, -1]) {
    const L = s === 1 ? "Left" : "Right";
    b.body(
      skin,
      transform(ellipsoid([0.065, 0.065, 0.065], { segments: 12, rings: 10, stretch: 0.3 }), {
        rotate: [["z", Math.PI / 2]],
        at: [s * 0.34, 0.84, 0],
      }),
      (p) =>
        along(Math.abs(p[0]), [
          [0.18, `${L}Shoulder`],
          [0.24, `${L}UpperArm`],
          [0.33, `${L}UpperArm`],
          [0.42, `${L}LowerArm`],
        ]),
    );
    b.body(
      skin,
      transform(ellipsoid([0.085, 0.08, 0.08], { segments: 12, rings: 10 }), {
        at: [s * 0.55, 0.84, 0],
      }),
      rigid(`${L}Hand`),
    );
    b.body(
      skin,
      transform(ellipsoid([0.085, 0.085, 0.085], { segments: 12, rings: 10, stretch: 0.3 }), {
        at: [s * 0.12, 0.31, 0],
      }),
      (p) =>
        along(p[1], [
          [0.26, `${L}LowerLeg`],
          [0.36, `${L}UpperLeg`],
          [0.52, `${L}UpperLeg`],
          [0.6, "Hips"],
        ]),
    );
    b.body(
      skin,
      transform(ellipsoid([0.1, 0.065, 0.14], { segments: 12, rings: 10 }), {
        at: [s * 0.12, 0.065, 0.04],
      }),
      rigid(`${L}Foot`),
    );
    b.body(
      cheek,
      transform(ellipsoid([0.05, 0.03, 0.02], { segments: 12, rings: 8 }), {
        rotate: [["y", s * 0.65]],
        at: [s * 0.19, 1.08, 0.205],
      }),
      rigid("Head"),
    );
  }

  // The sprout: a stem and two leaves, weighted along the spring-bone chain so they sway.
  const leafWeights = (p: Vec3) =>
    along(p[1], [
      [1.44, "Leaf0"],
      [1.56, "Leaf1"],
    ]);
  b.body(
    sprout,
    transform(ellipsoid([0.02, 0.02, 0.02], { segments: 8, rings: 6, stretch: 0.12 }), {
      at: [0, 1.48, 0],
    }),
    leafWeights,
  );
  for (const s of [1, -1]) {
    b.body(
      sprout,
      transform(ellipsoid([0.1, 0.022, 0.055], { segments: 16, rings: 10 }), {
        rotate: [["z", s * 0.5]],
        at: [s * 0.075, 1.6, 0],
      }),
      leafWeights,
    );
  }
  b.spring({
    name: "Leaf",
    joints: ["Leaf0", "Leaf1", "Leaf2"],
    stiffness: 1.4,
    gravity: 0.15,
    drag: 0.3,
    hitRadius: 0.02,
  });
  b.collider("Head", [0, 1.15 - 0.94, 0], 0.24);

  // Face.
  for (const s of [1, -1]) {
    const bone = s === 1 ? "LeftEye" : "RightEye";
    const place: Place = { at: [s * 0.11, 1.19, 0.25], rotate: [["y", s * 0.35]] };
    b.feature(
      eye,
      ellipsoid([0.055, 0.075, 0.035], { segments: 16, rings: 12 }),
      place,
      [[bone, 1]],
      eyeShape(s, 0.055, 0.075, false),
    );
    b.feature(
      glint,
      transform(ellipsoid([0.017, 0.017, 0.01], { segments: 10, rings: 6 }), {
        at: [0.015, 0.028, 0.032],
      }),
      place,
      [[bone, 1]],
      eyeShape(s, 0.055, 0.075, true),
    );
  }
  b.feature(
    mouth,
    ellipsoid([0.045, 0.016, 0.03], { segments: 16, rings: 10 }),
    { at: [0, 1.06, 0.25] },
    [["Head", 1]],
    mouthShape(0.045, 0.28),
  );
  return b;
}

// Pip — low-poly form, toon surface, candy palette: a faceted fox with a bouncy tail.
// Every part is flat-shaded with few segments; the shading is a hard two-tone cel with bold outlines.
import {
  cone,
  ellipsoid,
  flatShade,
  type Part,
  patch,
  torus,
  transform,
  type Vec3,
} from "./lib/geometry.ts";
import { eyeShape, mouthShape } from "./lib/face.ts";
import type { Palette } from "./lib/palette.ts";
import { AvatarBuilder, along, mix, type Place, rigid } from "./lib/vrm.ts";

/** Low-poly: few segments, then faceted. */
const facet = (part: Part) => flatShade(part);
const lowEllipsoid = (radii: Vec3, stretch = 0, segments = 8, rings = 6) =>
  ellipsoid(radii, { segments, rings, stretch });

export function build(c: Palette): AvatarBuilder {
  const b = new AvatarBuilder({
    hips: 0.55,
    spine: 0.64,
    chest: 0.78,
    neck: 0.88,
    head: 0.92,
    eye: [0.1, 1.17, 0.1],
    shoulder: [0.09, 0.82],
    arm: [0.2, 0.34, 0.47],
    leg: [0.11, 0.5, 0.29, 0.09],
  });
  // Tail chain, curling up behind.
  const tail: Vec3[] = [
    [0, 0.52, -0.17],
    [0, 0.6, -0.36],
    [0, 0.76, -0.5],
    [0, 0.95, -0.55],
  ];
  tail.forEach((p, i) => b.bone(`Tail${i}`, i === 0 ? "Hips" : `Tail${i - 1}`, p));

  // Toon surface: hard two-tone shading pushed toward the palette's purple, thick outlines.
  const outline = mix(c.metal, "#000000", 0.55);
  const toon = (name: string, colour: string, outlineWidth = 0.008) =>
    b.material({
      kind: "mtoon",
      name,
      colour,
      shade: mix(colour, c.leaf, 0.45),
      toony: 0.97,
      shift: 0.05,
      outline: outlineWidth,
      outlineColour: outline,
    });
  const fur = toon("Fur", c.base);
  const cream = toon("Cream", c.stone);
  const accent = toon("Accent", c.accent);
  const inner = toon("InnerEar", c.ground, 0);
  const dark = toon("Eye", mix(c.metal, "#000000", 0.5), 0);
  const glint = toon("EyeHighlight", "#ffffff", 0);
  const mouthMat = toon("Mouth", mix(c.base, "#000000", 0.55), 0);

  const torsoWeights = (p: Vec3) =>
    along(p[1], [
      [0.56, "Hips"],
      [0.68, "Spine"],
      [0.82, "Chest"],
    ]);
  const torso: Vec3 = [0.22, 0.25, 0.2];
  b.body(fur, facet(transform(lowEllipsoid(torso, 0, 10, 8), { at: [0, 0.68, 0] })), torsoWeights);
  b.body(
    cream,
    facet(
      transform(
        patch(torso, [0.7, 0.65], { latCentre: -0.1, lift: 0.006, rings: 3, segments: 10 }),
        { at: [0, 0.68, 0] },
      ),
    ),
    torsoWeights,
  );

  // Head with a pointed snout and big triangular ears.
  const head: Vec3 = [0.27, 0.24, 0.25];
  b.body(fur, facet(transform(lowEllipsoid(head, 0, 10, 8), { at: [0, 1.12, 0] })), rigid("Head"));
  b.body(
    cream,
    facet(transform(lowEllipsoid([0.13, 0.085, 0.13], 0, 8, 6), { at: [0, 1.02, 0.17] })),
    rigid("Head"),
  );
  b.body(
    dark,
    facet(transform(lowEllipsoid([0.035, 0.026, 0.025], 0, 6, 4), { at: [0, 1.06, 0.3] })),
    rigid("Head"),
  );
  for (const s of [1, -1]) {
    b.body(
      fur,
      facet(
        transform(cone(0.1, 0.24, 4, 1), {
          rotate: [
            ["y", Math.PI / 4],
            ["z", -s * 0.35],
          ],
          at: [s * 0.15, 1.27, -0.02],
        }),
      ),
      rigid("Head"),
    );
    b.body(
      inner,
      facet(
        transform(cone(0.06, 0.16, 3, 1), {
          rotate: [
            ["y", Math.PI],
            ["z", -s * 0.35],
          ],
          at: [s * 0.155, 1.29, 0.035],
        }),
      ),
      rigid("Head"),
    );
  }
  // Scarf in the player's colour.
  b.body(accent, facet(transform(torus(0.17, 0.045, 10, 5), { at: [0, 0.9, 0.005] })), (p) =>
    along(p[1], [
      [0.86, "Chest"],
      [0.94, "Neck"],
    ]),
  );

  for (const s of [1, -1]) {
    const L = s === 1 ? "Left" : "Right";
    b.body(
      fur,
      facet(
        transform(lowEllipsoid([0.06, 0.06, 0.06], 0.24, 6, 4), {
          rotate: [["z", Math.PI / 2]],
          at: [s * 0.3, 0.82, 0],
        }),
      ),
      (p) =>
        along(Math.abs(p[0]), [
          [0.16, `${L}Shoulder`],
          [0.21, `${L}UpperArm`],
          [0.29, `${L}UpperArm`],
          [0.37, `${L}LowerArm`],
        ]),
    );
    b.body(
      cream,
      facet(transform(lowEllipsoid([0.075, 0.075, 0.075], 0, 6, 4), { at: [s * 0.49, 0.82, 0] })),
      rigid(`${L}Hand`),
    );
    b.body(
      fur,
      facet(transform(lowEllipsoid([0.08, 0.08, 0.08], 0.28, 6, 4), { at: [s * 0.11, 0.3, 0] })),
      (p) =>
        along(p[1], [
          [0.25, `${L}LowerLeg`],
          [0.34, `${L}UpperLeg`],
          [0.5, `${L}UpperLeg`],
          [0.58, "Hips"],
        ]),
    );
    b.body(
      cream,
      facet(
        transform(lowEllipsoid([0.095, 0.065, 0.13], 0, 6, 4), { at: [s * 0.11, 0.065, 0.04] }),
      ),
      rigid(`${L}Foot`),
    );
  }

  // Tail: a chunk per chain bone, growing fluffier, with a cream tip.
  for (let i = 0; i < 3; i++) {
    const from = tail[i]!;
    const to = tail[i + 1]!;
    const mid: Vec3 = [0, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
    const len = Math.hypot(to[1] - from[1], to[2] - from[2]);
    const tilt = Math.atan2(to[2] - from[2], to[1] - from[1]);
    const r = [0.07, 0.1, 0.09][i]!;
    b.body(
      i === 2 ? cream : fur,
      facet(
        transform(lowEllipsoid([r, len * 0.68, r], 0, 6, 4), { rotate: [["x", tilt]], at: mid }),
      ),
      rigid(`Tail${i}`),
    );
  }
  b.spring({
    name: "Tail",
    joints: ["Tail0", "Tail1", "Tail2", "Tail3"],
    stiffness: 0.9,
    gravity: 0.25,
    drag: 0.35,
    hitRadius: 0.06,
  });
  b.collider("Hips", [0, 0.12, 0], 0.2);

  // Face: big toon eyes above the snout.
  for (const s of [1, -1]) {
    const bone = s === 1 ? "LeftEye" : "RightEye";
    const place: Place = { at: [s * 0.1, 1.17, 0.205], rotate: [["y", s * 0.4]] };
    b.feature(
      dark,
      facet(ellipsoid([0.05, 0.068, 0.03], { segments: 10, rings: 8 })),
      place,
      [[bone, 1]],
      eyeShape(s, 0.05, 0.068, false),
    );
    b.feature(
      glint,
      facet(
        transform(ellipsoid([0.018, 0.018, 0.01], { segments: 6, rings: 4 }), {
          at: [0.014, 0.026, 0.028],
        }),
      ),
      place,
      [[bone, 1]],
      eyeShape(s, 0.05, 0.068, true),
    );
  }
  b.feature(
    mouthMat,
    ellipsoid([0.035, 0.012, 0.02], { segments: 10, rings: 6 }),
    { at: [0, 0.975, 0.28], rotate: [["x", 0.35]] },
    [["Head", 1]],
    mouthShape(0.035, 0.13),
  );
  return b;
}

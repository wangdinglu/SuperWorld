// Inky — smooth form, ink surface, mono palette: a doodle stepped off a handwritten page.
// Paper-white body painted with handwriting, brush outlines that swell and thin, cross-hatching in
// the shadows instead of a shade colour, and hands, feet and a tuft dipped in ink.
import {
  ellipsoid,
  frontOf,
  rng,
  tiles,
  torus,
  transform,
  type Vec2,
  type Vec3,
} from "./lib/geometry.ts";
import { eyeShape, mouthShape, still } from "./lib/face.ts";
import type { Palette } from "./lib/palette.ts";
import { Canvas, hexToRgb } from "./lib/png.ts";
import { AvatarBuilder, along, mix, type Place, rigid } from "./lib/vrm.ts";

/** One texture tile covers this many metres of surface, so the hatching keeps one density. */
const TILE = 0.15;

export function build(c: Palette): AvatarBuilder {
  const b = new AvatarBuilder({
    hips: 0.58,
    spine: 0.66,
    chest: 0.8,
    neck: 0.9,
    head: 0.93,
    eye: [0.085, 1.16, 0.11],
    shoulder: [0.09, 0.84],
    arm: [0.2, 0.36, 0.5],
    leg: [0.1, 0.52, 0.3, 0.09],
  });
  const tuft: Vec3[] = [
    [0, 1.37, 0],
    [0, 1.46, -0.02],
    [0, 1.53, -0.08],
    [0, 1.55, -0.16],
  ];
  tuft.forEach((p, i) => b.bone(`Tuft${i}`, i === 0 ? "Head" : `Tuft${i - 1}`, p));

  const head: Vec3 = [0.27, 0.26, 0.25];
  const headAt: Vec3 = [0, 1.13, 0];
  const paper = c.light;
  const ink = c.accent;
  const textures = inkTextures(c);
  // Ink surface: hard light/shadow split; the shadow side multiplies in the hatching.
  const inked = (name: string, colour: string, base?: Buffer, outline = 0.011) =>
    b.material({
      kind: "mtoon",
      name,
      colour,
      shade: colour === paper ? c.ground : mix(colour, ink, 0.25),
      toony: 0.98,
      shift: 0.1,
      outline,
      outlineColour: ink,
      ...(outline ? { outlineWidthTexture: textures.brush } : {}),
      ...(base ? { baseTexture: base, shadeTexture: textures.hatch } : {}),
    });
  const page = inked("Paper", paper, textures.paper);
  const letter = inked("Letter", paper, textures.letter);
  const accent = inked("Accent", c.accent, textures.paper);
  const dipped = inked("Ink", ink, undefined, 0.006);
  const face = inked("Eye", ink, undefined, 0);
  const glint = inked("EyeHighlight", paper, undefined, 0);
  const stroke = inked("Mouth", ink, undefined, 0);

  const uv = (radii: Vec3, stretch = 0): Vec2 => [
    tiles(Math.PI * (radii[0] + radii[2]), TILE),
    tiles(Math.PI * radii[1] + stretch, TILE),
  ];

  // Robe, written all over.
  const robe: Vec3 = [0.24, 0.3, 0.22];
  b.body(
    letter,
    transform(
      ellipsoid(robe, {
        segments: 28,
        rings: 20,
        uvRepeat: [tiles(Math.PI * (robe[0] + robe[2]), 0.36), tiles(Math.PI * robe[1], 0.36)],
      }),
      {
        at: [0, 0.65, 0],
      },
    ),
    (p) =>
      along(p[1], [
        [0.56, "Hips"],
        [0.68, "Spine"],
        [0.84, "Chest"],
      ]),
  );
  b.body(
    page,
    transform(ellipsoid(head, { segments: 28, rings: 20, uvRepeat: uv(head) }), { at: headAt }),
    rigid("Head"),
  );
  b.body(
    accent,
    transform(torus(0.17, 0.04, 24, 8), { scale: [1, 1, 0.92], at: [0, 0.91, 0.005] }),
    (p) =>
      along(p[1], [
        [0.88, "Chest"],
        [0.94, "Neck"],
      ]),
  );

  // The ink tuft: a pooled drop on the head that curls back like a brush tip.
  b.body(
    dipped,
    transform(ellipsoid([0.08, 0.045, 0.08], { segments: 16, rings: 10 }), { at: [0, 1.375, 0] }),
    rigid("Tuft0"),
  );
  for (let i = 0; i < 3; i++) {
    const from = tuft[i]!;
    const to = tuft[i + 1]!;
    const len = Math.hypot(to[1] - from[1], to[2] - from[2]);
    const r = [0.05, 0.035, 0.02][i]!;
    b.body(
      dipped,
      transform(ellipsoid([r, len * 0.62, r], { segments: 12, rings: 8 }), {
        rotate: [["x", Math.atan2(to[2] - from[2], to[1] - from[1])]],
        at: [0, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
      }),
      rigid(`Tuft${i}`),
    );
  }
  b.spring({
    name: "Tuft",
    joints: ["Tuft0", "Tuft1", "Tuft2", "Tuft3"],
    stiffness: 1.1,
    gravity: 0.2,
    drag: 0.3,
    hitRadius: 0.02,
  });
  b.collider("Head", [0, 1.13 - 0.93, 0], 0.22);

  for (const s of [1, -1]) {
    const L = s === 1 ? "Left" : "Right";
    const limb: Vec3 = [0.055, 0.055, 0.055];
    b.body(
      page,
      transform(ellipsoid(limb, { segments: 12, rings: 10, stretch: 0.28, uvRepeat: [2, 3] }), {
        rotate: [["z", Math.PI / 2]],
        at: [s * 0.31, 0.84, 0],
      }),
      (p) =>
        along(Math.abs(p[0]), [
          [0.16, `${L}Shoulder`],
          [0.22, `${L}UpperArm`],
          [0.31, `${L}UpperArm`],
          [0.39, `${L}LowerArm`],
        ]),
    );
    b.body(
      dipped,
      transform(ellipsoid([0.075, 0.07, 0.07], { segments: 12, rings: 10 }), {
        at: [s * 0.51, 0.84, 0],
      }),
      rigid(`${L}Hand`),
    );
    b.body(
      page,
      transform(
        ellipsoid([0.07, 0.07, 0.07], { segments: 12, rings: 10, stretch: 0.3, uvRepeat: [3, 3] }),
        { at: [s * 0.1, 0.3, 0] },
      ),
      (p) =>
        along(p[1], [
          [0.25, `${L}LowerLeg`],
          [0.35, `${L}UpperLeg`],
          [0.52, `${L}UpperLeg`],
          [0.6, "Hips"],
        ]),
    );
    b.body(
      dipped,
      transform(ellipsoid([0.09, 0.06, 0.13], { segments: 12, rings: 10 }), {
        at: [s * 0.1, 0.06, 0.035],
      }),
      rigid(`${L}Foot`),
    );

    // Blush drawn as three quick pen strokes.
    for (let k = -1; k <= 1; k++) {
      const x = s * (0.15 + k * 0.024);
      const y = 1.075;
      b.feature(
        stroke,
        ellipsoid([0.0055, 0.02, 0.006], { segments: 6, rings: 6 }),
        {
          at: [x, y, frontOf(head, headAt, x, y) - 0.002],
          rotate: [
            ["z", -s * 0.45],
            ["y", s * 0.55],
          ],
        },
        [["Head", 1]],
        still,
      );
    }
  }

  // Face: ink-dot eyes and a single pen-stroke mouth.
  for (const s of [1, -1]) {
    const bone = s === 1 ? "LeftEye" : "RightEye";
    const place: Place = { at: [s * 0.085, 1.16, 0.226], rotate: [["y", s * 0.3]] };
    b.feature(
      face,
      ellipsoid([0.032, 0.05, 0.02], { segments: 12, rings: 10 }),
      place,
      [[bone, 1]],
      eyeShape(s, 0.032, 0.05, false),
    );
    b.feature(
      glint,
      transform(ellipsoid([0.01, 0.01, 0.006], { segments: 8, rings: 6 }), {
        at: [0.009, 0.018, 0.017],
      }),
      place,
      [[bone, 1]],
      eyeShape(s, 0.032, 0.05, true),
    );
  }
  b.feature(
    stroke,
    ellipsoid([0.035, 0.008, 0.016], { segments: 12, rings: 8 }),
    { at: [0, 1.04, 0.238] },
    [["Head", 1]],
    mouthShape(0.035, 0.26),
  );
  return b;
}

/** Paints the ink-style textures. All of them tile, so they wrap round the body seamlessly. */
function inkTextures(c: Palette) {
  const paperRgb = hexToRgb(c.light);
  const inkRgb = hexToRgb(c.accent);
  const pencil = hexToRgb(c.base);
  const grain = hexToRgb(c.stone);

  const fibres = (canvas: Canvas, seed: number) => {
    const r = rng(seed);
    for (let i = 0; i < 260; i++) {
      const x = r() * canvas.width;
      const y = r() * canvas.height;
      const a = r() * Math.PI;
      const l = 3 + r() * 9;
      canvas.stroke(
        [
          [x, y],
          [x + Math.cos(a) * l, y + Math.sin(a) * l],
        ],
        0.8,
        grain,
        0.35,
      );
    }
  };

  // Plain paper with fibres.
  const paper = new Canvas(256, 256, paperRgb);
  fibres(paper, 1);

  // A page of handwriting: rows of looping cursive "words" with ascenders and the odd underline.
  const letter = new Canvas(512, 512, paperRgb);
  fibres(letter, 2);
  const r = rng(7);
  const rows = 4;
  for (let row = 0; row < rows; row++) {
    const baseline = (row + 0.7) * (letter.height / rows);
    let x = r() * 80;
    while (x < letter.width + 20) {
      const letters = 3 + Math.floor(r() * 6);
      const points: [number, number][] = [];
      const wobble = r() * 2;
      for (let i = 0; i < letters; i++) {
        const tall = r() < 0.25;
        const h = tall ? 40 + r() * 12 : 18 + r() * 8;
        const width = 16 + r() * 8;
        for (let k = 0; k <= 10; k++) {
          const t = (k / 10) * Math.PI * 2;
          // A prolate cycloid: the pen loops back on itself, like joined-up writing.
          points.push([
            x + (t / (Math.PI * 2)) * width - 6.4 * Math.sin(t),
            baseline - (h * (1 - Math.cos(t))) / 2 + Math.sin(x * 0.025) * wobble * 2,
          ]);
        }
        x += width;
      }
      letter.stroke(points, 3.6, pencil, 0.8);
      if (r() < 0.12) {
        const from = x - letters * 20;
        letter.stroke(
          [
            [from, baseline + 10],
            [(from + x) / 2, baseline + 14],
            [x, baseline + 8],
          ],
          3,
          pencil,
          0.6,
        );
      }
      x += 28 + r() * 32;
    }
  }

  // Hatching for the shadow side: diagonal pen lines with a hand-drawn wobble, crossed sparsely.
  const hatch = new Canvas(256, 256, [255, 255, 255]);
  const period = 21.333; // 12 lines per tile, so the pattern wraps exactly
  for (let i = 0; i < 12; i++) {
    const points: [number, number][] = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const jitter = Math.sin(t * Math.PI * 2 * 2 + i * 1.7) * 1.4;
      points.push([t * 256 + jitter, i * period + t * 256]);
    }
    hatch.stroke(points, 2.6, inkRgb, 0.9);
  }
  for (let i = 0; i < 6; i++) {
    const points: [number, number][] = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      points.push([
        256 - t * 256,
        i * period * 2 + 10 + t * 256 + Math.sin(t * Math.PI * 4 + i) * 1.2,
      ]);
    }
    hatch.stroke(points, 1.8, inkRgb, 0.55);
  }

  // Outline width: slow swells (green channel), so the outline reads as a brush, not a wire.
  const brush = new Canvas(64, 64, [0, 0, 0]);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const u = (x / 64) * Math.PI * 2;
      const v = (y / 64) * Math.PI * 2;
      const n = 0.5 + 0.25 * Math.sin(u * 2 + Math.sin(v * 3)) + 0.25 * Math.sin(v * 2 + u);
      const g = 255 * (0.35 + 0.65 * n);
      brush.blend(x, y, [g, g, g], 1);
    }
  }

  return { paper: paper.png(), letter: letter.png(), hatch: hatch.png(), brush: brush.png() };
}

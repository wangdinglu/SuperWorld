// Bolt — voxel form, pbr surface, dusk palette: a blocky robot with an LED face.
// Every part is a box; materials are physically based (metal, glass, glowing LEDs), and the face is
// a dot matrix whose pixels rearrange into each expression.
import { box, transform, type Vec3 } from "./lib/geometry.ts";
import type { Palette } from "./lib/palette.ts";
import { AvatarBuilder, type Expression, mix, rigid } from "./lib/vrm.ts";

/** LED pitch and pixel size, in metres. */
const PITCH = 0.04;
const PIXEL = 0.032;
/** Pixels per eye and for the mouth; patterns with fewer pixels shrink the spare ones to nothing. */
const EYE_PIXELS = 8;
const MOUTH_PIXELS = 8;

type Pattern = [col: number, row: number][];

/** Eye patterns in pixel units, for the left eye; `inner` points toward the nose. */
function eyePattern(e: Expression | "neutral", side: number): Pattern {
  const inner = -side;
  const open: Pattern = [
    [-0.5, -1],
    [0.5, -1],
    [-0.5, 0],
    [0.5, 0],
    [-0.5, 1],
    [0.5, 1],
  ];
  const shut: Pattern = [
    [-1, -0.5],
    [0, -0.5],
    [1, -0.5],
  ];
  const small: Pattern = open.slice(0, 4);
  switch (e) {
    case "blink":
      return shut;
    case "blinkLeft":
      return side === 1 ? shut : open;
    case "blinkRight":
      return side === -1 ? shut : open;
    case "happy": // ^ ^
      return [
        [-1.5, -1],
        [-0.5, 0],
        [0.5, 0],
        [1.5, -1],
      ];
    case "relaxed": // ‿ ‿
      return [
        [-1.5, -0.2],
        [-0.5, -0.8],
        [0.5, -0.8],
        [1.5, -0.2],
      ];
    case "sad": // brow rising toward the nose
      return [...small, [inner * 0.7, 1.9], [-inner * 0.7, 1.4]];
    case "angry": // brow dipping toward the nose
      return [...small, [inner * 0.7, 1.3], [-inner * 0.7, 1.9]];
    case "surprised": // a ring
      return [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
      ];
    default:
      return open;
  }
}

function mouthPattern(e: Expression | "neutral"): Pattern {
  const line: Pattern = [
    [-1.5, 0],
    [-0.5, 0],
    [0.5, 0],
    [1.5, 0],
  ];
  const ring: Pattern = [
    [-0.5, 1],
    [0.5, 1],
    [-1.2, 0],
    [1.2, 0],
    [-0.5, -1],
    [0.5, -1],
  ];
  switch (e) {
    case "happy":
      return [
        [-2, 0.8],
        [-1, -0.1],
        [0, -0.4],
        [1, -0.1],
        [2, 0.8],
      ];
    case "relaxed":
      return [
        [-1.5, 0.3],
        [-0.5, 0],
        [0.5, 0],
        [1.5, 0.3],
      ];
    case "sad":
      return [
        [-1.5, -0.6],
        [-0.5, 0.2],
        [0.5, 0.2],
        [1.5, -0.6],
      ];
    case "angry": // a zigzag grumble
      return [
        [-1.5, -0.3],
        [-0.5, 0.3],
        [0.5, -0.3],
        [1.5, 0.3],
      ];
    case "surprised":
    case "oh":
      return ring;
    case "aa":
      return [-1.5, -0.5, 0.5, 1.5].flatMap((x): Pattern => [
        [x, 0.5],
        [x, -0.5],
      ]);
    case "ih":
      return [...line, [-0.5, -0.9], [0.5, -0.9]];
    case "ou":
      return [
        [0, 0.6],
        [-0.6, 0],
        [0.6, 0],
        [0, -0.6],
      ];
    case "ee":
      return [
        [-2, 0.3],
        [-1, 0.3],
        [0, 0.3],
        [1, 0.3],
        [2, 0.3],
        [-1, -0.6],
        [0, -0.6],
        [1, -0.6],
      ];
    default:
      return line;
  }
}

export function build(c: Palette): AvatarBuilder {
  const b = new AvatarBuilder({
    hips: 0.62,
    spine: 0.72,
    chest: 0.86,
    neck: 0.98,
    head: 1.0,
    eye: [0.085, 1.24, 0.1],
    shoulder: [0.12, 0.93],
    arm: [0.25, 0.41, 0.56],
    leg: [0.11, 0.58, 0.33, 0.1],
  });
  b.bone("Antenna0", "Head", [0, 1.42, 0]);
  b.bone("Antenna1", "Antenna0", [0, 1.54, 0]);
  b.bone("Antenna2", "Antenna1", [0, 1.64, 0]);

  // PBR surface: brushed panels, darker joints, glossy glass, and LEDs that glow.
  const panel = b.material({
    kind: "pbr",
    name: "Panel",
    colour: c.stone,
    metallic: 0.25,
    roughness: 0.4,
  });
  const joint = b.material({
    kind: "pbr",
    name: "Joint",
    colour: c.metal,
    metallic: 0.55,
    roughness: 0.35,
  });
  const trim = b.material({
    kind: "pbr",
    name: "Trim",
    colour: c.base,
    metallic: 0.2,
    roughness: 0.5,
  });
  const accent = b.material({
    kind: "pbr",
    name: "Accent",
    colour: c.accent,
    metallic: 0.3,
    roughness: 0.35,
  });
  const glass = b.material({
    kind: "pbr",
    name: "Screen",
    colour: mix(c.metal, "#000000", 0.6),
    metallic: 0.1,
    roughness: 0.12,
  });
  const led = b.material({
    kind: "pbr",
    name: "LED",
    colour: c.light,
    metallic: 0,
    roughness: 0.4,
    emissive: c.light,
  });

  const cube = (material: string, size: Vec3, at: Vec3, bone: string) =>
    b.body(material, transform(box(size), { at }), rigid(bone));

  // Head, screen and ear bolts.
  cube(panel, [0.5, 0.42, 0.42], [0, 1.21, 0], "Head");
  cube(glass, [0.42, 0.3, 0.02], [0, 1.2, 0.215], "Head");
  for (const s of [1, -1]) cube(trim, [0.05, 0.14, 0.14], [s * 0.27, 1.21, 0], "Head");
  cube(joint, [0.14, 0.06, 0.14], [0, 0.98, 0], "Neck");
  // Antenna on a spring, with a glowing tip.
  cube(joint, [0.04, 0.03, 0.04], [0, 1.43, 0], "Head");
  b.body(joint, transform(box([0.022, 0.12, 0.022]), { at: [0, 1.48, 0] }), rigid("Antenna0"));
  b.body(joint, transform(box([0.018, 0.1, 0.018]), { at: [0, 1.59, 0] }), rigid("Antenna1"));
  b.body(led, transform(box([0.06, 0.06, 0.06]), { at: [0, 1.66, 0] }), rigid("Antenna1"));
  b.spring({
    name: "Antenna",
    joints: ["Antenna0", "Antenna1", "Antenna2"],
    stiffness: 1.6,
    gravity: 0.1,
    drag: 0.25,
    hitRadius: 0.03,
  });

  // Body: chest with a panel in the player's colour, a belt, a pelvis.
  cube(panel, [0.44, 0.3, 0.3], [0, 0.86, 0], "Chest");
  cube(accent, [0.22, 0.13, 0.02], [0, 0.88, 0.155], "Chest");
  cube(joint, [0.36, 0.08, 0.26], [0, 0.69, 0], "Spine");
  cube(panel, [0.38, 0.12, 0.28], [0, 0.6, 0], "Hips");

  for (const s of [1, -1]) {
    const L = s === 1 ? "Left" : "Right";
    cube(trim, [0.1, 0.12, 0.14], [s * 0.255, 0.93, 0], `${L}Shoulder`);
    cube(panel, [0.13, 0.1, 0.1], [s * 0.33, 0.93, 0], `${L}UpperArm`);
    cube(joint, [0.06, 0.08, 0.08], [s * 0.41, 0.93, 0], `${L}LowerArm`);
    cube(panel, [0.12, 0.095, 0.095], [s * 0.48, 0.93, 0], `${L}LowerArm`);
    cube(trim, [0.1, 0.12, 0.12], [s * 0.6, 0.93, 0], `${L}Hand`);
    cube(panel, [0.13, 0.2, 0.13], [s * 0.11, 0.46, 0], `${L}UpperLeg`);
    cube(joint, [0.1, 0.06, 0.1], [s * 0.11, 0.33, 0], `${L}LowerLeg`);
    cube(panel, [0.12, 0.2, 0.12], [s * 0.11, 0.2, 0], `${L}LowerLeg`);
    cube(joint, [0.15, 0.08, 0.22], [s * 0.11, 0.04, 0.03], `${L}Foot`);
  }

  // LED face: each pixel is a little box with its own morph target per expression.
  const front = 0.215 + 0.01 + 0.008;
  const pixels = (
    count: number,
    centre: Vec3,
    bone: string,
    pattern: (e: Expression | "neutral") => Pattern,
  ) => {
    for (let i = 0; i < count; i++) {
      // Spare pixels sit, invisibly tiny, at the centre until an expression needs them.
      const slot = (e: Expression | "neutral"): { at: Vec3; size: number } => {
        const p = pattern(e)[i];
        return p
          ? { at: [p[0] * PITCH, p[1] * PITCH, 0], size: PIXEL }
          : { at: [0, 0, 0], size: 0.0005 };
      };
      const rest = slot("neutral");
      const part = transform(box([1, 1, 0.5]), {
        scale: [rest.size, rest.size, rest.size],
        at: rest.at,
      });
      b.feature(led, part, { at: centre }, [[bone, 1]], ([x, y, z], e) => {
        const to = slot(e);
        const k = to.size / rest.size;
        return [to.at[0] + (x - rest.at[0]) * k, to.at[1] + (y - rest.at[1]) * k, z * k];
      });
    }
  };
  for (const s of [1, -1]) {
    pixels(EYE_PIXELS, [s * 0.09, 1.24, front], s === 1 ? "LeftEye" : "RightEye", (e) =>
      eyePattern(e, s),
    );
  }
  pixels(MOUTH_PIXELS, [0, 1.125, front], "Head", mouthPattern);
  return b;
}

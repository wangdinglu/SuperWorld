// Expression shapes for cartoon faces built from ellipsoids: an eye (with its highlight) and a
// mouth. Each maps a vertex in the feature's local space to where it sits for an expression.
import type { Vec3 } from "./geometry.ts";
import type { Shape } from "./vrm.ts";

/**
 * A cartoon eye `w` wide and `h` tall (radii). `side` is +1 for the left eye, −1 for the right.
 * The highlight collapses into the eye whenever the eye closes.
 */
export function eyeShape(side: number, w: number, h: number, highlight: boolean): Shape {
  const arch = (0.36 * h) / (w * w);
  return ([x, y, z], e) => {
    const shut = (squash: number, drop: number): Vec3 =>
      highlight ? [x * 0.05, -drop + y * 0.05, z * 0.05] : [x, y * squash - drop, z * 0.9];
    switch (e) {
      case "blink":
        return shut(0.12, 0.27 * h);
      case "blinkLeft":
        return side === 1 ? shut(0.12, 0.27 * h) : [x, y, z];
      case "blinkRight":
        return side === -1 ? shut(0.12, 0.27 * h) : [x, y, z];
      case "happy": // ∩-shaped smiling eyes
        return highlight
          ? [x * 0.05, y * 0.05, z * 0.05]
          : [x, y * 0.3 + 0.16 * h - arch * x * x, z * 0.9];
      case "relaxed":
        return shut(0.35, 0.2 * h);
      case "sad": // inner corners up
        return [x, y * 0.75 - side * x * 0.45 - 0.1 * h, z];
      case "angry": // inner corners down
        return [x, y * 0.6 + side * x * 0.6 - 0.08 * h, z];
      case "surprised":
        return [x * 1.2, y * 1.2, z];
      default:
        return [x, y, z];
    }
  };
}

/**
 * A mouth `w` wide (radius) on a face of curvature radius `faceRadius`: as it stretches, it follows
 * the curve of the face (z ≈ −(x² + y²) / 2R) instead of floating off it.
 */
export function mouthShape(w: number, faceRadius: number): Shape {
  const curve = 1 / (2 * faceRadius);
  return ([x, y, z], e) => {
    // sx, sy scale; dy shifts; lift raises the corners by `lift` mouth-widths.
    const to = (sx: number, sy: number, dy = 0, lift = 0): Vec3 => {
      const nx = x * sx;
      const bend = lift / (sx * sx * w);
      const ny = y * sy + dy * w + bend * nx * nx;
      return [nx, ny, z - curve * (nx * nx - x * x + ny * ny - y * y)];
    };
    switch (e) {
      case "happy":
        return to(1.3, 1.5, -0.13, 0.9);
      case "relaxed":
        return to(1.1, 1.1, -0.05, 0.4);
      case "sad":
        return to(1.0, 1.2, 0.18, -0.8);
      case "angry":
        return to(0.85, 1.1, 0.09, -0.5);
      case "surprised":
        return to(0.65, 2.8, -0.22);
      case "aa":
        return to(1.15, 3.0, -0.33);
      case "ih":
        return to(1.25, 1.7, -0.09);
      case "ou":
        return to(0.55, 2.0, -0.13);
      case "ee":
        return to(1.45, 1.5, -0.09);
      case "oh":
        return to(0.8, 2.7, -0.27);
      default:
        return [x, y, z];
    }
  };
}

/** For parts that don't change with expressions. */
export const still: Shape = (p) => p;

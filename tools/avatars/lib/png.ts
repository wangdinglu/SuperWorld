// A tiny raster canvas and PNG encoder, enough to paint tiling ink textures in code.
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encodes 8-bit RGB pixels as a PNG. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // no filter
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(
      raw,
      y * (width * 3 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export type RGB = [number, number, number];
export const hexToRgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** An RGB canvas that wraps at its edges, so whatever is painted tiles seamlessly. */
export class Canvas {
  readonly px: Float32Array;
  constructor(
    readonly width: number,
    readonly height: number,
    fill: RGB,
  ) {
    this.px = new Float32Array(width * height * 3);
    for (let i = 0; i < width * height; i++) this.px.set(fill, i * 3);
  }

  /** Blends `colour` into one pixel by `alpha` (0..1); coordinates wrap. */
  blend(x: number, y: number, colour: RGB, alpha: number): void {
    const xi = ((x % this.width) + this.width) % this.width;
    const yi = ((y % this.height) + this.height) % this.height;
    const i = (yi * this.width + xi) * 3;
    for (let k = 0; k < 3; k++) this.px[i + k]! += (colour[k]! - this.px[i + k]!) * alpha;
  }

  /** An anti-aliased stroke through `points` (pixels), `width` wide; may cross the edges. */
  stroke(points: [number, number][], width: number, colour: RGB, opacity = 1): void {
    const r = width / 2;
    // Coverage per pixel is the max over segments, so joints don't double-darken.
    const cover = new Map<number, number>();
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, ay] = points[i]!;
      const [bx, by] = points[i + 1]!;
      const minX = Math.floor(Math.min(ax, bx) - r - 1);
      const maxX = Math.ceil(Math.max(ax, bx) + r + 1);
      const minY = Math.floor(Math.min(ay, by) - r - 1);
      const maxY = Math.ceil(Math.max(ay, by) + r + 1);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / len2));
          const d = Math.hypot(x + 0.5 - (ax + t * dx), y + 0.5 - (ay + t * dy));
          const c = Math.max(0, Math.min(1, r + 0.5 - d));
          if (c <= 0) continue;
          const xi = ((x % this.width) + this.width) % this.width;
          const yi = ((y % this.height) + this.height) % this.height;
          const key = yi * this.width + xi;
          cover.set(key, Math.max(cover.get(key) ?? 0, c));
        }
      }
    }
    for (const [key, c] of cover) {
      this.blend(key % this.width, Math.floor(key / this.width), colour, c * opacity);
    }
  }

  png(): Buffer {
    const out = new Uint8Array(this.width * this.height * 3);
    for (let i = 0; i < out.length; i++)
      out[i] = Math.max(0, Math.min(255, Math.round(this.px[i]!)));
    return encodePng(this.width, this.height, out);
  }
}

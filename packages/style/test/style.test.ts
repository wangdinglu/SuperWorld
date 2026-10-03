import { describe, expect, it } from "vitest";
import type { ResolvedStyle } from "@superworld/schema";
import { colourOf, resolveStyle } from "../src/index.ts";

const world: ResolvedStyle = {
  form: "smooth",
  surface: "soft",
  colour: "meadow",
  light: "noon",
  atmosphere: "clear",
  postEffects: [],
  motion: "calm",
  sound: "plaza",
  look2d: "flat",
};

describe("resolveStyle", () => {
  it("returns the world default when no level sets anything", () => {
    expect(resolveStyle(world, {}, undefined)).toEqual(world);
  });

  it("lets later levels win and inherits unset topics", () => {
    const style = resolveStyle(
      world,
      { light: "overcast" },
      { form: "voxel", colour: "candy" },
      { surface: "toon" },
    );
    expect(style).toMatchObject({
      light: "overcast",
      form: "voxel",
      colour: "candy",
      surface: "toon",
      atmosphere: "clear",
    });
  });

  it("does not share arrays with its inputs", () => {
    const level = { postEffects: ["outline" as const] };
    const style = resolveStyle(world, level);
    style.postEffects.push("grain");
    expect(level.postEffects).toEqual(["outline"]);
    expect(world.postEffects).toEqual([]);
  });
});

describe("colourOf", () => {
  it("resolves palette slots and passes literal colours through", () => {
    expect(colourOf("leaf", world)).toBe("#5fae6b");
    expect(colourOf("#123456", world)).toBe("#123456");
  });
});

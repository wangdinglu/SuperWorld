import { describe, expect, it } from "vitest";
import { JoinOptions, quantiseAxis, toCommand } from "../src/index.ts";

describe("input quantisation", () => {
  it("round-trips full and zero axes exactly", () => {
    expect(
      toCommand({ moveX: quantiseAxis(1), moveZ: quantiseAxis(-1), run: false, jump: false }),
    ).toMatchObject({ moveX: 1, moveZ: -1 });
    expect(
      toCommand({ moveX: quantiseAxis(0), moveZ: quantiseAxis(0), run: true, jump: false }).moveX,
    ).toBe(0);
  });

  it("clamps out-of-range values", () => {
    expect(quantiseAxis(5)).toBe(127);
    expect(quantiseAxis(-5)).toBe(-127);
  });
});

describe("JoinOptions", () => {
  it("trims names and rejects bad colours", () => {
    expect(JoinOptions.parse({ protocol: 1, name: "  Ada ", colour: "#ff8800" }).name).toBe("Ada");
    expect(JoinOptions.safeParse({ protocol: 1, name: "Ada", colour: "red" }).success).toBe(false);
    expect(JoinOptions.safeParse({ protocol: 1, name: "", colour: "#ff8800" }).success).toBe(false);
  });
});

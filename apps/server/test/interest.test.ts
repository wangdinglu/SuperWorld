import { describe, expect, it } from "vitest";
import { INTEREST, visibleFor } from "../src/interest.ts";

describe("visibleFor", () => {
  it("includes the viewer and players in neighbouring cells only", () => {
    const players = new Map([
      ["me", { x: 1, z: 1 }],
      ["near", { x: 20, z: 5 }],
      ["far", { x: 200, z: 0 }],
    ]);
    expect(visibleFor("me", players)).toEqual(["me", "near"]);
  });

  it("caps the list at the nearest players", () => {
    const players = new Map([["me", { x: 0, z: 0 }]]);
    for (let i = 0; i < 60; i++)
      players.set(`p${i}`, { x: (i % 10) * 0.5, z: Math.floor(i / 10) * 0.5 });
    const seen = visibleFor("me", players);
    expect(seen).toHaveLength(INTEREST.maxVisible);
    expect(seen[0]).toBe("me");
  });
});

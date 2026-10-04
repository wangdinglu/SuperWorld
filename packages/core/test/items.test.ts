import { describe, expect, it } from "vitest";
import {
  interactionsOf,
  nearestInteraction,
  seatKey,
  sitOn,
  standUp,
  stepProp,
  throwFrom,
  wantsToStand,
} from "../src/index.ts";
import { plaza, templates } from "./fixtures.ts";

const library = new Map(templates.templates.map((t) => [t.id, t]));
const instance = (id: string) => plaza.instances.find((i) => i.id === id)!;

describe("items and behaviours", () => {
  it("lists what each object offers", () => {
    const bench = interactionsOf(instance("bench-1"), library);
    expect(bench.map((i) => i.kind)).toEqual(["sit", "sit"]);
    expect(interactionsOf(instance("ball-basket-1"), library)).toMatchObject([
      { kind: "take", item: "item/ball" },
    ]);
    expect(interactionsOf(instance("drum-1"), library)).toMatchObject([
      { kind: "play", sound: "drum" },
    ]);
    const notice = interactionsOf(instance("notice-1"), library)[0]!;
    expect(notice.kind).toBe("screen");
    // The instance's own text wins over the template's default.
    expect(notice.kind === "screen" && notice.text).toMatch(/Welcome to SuperWorld!/);
    expect(interactionsOf(instance("tree-1"), library)).toEqual([]);
  });

  it("finds the nearest usable thing and skips taken seats", () => {
    const basket = instance("ball-basket-1");
    expect(nearestInteraction(plaza, library, basket.at[0] + 1, basket.at[2])).toMatchObject({
      kind: "take",
      instance: "ball-basket-1",
    });
    expect(nearestInteraction(plaza, library, 0, 30)).toBeUndefined();

    const [seat0, seat1] = interactionsOf(instance("bench-1"), library);
    const nearSeat0 = nearestInteraction(plaza, library, seat0!.at[0], seat0!.at[2]);
    expect(nearSeat0).toMatchObject({ kind: "sit", seat: 0 });
    const taken = new Set([seatKey("bench-1", 0)]);
    expect(
      nearestInteraction(plaza, library, seat0!.at[0], seat0!.at[2], { takenSeats: taken }),
    ).toMatchObject({ kind: "sit", seat: 1, at: seat1!.at });
  });

  it("offers loose items on the ground for pick-up", () => {
    const found = nearestInteraction(plaza, library, 0, 25, {
      props: [["p1", { item: "item/ball", x: 0.5, y: 0.15, z: 25, resting: true }]],
    });
    expect(found).toMatchObject({ kind: "pickup", prop: "p1", item: "item/ball" });
  });

  it("sits, and stands up when the player moves", () => {
    const state = { x: 0, y: 0, z: 0, vy: -2, yaw: 0, grounded: false };
    sitOn(state, { at: [1, 0.2, 2], yaw: Math.PI / 2 });
    expect(state).toMatchObject({ x: 1, y: 0.2, z: 2, vy: 0, grounded: true });
    expect(wantsToStand({ moveX: 0, moveZ: 0, run: false, jump: false })).toBe(false);
    expect(wantsToStand({ moveX: 0.5, moveZ: 0, run: false, jump: false })).toBe(true);
    standUp(state);
    expect(state.x).toBeCloseTo(1.7);
    expect(state.y).toBe(0);
  });

  it("throws an item forward; it lands and comes to rest inside the ground", () => {
    const prop = throwFrom({ x: 0, y: 0, z: 0, vy: 0, yaw: 0, grounded: true });
    for (let i = 0; i < 30 * 10 && !prop.resting; i++) stepProp(prop, 1 / 30, 50);
    expect(prop.resting).toBe(true);
    expect(prop.z).toBeGreaterThan(5);
    expect(prop.y).toBeCloseTo(0.15);
    const far = throwFrom({ x: 0, y: 0, z: 9, vy: 0, yaw: 0, grounded: true });
    for (let i = 0; i < 30 * 10; i++) stepProp(far, 1 / 30, 10);
    expect(Math.hypot(far.x, far.z)).toBeLessThanOrEqual(10);
  });
});

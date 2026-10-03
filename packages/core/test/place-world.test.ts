import { beforeAll, describe, expect, it } from "vitest";
import {
  type AvatarState,
  type MoveCommand,
  initPhysics,
  PlaceWorld,
  steerTowards,
  TICK_RATE,
} from "../src/index.ts";
import { plaza, templates } from "./fixtures.ts";

const dt = 1 / TICK_RATE;
const at = (x: number, z: number): AvatarState => ({ x, y: 0, z, vy: 0, yaw: 0, grounded: true });
const cmd = (moveX: number, moveZ: number, extra: Partial<MoveCommand> = {}): MoveCommand => ({
  moveX,
  moveZ,
  run: false,
  jump: false,
  ...extra,
});

function run(
  world: PlaceWorld,
  id: string,
  state: AvatarState,
  commands: MoveCommand[],
): AvatarState {
  for (const c of commands) world.stepAvatar(id, state, c, dt);
  return state;
}

describe("PlaceWorld", () => {
  let world: PlaceWorld;
  beforeAll(async () => {
    await initPhysics();
    world = PlaceWorld.build(plaza, templates);
  });

  it("stands still on the ground", () => {
    world.addAvatar("a", at(0, 13));
    const s = run(world, "a", at(0, 13), Array(30).fill(cmd(0, 0)));
    expect(s.y).toBeCloseTo(0, 1);
    expect(s.grounded).toBe(true);
    expect(s.x).toBeCloseTo(0, 3);
    expect(s.z).toBeCloseTo(13, 3);
  });

  it("walks at walking speed and faces where it goes", () => {
    world.addAvatar("b", at(0, 13));
    const s = run(world, "b", at(0, 13), Array(TICK_RATE).fill(cmd(1, 0)));
    expect(s.x).toBeGreaterThan(3.8);
    expect(s.x).toBeLessThan(4.4);
    expect(s.yaw).toBeCloseTo(Math.PI / 2, 3);
  });

  it("is stopped by the fountain basin", () => {
    world.addAvatar("c", at(0, 13));
    // Walk north (towards -Z) for 4 seconds: the basin edge is at z = 5.
    const s = run(world, "c", at(0, 13), Array(TICK_RATE * 4).fill(cmd(0, -1)));
    expect(s.z).toBeGreaterThan(5);
    expect(s.z).toBeLessThan(6);
  });

  it("jumps and lands", () => {
    world.addAvatar("d", at(0, 13));
    const s = at(0, 13);
    world.stepAvatar("d", s, cmd(0, 0, { jump: true }), dt);
    let peak = s.y;
    for (let i = 0; i < TICK_RATE * 2; i++) {
      world.stepAvatar("d", s, cmd(0, 0), dt);
      peak = Math.max(peak, s.y);
    }
    expect(peak).toBeGreaterThan(1);
    expect(s.y).toBeCloseTo(0, 1);
    expect(s.grounded).toBe(true);
  });

  it("stays on the ground disc", () => {
    world.addAvatar("e", at(0, 13));
    const s = run(world, "e", at(0, 13), Array(TICK_RATE * 20).fill(cmd(0, 1, { run: true })));
    expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(60);
  });

  it("lets avatars pass through each other", () => {
    world.addAvatar("f", at(2, 13));
    world.addAvatar("g", at(4, 13));
    const s = run(world, "f", at(2, 13), Array(TICK_RATE).fill(cmd(1, 0)));
    expect(s.x).toBeGreaterThan(5.8);
  });

  it("replays the same inputs to the same result", () => {
    const commands: MoveCommand[] = Array.from({ length: 200 }, (_, i) =>
      cmd(Math.sin(i / 9), Math.cos(i / 13), { run: i % 50 < 20, jump: i % 37 === 0 }),
    );
    world.addAvatar("h", at(0, 13));
    const first = run(world, "h", at(0, 13), commands);
    world.addAvatar("h", at(0, 13));
    const second = run(world, "h", at(0, 13), commands);
    expect(second).toEqual(first);
  });

  it("gives spawn positions inside the spawn area", () => {
    for (const [r1, r2] of [
      [0, 0],
      [0.5, 0.25],
      [0.999, 0.999],
    ] as const) {
      const [x, , z] = world.spawnPosition(r1, r2);
      expect(Math.hypot(x - 0, z - 13)).toBeLessThanOrEqual(4.0001);
    }
  });
});

describe("steerTowards", () => {
  it("points at the target and stops on arrival", () => {
    expect(steerTowards(0, 0, 10, 0)).toMatchObject({ moveX: 1, moveZ: 0, arrived: false });
    expect(steerTowards(0, 0, 0.2, 0).arrived).toBe(true);
  });
});

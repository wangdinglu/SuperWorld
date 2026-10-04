import type { Behaviour, Instance, Scene, Template, Vec3 } from "@superworld/schema";
import { MOVE } from "./constants.ts";
import { type AvatarState, type MoveCommand } from "./movement.ts";
import { placeOffset } from "./place-world.ts";

/** How close (metres, on the ground) an avatar must be to use something. */
export const INTERACT_RANGE = 2;
/** Extra reach the server allows on top, for latency between what the client saw and the server. */
export const INTERACT_SLACK = 1;
export const INVENTORY_MAX = 12;
export const MAX_PROPS = 24;
export const PROP_LIFETIME_S = 60;

/** Something a player can do here, right now. */
export type Interaction =
  | { kind: "sit"; instance: string; seat: number; at: Vec3; yaw: number; label: string }
  | { kind: "take"; instance: string; item: string; at: Vec3; label: string }
  | {
      kind: "play";
      instance: string;
      sound: Extract<Behaviour, { kind: "play" }>["sound"];
      notes: number[];
      at: Vec3;
      label: string;
    }
  | { kind: "screen"; instance: string; title: string; text: string; at: Vec3; label: string }
  | { kind: "pickup"; prop: string; item: string; at: Vec3; label: string };

/** Rough radius of a template on the ground, in metres (before scale). */
export function templateReach(template: Template): number {
  return Math.max(
    ...template.parts.map((p) => {
      const reach = p.shape === "box" ? Math.hypot(p.size[0], p.size[2]) / 2 : p.radius;
      return Math.hypot(p.at[0], p.at[2]) + reach;
    }),
  );
}

const offset = (inst: Instance, at: Vec3): Vec3 => placeOffset(at, inst.at, inst.yaw, inst.scale);

/** Everything one instance offers, with the point the avatar has to be near. */
export function interactionsOf(
  inst: Instance,
  templates: ReadonlyMap<string, Template>,
): Interaction[] {
  const template = templates.get(inst.template);
  if (!template) return [];
  const out: Interaction[] = [];
  if (template.item) {
    out.push({
      kind: "take",
      instance: inst.id,
      item: template.id,
      at: inst.at,
      label: `Take the ${template.name.toLowerCase()}`,
    });
  }
  for (const b of template.behaviours) {
    switch (b.kind) {
      case "sit":
        b.seats.forEach((seat, i) =>
          out.push({
            kind: "sit",
            instance: inst.id,
            seat: i,
            at: offset(inst, seat.at),
            yaw: inst.yaw + seat.yaw,
            label: `Sit on the ${template.name.toLowerCase()}`,
          }),
        );
        break;
      case "give": {
        const item = templates.get(b.item);
        out.push({
          kind: "take",
          instance: inst.id,
          item: b.item,
          at: inst.at,
          label: `Take a ${(item?.name ?? b.item).toLowerCase()}`,
        });
        break;
      }
      case "play":
        out.push({
          kind: "play",
          instance: inst.id,
          sound: b.sound,
          notes: b.notes,
          at: inst.at,
          label: `Play the ${template.name.toLowerCase()}`,
        });
        break;
      case "screen":
        out.push({
          kind: "screen",
          instance: inst.id,
          title: b.title,
          text: inst.text ?? b.text,
          at: inst.at,
          label: `Read the ${template.name.toLowerCase()}`,
        });
        break;
    }
  }
  return out;
}

/** How far from its point an interaction can be used (seats are precise; objects count their size). */
export function reachOf(
  interaction: Interaction,
  inst: Instance | undefined,
  templates: ReadonlyMap<string, Template>,
): number {
  if (interaction.kind === "sit" || interaction.kind === "pickup" || !inst) return INTERACT_RANGE;
  const template = templates.get(inst.template);
  return INTERACT_RANGE + (template ? templateReach(template) * inst.scale * 0.6 : 0);
}

/** A loose item lying around or flying (thrown). */
export interface PropState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  resting: boolean;
  age: number;
}

/** The closest thing to (x, z) a player can use, skipping seats someone else is in. */
export function nearestInteraction(
  scene: Scene,
  templates: ReadonlyMap<string, Template>,
  x: number,
  z: number,
  options: {
    takenSeats?: ReadonlySet<string>;
    props?: Iterable<[string, { item: string; x: number; y: number; z: number; resting: boolean }]>;
  } = {},
): Interaction | undefined {
  let best: Interaction | undefined;
  let bestScore = Infinity;
  const consider = (i: Interaction, reach: number) => {
    const d = Math.hypot(i.at[0] - x, i.at[2] - z);
    if (d > reach) return;
    // Prefer the closest relative to how far each one reaches.
    const score = d / reach;
    if (score < bestScore) {
      best = i;
      bestScore = score;
    }
  };
  for (const inst of scene.instances) {
    // Cheap reject before building the list.
    if (Math.abs(inst.at[0] - x) > 12 || Math.abs(inst.at[2] - z) > 12) continue;
    for (const i of interactionsOf(inst, templates)) {
      if (i.kind === "sit" && options.takenSeats?.has(seatKey(i.instance, i.seat))) continue;
      consider(i, reachOf(i, inst, templates));
    }
  }
  for (const [id, prop] of options.props ?? []) {
    if (!prop.resting) continue;
    const template = templates.get(prop.item);
    consider(
      {
        kind: "pickup",
        prop: id,
        item: prop.item,
        at: [prop.x, prop.y, prop.z],
        label: `Pick up the ${(template?.name ?? prop.item).toLowerCase()}`,
      },
      INTERACT_RANGE,
    );
  }
  return best;
}

export const seatKey = (instance: string, seat: number): string => `${instance}#${seat}`;

/** Puts an avatar on a seat. */
export function sitOn(state: AvatarState, seat: { at: Vec3; yaw: number }): void {
  state.x = seat.at[0];
  state.y = seat.at[1];
  state.z = seat.at[2];
  state.yaw = seat.yaw;
  state.vy = 0;
  state.grounded = true;
}

/** Seated avatars stand up as soon as the player moves or jumps. */
export function wantsToStand(cmd: MoveCommand): boolean {
  return cmd.jump || Math.hypot(cmd.moveX, cmd.moveZ) > 0.05;
}

/** Steps off a seat: half a metre forward, down to the floor the seat stands on. */
export function standUp(state: AvatarState): void {
  state.x += Math.sin(state.yaw) * 0.7;
  state.z += Math.cos(state.yaw) * 0.7;
  state.y = Math.max(0, state.y - 0.2);
  state.vy = 0;
  state.grounded = false;
}

/** A thrown item leaves the hand in front of the thrower, forward and up. */
export function throwFrom(state: AvatarState): PropState {
  const fx = Math.sin(state.yaw);
  const fz = Math.cos(state.yaw);
  return {
    x: state.x + fx * 0.5,
    y: state.y + 1.4,
    z: state.z + fz * 0.5,
    vx: fx * 9,
    vy: 4.5,
    vz: fz * 9,
    resting: false,
    age: 0,
  };
}

const PROP_RADIUS = 0.15;

/**
 * One fixed step of a loose item: falls, bounces on the ground, rolls to a stop, and stays inside
 * the ground disc. It doesn't hit objects (cheap enough to run many at 30 Hz on the server).
 */
export function stepProp(p: PropState, dt: number, groundRadius: number): void {
  p.age += dt;
  if (p.resting) return;
  p.vy -= MOVE.gravity * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;
  if (p.y <= PROP_RADIUS) {
    p.y = PROP_RADIUS;
    if (p.vy < 0) p.vy = -p.vy * 0.45;
    p.vx *= 0.8;
    p.vz *= 0.8;
    if (Math.abs(p.vy) < 0.6) p.vy = 0;
    if (p.vy === 0 && Math.hypot(p.vx, p.vz) < 0.3) {
      p.vx = p.vz = 0;
      p.resting = true;
    }
  }
  const r = Math.hypot(p.x, p.z);
  const limit = groundRadius - PROP_RADIUS;
  if (r > limit) {
    p.x *= limit / r;
    p.z *= limit / r;
    p.vx = -p.vx * 0.5;
    p.vz = -p.vz * 0.5;
  }
}

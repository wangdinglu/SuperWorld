import RAPIER from "@dimforge/rapier3d-compat";
import type { Part, Scene, Template, TemplateLibrary, Vec3 } from "@superworld/schema";
import { MOVE } from "./constants.ts";
import { type AvatarState, type MoveCommand, sanitizeCommand } from "./movement.ts";

let ready: Promise<void> | undefined;

/** Loads the physics engine (WASM). Call once before building a PlaceWorld. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

// Collision groups: membership in the high 16 bits, filter in the low 16 bits.
const STATIC = 0x0001;
const AVATAR = 0x0002;
const STATIC_GROUPS = (STATIC << 16) | (STATIC | AVATAR);
/** Avatars touch the world but pass through each other, so nobody can block a door or a spawn. */
const AVATAR_GROUPS = (AVATAR << 16) | STATIC;

const yawQuat = (yaw: number) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

/** Where a part sits in place coordinates, given the instance transform. */
export function placePart(
  part: Part,
  at: Vec3,
  yaw: number,
  scale: number,
): { pos: Vec3; yaw: number } {
  const [px, py, pz] = part.at;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    pos: [
      at[0] + (px * c + pz * s) * scale,
      at[1] + py * scale,
      at[2] + (-px * s + pz * c) * scale,
    ],
    yaw: yaw + part.yaw,
  };
}

function partCollider(part: Part, scale: number): RAPIER.ColliderDesc {
  switch (part.shape) {
    case "box":
      return RAPIER.ColliderDesc.cuboid(
        (part.size[0] * scale) / 2,
        (part.size[1] * scale) / 2,
        (part.size[2] * scale) / 2,
      );
    case "cylinder":
      return RAPIER.ColliderDesc.cylinder((part.height * scale) / 2, part.radius * scale);
    case "sphere":
      return RAPIER.ColliderDesc.ball(part.radius * scale);
    case "cone":
      return RAPIER.ColliderDesc.cone((part.height * scale) / 2, part.radius * scale);
  }
}

/**
 * The physical side of one place: static colliders built from its scene file, plus
 * one capsule per avatar. The same class runs in the server room and in the browser,
 * which is what lets the client predict its own movement.
 */
export class PlaceWorld {
  readonly scene: Scene;
  private readonly world: RAPIER.World;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly avatars = new Map<string, RAPIER.Collider>();
  private readonly radius: number;

  private constructor(scene: Scene, templates: Map<string, Template>) {
    this.scene = scene;
    this.radius = scene.environment.ground.radius;
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });

    // Ground: a slab whose top is at y = 0. Avatars are kept inside the disc in stepAvatar.
    this.addStatic(RAPIER.ColliderDesc.cuboid(this.radius, 0.5, this.radius), [0, -0.5, 0], 0);

    for (const inst of scene.instances) {
      const template = templates.get(inst.template);
      if (!template) throw new Error(`Unknown template "${inst.template}" in ${scene.place}`);
      for (const part of template.parts) {
        if (!part.solid) continue;
        const placed = placePart(part, inst.at, inst.yaw, inst.scale);
        this.addStatic(partCollider(part, inst.scale), placed.pos, placed.yaw);
      }
    }

    this.controller = this.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(0.4, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(false);

    // One step builds the acceleration structures that movement queries use.
    this.world.step();
  }

  /** Builds the world for a scene. `initPhysics()` must have resolved first. */
  static build(scene: Scene, library: TemplateLibrary): PlaceWorld {
    return new PlaceWorld(scene, new Map(library.templates.map((t) => [t.id, t])));
  }

  private addStatic(desc: RAPIER.ColliderDesc, pos: Vec3, yaw: number): void {
    desc
      .setTranslation(pos[0], pos[1], pos[2])
      .setRotation(yawQuat(yaw))
      .setCollisionGroups(STATIC_GROUPS);
    this.world.createCollider(desc);
  }

  get avatarCount(): number {
    return this.avatars.size;
  }

  /** A deterministic spawn position for a random number in [0, 1). */
  spawnPosition(r1: number, r2: number): Vec3 {
    const area = this.scene.spawn[Math.floor(r1 * this.scene.spawn.length)] ?? this.scene.spawn[0]!;
    const angle = r2 * Math.PI * 2;
    const dist = Math.sqrt((r1 * 7.31) % 1) * area.radius;
    return [area.at[0] + Math.sin(angle) * dist, area.at[1], area.at[2] + Math.cos(angle) * dist];
  }

  addAvatar(id: string, state: AvatarState): void {
    this.removeAvatar(id);
    const desc = RAPIER.ColliderDesc.capsule(MOVE.capsuleHalfHeight, MOVE.capsuleRadius)
      .setTranslation(state.x, state.y + MOVE.capsuleHalfHeight + MOVE.capsuleRadius, state.z)
      .setCollisionGroups(AVATAR_GROUPS);
    this.avatars.set(id, this.world.createCollider(desc));
  }

  removeAvatar(id: string): void {
    const collider = this.avatars.get(id);
    if (collider) {
      this.world.removeCollider(collider, false);
      this.avatars.delete(id);
    }
  }

  /**
   * Advances one avatar by one fixed step. Mutates `state` in place. Pure with respect to
   * (state, command, dt) and the static world, so replaying the same inputs gives the same result.
   */
  stepAvatar(id: string, state: AvatarState, command: MoveCommand, dt: number): void {
    const collider = this.avatars.get(id);
    if (!collider) return;
    const cmd = sanitizeCommand(command);
    const centreOffset = MOVE.capsuleHalfHeight + MOVE.capsuleRadius;
    collider.setTranslation({ x: state.x, y: state.y + centreOffset, z: state.z });

    const speed = cmd.run ? MOVE.runSpeed : MOVE.walkSpeed;
    if (state.grounded && cmd.jump) {
      state.vy = MOVE.jumpSpeed;
      state.grounded = false;
    }
    state.vy -= MOVE.gravity * dt;

    const desired = { x: cmd.moveX * speed * dt, y: state.vy * dt, z: cmd.moveZ * speed * dt };
    this.controller.computeColliderMovement(collider, desired, undefined, AVATAR_GROUPS);
    const moved = this.controller.computedMovement();

    state.x += moved.x;
    state.y += moved.y;
    state.z += moved.z;
    state.grounded = this.controller.computedGrounded();
    if (state.grounded && state.vy < 0) state.vy = 0;
    // Bumped a ceiling: stop rising.
    if (state.vy > 0 && moved.y < desired.y * 0.5) state.vy = 0;

    // The ground is a disc; keep avatars on it.
    const r = Math.hypot(state.x, state.z);
    const limit = this.radius - MOVE.capsuleRadius;
    if (r > limit) {
      state.x *= limit / r;
      state.z *= limit / r;
    }
    if (state.y < MOVE.killY) {
      const [sx, sy, sz] = this.scene.spawn[0]!.at;
      state.x = sx;
      state.y = sy;
      state.z = sz;
      state.vy = 0;
    }
    if (Math.hypot(cmd.moveX, cmd.moveZ) > 0.05) state.yaw = Math.atan2(cmd.moveX, cmd.moveZ);
    collider.setTranslation({ x: state.x, y: state.y + centreOffset, z: state.z });
  }

  dispose(): void {
    this.world.free();
  }
}

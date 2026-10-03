/** The scalar state the server and client agree on for one avatar. Mirrors the network schema fields. */
export interface AvatarState {
  x: number;
  y: number;
  z: number;
  /** Vertical speed, m/s. */
  vy: number;
  /** Facing around Y, radians. 0 faces +Z. */
  yaw: number;
  grounded: boolean;
}

/** One fixed step of player intent. Direction is in world space (the client applies the camera). */
export interface MoveCommand {
  moveX: number;
  moveZ: number;
  run: boolean;
  jump: boolean;
}

export const IDLE_COMMAND: Readonly<MoveCommand> = { moveX: 0, moveZ: 0, run: false, jump: false };

/** Clamps a command to what the rules allow; the server never trusts raw input. */
export function sanitizeCommand(cmd: MoveCommand): MoveCommand {
  let mx = Number.isFinite(cmd.moveX) ? cmd.moveX : 0;
  let mz = Number.isFinite(cmd.moveZ) ? cmd.moveZ : 0;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  return { moveX: mx, moveZ: mz, run: Boolean(cmd.run), jump: Boolean(cmd.jump) };
}

/** Direction from (x, z) towards a target, as a move command; stops within `arrive` metres. */
export function steerTowards(
  x: number,
  z: number,
  tx: number,
  tz: number,
  arrive = 0.4,
): { moveX: number; moveZ: number; arrived: boolean } {
  const dx = tx - x;
  const dz = tz - z;
  const d = Math.hypot(dx, dz);
  if (d <= arrive) return { moveX: 0, moveZ: 0, arrived: true };
  // Slow down over the last metre so tap-to-move doesn't overshoot.
  const k = Math.min(1, d) / d;
  return { moveX: dx * k, moveZ: dz * k, arrived: false };
}

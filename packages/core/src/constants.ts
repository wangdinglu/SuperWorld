/** Fixed simulation rate for hangout rooms. Server and client step at this rate. */
export const TICK_RATE = 30;

export const MOVE = {
  walkSpeed: 4.2,
  runSpeed: 7.5,
  gravity: 22,
  jumpSpeed: 7.5,
  /** Avatars below this height are returned to the spawn area. */
  killY: -30,
  /** Capsule: half-height of the cylinder part, and radius. Total height ≈ 1.7 m. */
  capsuleHalfHeight: 0.5,
  capsuleRadius: 0.35,
} as const;

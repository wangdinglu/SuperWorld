import { schema, t } from "@colyseus/schema";
import type { MoveCommand } from "@superworld/core";
import { z } from "zod";

/** Bumped whenever the wire format changes. Clients with another version are asked to reload. */
export const PROTOCOL_VERSION = 2;

/** Room name per place kind. */
export const ROOM = { plaza: "plaza" } as const;
export const PLAZA_CAPACITY = 50;

/** One avatar. The movement fields mirror the core's AvatarState. */
export const Player = schema(
  {
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    vy: t.float32(),
    yaw: t.float32(),
    grounded: t.boolean(),
    name: t.string(),
    colour: t.string(),
    /** Avatar id from content/avatars/avatars.json. */
    avatar: t.string(),
  },
  "Player",
);
export type Player = InstanceType<typeof Player>;

/** Fields the client predicts and reconciles. Strings (name, colour, avatar) stay server-only. */
export const PREDICTED_FIELDS = ["x", "y", "z", "vy", "yaw", "grounded"] as const;

export const PlaceState = schema(
  {
    place: t.string(),
    revision: t.uint32(),
    /** Each client only receives the players near it (see the server's interest grid). */
    players: t.map(Player).view(),
  },
  "PlaceState",
);
export type PlaceState = InstanceType<typeof PlaceState>;

/** One input per fixed step. Directions are quantised to int8 so server and client read identical values. */
export const MoveInput = schema(
  {
    moveX: t.int8(),
    moveZ: t.int8(),
    run: t.boolean(),
    jump: t.boolean(),
  },
  "MoveInput",
);
export type MoveInput = InstanceType<typeof MoveInput>;

const Q = 127;
export const quantiseAxis = (v: number): number => Math.max(-Q, Math.min(Q, Math.round(v * Q)));

/** Wire input → core command. Used by both the server step and client prediction. */
export function toCommand(input: {
  moveX: number;
  moveZ: number;
  run: boolean;
  jump: boolean;
}): MoveCommand {
  return { moveX: input.moveX / Q, moveZ: input.moveZ / Q, run: input.run, jump: input.jump };
}

export const EMOTES = ["wave", "dance", "cheer", "sit"] as const;
export type Emote = (typeof EMOTES)[number];

export const NAME_MAX = 20;
export const CHAT_MAX = 200;

/** An avatar id; the server checks it against the avatar library. */
export const AvatarId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/);

export const JoinOptions = z.object({
  protocol: z.number().int(),
  name: z.string().trim().min(1).max(NAME_MAX),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** Unknown or missing: the library's default avatar. */
  avatar: AvatarId.optional(),
});
export type JoinOptions = z.infer<typeof JoinOptions>;

/** Client → server messages (besides input). */
export const ChatMessage = z.object({ text: z.string().trim().min(1).max(CHAT_MAX) });
export const EmoteMessage = z.object({ emote: z.enum(EMOTES) });
/** Switch to another avatar from the library. */
export const AvatarMessage = z.object({ avatar: AvatarId });
export const ReportMessage = z.object({
  sessionId: z.string().max(64),
  reason: z.string().max(200),
});

/** Client → server, every 30 s: how the game runs on this device (for playtests and tier tuning). */
export const TelemetryMessage = z.object({
  fps: z.number().min(0).max(1000),
  tier: z.enum(["low", "medium", "high"]),
  backend: z.enum(["webgpu", "webgl2"]),
  rttMs: z.number().min(0).max(60_000),
  device: z.enum(["phone", "tablet", "desktop"]),
  viewport: z.tuple([z.number().int().min(0).max(20_000), z.number().int().min(0).max(20_000)]),
});
export type TelemetryMessage = z.infer<typeof TelemetryMessage>;

/** Server → client broadcasts. */
export interface ChatBroadcast {
  sessionId: string;
  name: string;
  text: string;
}
export interface EmoteBroadcast {
  sessionId: string;
  emote: Emote;
}

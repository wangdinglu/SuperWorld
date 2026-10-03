import { type AuthContext, type Client, Room } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import { createRng, initPhysics, PlaceWorld, TICK_RATE } from "@superworld/core";
import {
  ChatMessage,
  EmoteMessage,
  JoinOptions,
  MoveInput,
  PLAZA_CAPACITY,
  PlaceState,
  Player,
  PROTOCOL_VERSION,
  ReportMessage,
  toCommand,
  type ChatBroadcast,
  type EmoteBroadcast,
} from "@superworld/protocol";
import type { Content } from "../content.ts";
import { type GuestIdentity, verifyGuestToken } from "../guest.ts";
import { visibleFor } from "../interest.ts";
import { maskText, RateLimiter } from "../moderation.ts";

export interface PlazaRoomOptions {
  content: Content;
  placeId: string;
}

/** Most buffered inputs applied per client per tick: lets a client catch up after jitter, but not run fast. */
const MAX_INPUTS_PER_TICK = 3;
/** State patches per second sent to clients. */
const PATCH_RATE_HZ = 15;
/** Recompute who sees whom every N ticks. */
const INTEREST_EVERY_TICKS = 5;
const RECONNECT_SECONDS = 20;

export class PlazaRoom extends Room<{
  state: PlaceState;
  input: MoveInput;
  client: Client<{ auth: GuestIdentity }>;
}> {
  override maxClients = PLAZA_CAPACITY;
  override state = new PlaceState();
  override inputs = this.defineInput(MoveInput);

  private world!: PlaceWorld;
  private readonly rng = createRng(Date.now() & 0xffffffff);
  private readonly visible = new Map<string, Set<string>>();
  private readonly chatLimit = new RateLimiter(5, 10_000);
  private readonly emoteLimit = new RateLimiter(2, 2_000);
  private tickCount = 0;

  override async onCreate(options: PlazaRoomOptions): Promise<void> {
    const scene = options.content.scenes[options.placeId];
    if (!scene) throw new Error(`No scene for place "${options.placeId}"`);
    await initPhysics();
    this.world = PlaceWorld.build(scene, options.content.templates);
    this.state.place = scene.place;
    this.state.revision = scene.revision;
    this.patchRate = 1000 / PATCH_RATE_HZ;
    this.setMetadata({ place: scene.place });

    this.setFixedTimestep((ctx) => {
      for (const [sessionId, player] of this.state.players) {
        for (const input of this.inputs.get(sessionId).take(MAX_INPUTS_PER_TICK)) {
          this.world.stepAvatar(sessionId, player, toCommand(input), ctx.dt);
        }
      }
      if (++this.tickCount % INTEREST_EVERY_TICKS === 0) this.updateInterest();
    }, TICK_RATE);

    this.onMessage("chat", (client, message: unknown) => {
      const parsed = ChatMessage.safeParse(message);
      if (!parsed.success || !this.chatLimit.allow(client.sessionId)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const payload: ChatBroadcast = {
        sessionId: client.sessionId,
        name: player.name,
        text: maskText(parsed.data.text),
      };
      this.broadcast("chat", payload);
    });

    this.onMessage("emote", (client, message: unknown) => {
      const parsed = EmoteMessage.safeParse(message);
      if (!parsed.success || !this.emoteLimit.allow(client.sessionId)) return;
      const payload: EmoteBroadcast = { sessionId: client.sessionId, emote: parsed.data.emote };
      this.broadcast("emote", payload);
    });

    this.onMessage("report", (client, message: unknown) => {
      const parsed = ReportMessage.safeParse(message);
      if (!parsed.success) return;
      // Phase 1: reports go to the server log. Phase 2 stores them for review.
      console.warn(
        JSON.stringify({
          event: "report",
          room: this.roomId,
          from: client.sessionId,
          ...parsed.data,
          at: new Date().toISOString(),
        }),
      );
    });
  }

  override onAuth(_client: Client, options: unknown, context: AuthContext): GuestIdentity {
    const parsed = JoinOptions.safeParse(options);
    if (!parsed.success) throw new Error("Invalid join options");
    if (parsed.data.protocol !== PROTOCOL_VERSION)
      throw new Error("Client is out of date: please reload");
    const identity = verifyGuestToken(context.token);
    if (!identity) throw new Error("Missing or invalid guest token");
    return identity;
  }

  override onJoin(client: Client<{ auth: GuestIdentity }>): void {
    const identity = client.auth!;
    const [x, y, z] = this.world.spawnPosition(this.rng(), this.rng());
    const player = new Player();
    Object.assign(player, {
      x,
      y,
      z,
      vy: 0,
      yaw: Math.PI,
      grounded: true,
      name: maskText(identity.name),
      colour: identity.colour,
    });
    this.state.players.set(client.sessionId, player);
    this.world.addAvatar(client.sessionId, player);
    client.view = new StateView();
    this.visible.set(client.sessionId, new Set());
    this.updateInterest();
  }

  override async onDrop(client: Client): Promise<void> {
    // Keep the seat briefly so a flaky mobile connection can come back to the same avatar.
    await this.allowReconnection(client, RECONNECT_SECONDS);
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.world.removeAvatar(client.sessionId);
    this.visible.delete(client.sessionId);
    this.chatLimit.forget(client.sessionId);
    this.emoteLimit.forget(client.sessionId);
    this.updateInterest();
  }

  override onDispose(): void {
    this.world?.dispose();
  }

  /** Adds and removes avatars from each client's view so it only receives the ones near it. */
  private updateInterest(): void {
    for (const client of this.clients) {
      const view = client.view;
      const current = this.visible.get(client.sessionId);
      if (!view || !current) continue;
      const next = new Set(visibleFor(client.sessionId, this.state.players));
      for (const id of current) {
        if (next.has(id)) continue;
        const player = this.state.players.get(id);
        if (player) view.remove(player);
        current.delete(id);
      }
      for (const id of next) {
        if (current.has(id)) continue;
        const player = this.state.players.get(id);
        if (player) view.add(player);
        current.add(id);
      }
    }
  }
}

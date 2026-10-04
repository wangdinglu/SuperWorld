import { type AuthContext, type Client, Room } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import {
  createRng,
  INTERACT_RANGE,
  INTERACT_SLACK,
  type Interaction,
  interactionsOf,
  INVENTORY_MAX,
  initPhysics,
  MAX_PROPS,
  PlaceWorld,
  PROP_LIFETIME_S,
  type PropState,
  reachOf,
  seatKey,
  sitOn,
  standUp,
  stepProp,
  throwFrom,
  TICK_RATE,
  wantsToStand,
} from "@superworld/core";
import {
  AdmitMessage,
  AgentMessage,
  type AgentReplyMessage,
  ChatMessage,
  EditMessage,
  EmoteMessage,
  EquipMessage,
  InteractMessage,
  type InventoryMessage,
  JoinOptions,
  MoveInput,
  PLAZA_CAPACITY,
  PlaceState,
  type PlayBroadcast,
  Player,
  Prop,
  PROTOCOL_VERSION,
  ReportMessage,
  TelemetryMessage,
  toCommand,
  type ChatBroadcast,
  type EditResultMessage,
  type EmoteBroadcast,
  type PlaceInfo,
  type ScenePatchBroadcast,
  SpaceId,
  UnequipMessage,
} from "@superworld/protocol";
import type { Scene, Template } from "@superworld/schema";
import type { Content } from "../content.ts";
import {
  addToInventory,
  createReport,
  type Db,
  getPlace,
  getUser,
  type Place,
  touchUser,
} from "@superworld/db";
import type { BuildingAgent } from "../agent.ts";
import type { EditorEvent, SpaceEditor, SpaceEditors } from "../editors.ts";
import type { Knocks } from "../knocks.ts";
import { type Identity, verifyToken } from "../tokens.ts";
import { visibleFor } from "../interest.ts";
import { maskText, RateLimiter } from "../moderation.ts";

export interface PlaceRoomOptions {
  content: Content;
  db: Db;
  editors: SpaceEditors;
  knocks: Knocks;
  /** Live space rooms by place id, so API changes (visibility) reach the room. */
  liveRooms: Map<string, PlaceRoom>;
  /** The AI building agent, when the server has one configured. */
  agent?: BuildingAgent;
  kind: "plaza" | "space";
  /** The plaza's place id (from the world manifest), or the space id from the joining client. */
  placeId?: string;
}

/** Thrown from onAuth when a visitor must knock first; the client shows a knock button. */
export const KNOCK_REQUIRED = "This space is private: knock to ask the owner to let you in";
const SPACE_CAPACITY = 24;

/** Most buffered inputs applied per client per tick: lets a client catch up after jitter, but not run fast. */
const MAX_INPUTS_PER_TICK = 3;
/** State patches per second sent to clients. */
const PATCH_RATE_HZ = 15;
/** Recompute who sees whom every N ticks. */
const INTEREST_EVERY_TICKS = 5;
const RECONNECT_SECONDS = 20;
const STATS_EVERY_TICKS = TICK_RATE * 30;

/**
 * One live instance of a place: the plaza (a shard of it) or a player's space. Runs the shared
 * core at a fixed step; in spaces, the owner edits a live draft that everyone inside sees.
 */
export class PlaceRoom extends Room<{
  state: PlaceState;
  input: MoveInput;
  client: Client<{ auth: Identity }>;
}> {
  override maxClients = PLAZA_CAPACITY;
  override state = new PlaceState();
  override inputs = this.defineInput(MoveInput);

  private world!: PlaceWorld;
  private db!: Db;
  private options!: PlaceRoomOptions;
  private place: Place | undefined;
  private ownerName: string | null = null;
  private editor: SpaceEditor | undefined;
  private scene!: Scene;
  private readonly cleanups: (() => void)[] = [];
  private readonly rng = createRng(Date.now() & 0xffffffff);
  private readonly visible = new Map<string, Set<string>>();
  private readonly chatLimit = new RateLimiter(5, 10_000);
  private readonly emoteLimit = new RateLimiter(2, 2_000);
  private readonly telemetryLimit = new RateLimiter(2, 20_000);
  private readonly interactLimit = new RateLimiter(6, 2_000);
  private readonly throwLimit = new RateLimiter(3, 2_000);
  private templates!: ReadonlyMap<string, Template>;
  /** Velocities and ages of loose items; positions are mirrored into the state for clients. */
  private readonly props = new Map<string, PropState>();
  private nextProp = 1;
  /** Each player's inventory, loaded on join. */
  private readonly inventories = new Map<string, string[]>();
  /** Which note each instrument plays next. */
  private readonly notes = new Map<string, number>();
  private tickCount = 0;
  private stepMs = 0;

  override async onCreate(options: PlaceRoomOptions): Promise<void> {
    this.options = options;
    this.db = options.db;
    await initPhysics();
    if (options.kind === "space") {
      const placeId = SpaceId.parse(options.placeId);
      this.place = await getPlace(this.db, placeId);
      this.editor = await options.editors.get(placeId);
      if (!this.place || this.place.kind !== "space" || !this.editor)
        throw new Error("This space doesn't exist");
      this.ownerName = this.place.ownerId
        ? ((await getUser(this.db, this.place.ownerId))?.displayName ?? null)
        : null;
      this.maxClients = SPACE_CAPACITY;
      options.liveRooms.set(placeId, this);
      this.cleanups.push(() => {
        if (options.liveRooms.get(placeId) === this) options.liveRooms.delete(placeId);
      });
      this.scene = this.editor.scene;
      this.cleanups.push(this.editor.subscribe((event) => this.onEditorEvent(event)));
      this.cleanups.push(
        options.knocks.onKnock(placeId, (userId, name) => {
          for (const c of this.clients) if (this.isOwner(c)) c.send("knock", { userId, name });
        }),
      );
    } else {
      const scene = options.content.scenes[options.placeId ?? ""];
      if (!scene) throw new Error(`No scene for place "${options.placeId}"`);
      this.scene = scene;
    }
    this.world = PlaceWorld.build(this.scene, options.content.templates);
    this.templates = new Map(options.content.templates.templates.map((t) => [t.id, t]));
    this.state.place = this.scene.place;
    this.state.revision = this.scene.revision;
    this.patchRate = 1000 / PATCH_RATE_HZ;
    // setMetadata replaces (Colyseus 0.18): keep the matchmaking filter (placeId) it already holds.
    this.setMetadata({ ...this.metadata, place: this.scene.place, kind: options.kind });

    this.setFixedTimestep((ctx) => {
      const started = performance.now();
      for (const [sessionId, player] of this.state.players) {
        for (const input of this.inputs.get(sessionId).take(MAX_INPUTS_PER_TICK)) {
          const command = toCommand(input);
          if (player.seat) {
            if (!wantsToStand(command)) continue;
            player.seat = "";
            standUp(player);
          }
          this.world.stepAvatar(sessionId, player, command, ctx.dt);
        }
      }
      this.stepProps(ctx.dt);
      if (++this.tickCount % INTEREST_EVERY_TICKS === 0) this.updateInterest();
      this.stepMs += performance.now() - started;
      if (this.tickCount % STATS_EVERY_TICKS === 0) {
        // Telemetry: average step time and load, for the 50-player budget in docs/PROCESS_PLAN.md (M1.6).
        console.log(
          JSON.stringify({
            event: "room-stats",
            room: this.roomId,
            players: this.state.players.size,
            avgStepMs: +(this.stepMs / STATS_EVERY_TICKS).toFixed(3),
          }),
        );
        this.stepMs = 0;
      }
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

    this.onMessage("telemetry", (client, message: unknown) => {
      const parsed = TelemetryMessage.safeParse(message);
      if (!parsed.success || !this.telemetryLimit.allow(client.sessionId)) return;
      console.log(
        JSON.stringify({
          event: "client-telemetry",
          room: this.roomId,
          session: client.sessionId,
          ...parsed.data,
        }),
      );
    });

    this.onMessage("report", (client, message: unknown) => {
      const parsed = ReportMessage.safeParse(message);
      if (!parsed.success) return;
      const target = this.clients.find((c) => c.sessionId === parsed.data.sessionId);
      void createReport(this.db, {
        reporterId: client.auth?.userId ?? null,
        targetUserId: (target?.auth as Identity | undefined)?.userId ?? null,
        room: this.roomId,
        reason: parsed.data.reason,
      }).catch((err) => console.error("report failed", err));
    });

    this.registerEditing();
    this.registerItems();
  }

  /** Sitting, taking, holding, throwing, wearing and playing: one implementation for every template. */
  private registerItems(): void {
    this.onMessage("interact", (client, message: unknown) => {
      const parsed = InteractMessage.safeParse(message);
      const player = this.state.players.get(client.sessionId);
      if (!parsed.success || !player || !this.interactLimit.allow(client.sessionId)) return;
      if ("prop" in parsed.data) return this.pickUp(client, player, parsed.data.prop);
      const instanceId = parsed.data.instance;
      const inst = this.scene.instances.find((i) => i.id === instanceId);
      if (!inst) return;
      let chosen: Interaction | undefined;
      let best = Infinity;
      for (const i of interactionsOf(inst, this.templates)) {
        if (i.kind === "screen" || i.kind === "pickup") continue;
        if (i.kind === "sit" && this.seatTaken(seatKey(i.instance, i.seat))) continue;
        const d = Math.hypot(i.at[0] - player.x, i.at[2] - player.z);
        if (d > reachOf(i, inst, this.templates) + INTERACT_SLACK || d >= best) continue;
        chosen = i;
        best = d;
      }
      if (!chosen) return;
      switch (chosen.kind) {
        case "sit":
          player.seat = seatKey(chosen.instance, chosen.seat);
          sitOn(player, chosen);
          break;
        case "take":
          this.give(client, player, chosen.item);
          break;
        case "play": {
          const n = this.notes.get(inst.id) ?? 0;
          this.notes.set(inst.id, n + 1);
          const payload: PlayBroadcast = {
            sessionId: client.sessionId,
            instance: inst.id,
            sound: chosen.sound,
            note: chosen.notes[n % chosen.notes.length]!,
          };
          this.broadcast("play", payload);
          const anim: EmoteBroadcast = { sessionId: client.sessionId, emote: "play" };
          this.broadcast("emote", anim);
          break;
        }
      }
    });

    this.onMessage("equip", (client, message: unknown) => {
      const parsed = EquipMessage.safeParse(message);
      const player = this.state.players.get(client.sessionId);
      if (!parsed.success || !player) return;
      if (!this.inventories.get(client.sessionId)?.includes(parsed.data.item)) return;
      this.wield(player, parsed.data.item);
    });

    this.onMessage("unequip", (client, message: unknown) => {
      const parsed = UnequipMessage.safeParse(message);
      const player = this.state.players.get(client.sessionId);
      if (parsed.success && player) player[parsed.data.slot] = "";
    });

    this.onMessage("throw", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player?.hand || !this.throwLimit.allow(client.sessionId)) return;
      if (this.templates.get(player.hand)?.item?.use !== "throw") return;
      if (this.props.size >= MAX_PROPS) this.removeProp(this.props.keys().next().value!);
      const id = `p${this.nextProp++}`;
      const sim = throwFrom(player);
      this.props.set(id, sim);
      const prop = new Prop();
      Object.assign(prop, { item: player.hand, x: sim.x, y: sim.y, z: sim.z, resting: false });
      this.state.props.set(id, prop);
      player.hand = "";
      const anim: EmoteBroadcast = { sessionId: client.sessionId, emote: "throw" };
      this.broadcast("emote", anim);
    });
  }

  private seatTaken(key: string): boolean {
    for (const p of this.state.players.values()) if (p.seat === key) return true;
    return false;
  }

  /** Puts an item in its slot: worn items on the head, the rest in the hand. */
  private wield(player: Player, item: string): void {
    const use = this.templates.get(item)?.item?.use;
    if (!use) return;
    player[use === "wear" ? "head" : "hand"] = item;
  }

  /** Gives a player an item: they hold or wear it now, and keep it in their inventory. */
  private give(client: Client, player: Player, item: string): void {
    this.wield(player, item);
    const userId = (client.auth as Identity).userId;
    const local = this.inventories.get(client.sessionId) ?? [];
    this.inventories.set(
      client.sessionId,
      [...local.filter((i) => i !== item), item].slice(-INVENTORY_MAX),
    );
    void addToInventory(this.db, userId, item, INVENTORY_MAX)
      .then((items) => {
        this.inventories.set(client.sessionId, items);
        const payload: InventoryMessage = { items };
        client.send("inventory", payload);
      })
      .catch((err) => console.error("inventory failed", err));
  }

  private pickUp(client: Client, player: Player, propId: string): void {
    const sim = this.props.get(propId);
    const prop = this.state.props.get(propId);
    if (!sim || !prop || !sim.resting) return;
    if (Math.hypot(sim.x - player.x, sim.z - player.z) > INTERACT_RANGE + INTERACT_SLACK) return;
    const item = prop.item;
    this.removeProp(propId);
    this.give(client, player, item);
  }

  private removeProp(id: string): void {
    this.props.delete(id);
    this.state.props.delete(id);
  }

  private stepProps(dt: number): void {
    const radius = this.scene.environment.ground.radius;
    for (const [id, sim] of this.props) {
      const wasResting = sim.resting;
      stepProp(sim, dt, radius);
      if (sim.age > PROP_LIFETIME_S) {
        this.removeProp(id);
        continue;
      }
      if (wasResting) continue;
      const prop = this.state.props.get(id);
      if (!prop) continue;
      prop.x = sim.x;
      prop.y = sim.y;
      prop.z = sim.z;
      prop.resting = sim.resting;
    }
  }

  /** Space owners edit through the shared editor; everyone inside sees each step. */
  private registerEditing(): void {
    const ownerOnly = (client: Client, run: () => void | Promise<void>) => {
      if (!this.editor || !this.isOwner(client)) return;
      void Promise.resolve(run()).catch((err) => console.error("edit failed", err));
    };
    this.onMessage("edit", (client, message: unknown) =>
      ownerOnly(client, () => {
        const parsed = EditMessage.safeParse(message);
        if (!parsed.success) return;
        const result = this.editor!.call(parsed.data.tool, parsed.data.input, "player");
        const reply: EditResultMessage = result.ok
          ? { ok: true, tool: parsed.data.tool, summary: result.summary, output: result.output }
          : { ok: false, tool: parsed.data.tool, error: result.error };
        client.send("edit-result", reply);
      }),
    );
    this.onMessage("undo", (client) => ownerOnly(client, () => void this.editor!.undo()));
    this.onMessage("discard", (client) => ownerOnly(client, () => this.editor!.discard()));
    this.onMessage("save", (client) =>
      ownerOnly(client, async () => {
        await this.editor!.save(client.auth.userId);
      }),
    );
    this.onMessage("agent", (client, message: unknown) =>
      ownerOnly(client, async () => {
        const parsed = AgentMessage.safeParse(message);
        if (!parsed.success) return;
        const agent = this.options.agent;
        if (!agent) {
          const reply: AgentReplyMessage = {
            text: "",
            steps: [],
            error: "The AI builder isn't set up on this server.",
          };
          return void client.send("agent-reply", reply);
        }
        const identity = client.auth as Identity;
        const reply = await agent.run(
          this.editor!,
          { id: identity.userId, kind: identity.kind },
          parsed.data.text,
          (p) => client.send("agent-progress", p),
        );
        client.send("agent-reply", reply);
      }),
    );
    this.onMessage("admit", (client, message: unknown) =>
      ownerOnly(client, () => {
        const parsed = AdmitMessage.safeParse(message);
        if (parsed.success)
          this.options.knocks.answer(this.place!.id, parsed.data.userId, parsed.data.allow);
      }),
    );
  }

  private isOwner(client: Client): boolean {
    return (
      Boolean(this.place?.ownerId) &&
      (client.auth as Identity | undefined)?.userId === this.place?.ownerId
    );
  }

  private placeInfo(): PlaceInfo {
    return {
      id: this.scene.place,
      kind: this.options.kind,
      name: this.place?.name ?? "Plaza",
      ownerId: this.place?.ownerId ?? null,
      ownerName: this.ownerName,
      visibility: this.place?.visibility ?? "public",
      scene: this.scene,
      draftSteps: this.editor?.draftSteps ?? [],
      agentAvailable: Boolean(this.options.agent),
    };
  }

  private onEditorEvent(event: EditorEvent): void {
    this.scene = this.editor!.scene;
    // Anyone sitting on something that was moved or removed stands up.
    for (const player of this.state.players.values()) {
      if (!player.seat) continue;
      const [instance, seat] = player.seat.split("#");
      const inst = this.scene.instances.find((i) => i.id === instance);
      const still =
        inst &&
        interactionsOf(inst, this.templates).find(
          (i) => i.kind === "sit" && i.seat === Number(seat),
        );
      if (still && Math.hypot(still.at[0] - player.x, still.at[2] - player.z) < 0.01) continue;
      player.seat = "";
      standUp(player);
    }
    this.rebuildWorld();
    if (event.type === "patch") {
      const payload: ScenePatchBroadcast = { patch: event.patch, draftSteps: event.draftSteps };
      this.broadcast("scene-patch", payload);
    } else {
      this.state.revision = this.scene.revision;
      this.broadcast("place", this.placeInfo());
    }
  }

  /** Rebuilds colliders after an edit, keeping every avatar where it stands. */
  private rebuildWorld(): void {
    const next = PlaceWorld.build(this.scene, this.options.content.templates);
    for (const [sessionId, player] of this.state.players) next.addAvatar(sessionId, player);
    this.world.dispose();
    this.world = next;
  }

  /** Called by the visibility API so the room enforces the new rule for future joins. */
  async refreshPlace(): Promise<void> {
    if (this.place) {
      this.place = await getPlace(this.db, this.place.id);
      this.broadcast("place", this.placeInfo());
    }
  }

  override async onAuth(
    _client: Client,
    options: unknown,
    context: AuthContext,
  ): Promise<Identity> {
    const parsed = JoinOptions.safeParse(options);
    if (!parsed.success) throw new Error("Invalid join options");
    if (parsed.data.protocol !== PROTOCOL_VERSION)
      throw new Error("Client is out of date: please reload");
    const identity = verifyToken(context.token);
    const user = identity ? await getUser(this.db, identity.userId) : undefined;
    if (!identity || !user) throw new Error("Missing or invalid guest token");
    if (this.place && this.place.ownerId !== user.id && this.place.visibility !== "public") {
      if (!this.options.knocks.hasPass(this.place.id, user.id)) throw new Error(KNOCK_REQUIRED);
    }
    void touchUser(this.db, user.id).catch(() => {});
    // The database is the source of truth for names and colours (they may have changed since the token was issued).
    return { ...identity, kind: user.kind, name: user.displayName, colour: user.colour };
  }

  override async onJoin(client: Client<{ auth: Identity }>): Promise<void> {
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
      seat: "",
      hand: "",
      head: "",
    });
    this.state.players.set(client.sessionId, player);
    this.world.addAvatar(client.sessionId, player);
    client.send("place", this.placeInfo());
    client.view = new StateView();
    this.visible.set(client.sessionId, new Set());
    this.updateInterest();
    const items = ((await getUser(this.db, identity.userId))?.inventory ?? []).filter((i) =>
      this.templates.has(i),
    );
    this.inventories.set(client.sessionId, items);
    const inventory: InventoryMessage = { items };
    client.send("inventory", inventory);
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
    this.telemetryLimit.forget(client.sessionId);
    this.interactLimit.forget(client.sessionId);
    this.throwLimit.forget(client.sessionId);
    this.inventories.delete(client.sessionId);
    this.updateInterest();
  }

  override onDispose(): void {
    for (const c of this.cleanups) c();
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

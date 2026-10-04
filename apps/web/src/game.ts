import { Callbacks, Client, Predict, type Room } from "@colyseus/sdk";
import { initPhysics, PlaceWorld, steerTowards, TICK_RATE } from "@superworld/core";
import {
  type ChatBroadcast,
  type AgentProgressMessage,
  type AgentReplyMessage,
  type EditResultMessage,
  type Emote,
  type EmoteBroadcast,
  type KnockBroadcast,
  MoveInput,
  type PlaceInfo,
  type Player,
  PREDICTED_FIELDS,
  PROTOCOL_VERSION,
  quantiseAxis,
  ROOM,
  type ScenePatchBroadcast,
  toCommand,
} from "@superworld/protocol";
import {
  applyTier,
  Avatar,
  type BuiltPlace,
  buildPlace,
  CameraRig,
  createRenderer,
  detectTier,
  fogFor,
  FrameGovernor,
  skyEnvironment,
  type Tier,
  TIERS,
} from "@superworld/render";
import { Scene, TemplateLibrary, World } from "@superworld/schema";
import { applyPatch, type PatchOp } from "@superworld/sdk";
import { colourOf, LIGHT_RIGS, resolveStyle } from "@superworld/style";
import * as THREE from "three/webgpu";
import plazaJson from "../../../content/world/plaza.scene.json";
import templatesJson from "../../../content/world/templates.json";
import worldJson from "../../../content/world/world.json";
import { avatarEntry, avatarUrl } from "./avatars.ts";
import { serverUrl } from "./config.ts";
import { account } from "./account.ts";
import { InputController } from "./input.ts";
import { save } from "./storage.ts";
import {
  cameraLevel,
  agentBusy,
  agentLog,
  chatLog,
  chatOpen,
  editResult,
  hint,
  knocks,
  muted,
  myAvatar,
  people,
  personKey,
  ping,
  place,
  pushChat,
  renderInfo,
  soloMode,
  status,
  travel,
} from "./store.ts";

const world = World.parse(worldJson);
const templates = TemplateLibrary.parse(templatesJson);
const plazaScene = Scene.parse(plazaJson);

export type Destination = { kind: "plaza" } | { kind: "space"; spaceId: string };

/** Rough radius of a template on the ground, in metres. */
function footprint(templateId: string): number {
  const template = templates.templates.find((t) => t.id === templateId);
  if (!template) return 1.5;
  return Math.max(
    ...template.parts.map((p) => {
      const reach = p.shape === "box" ? Math.hypot(p.size[0], p.size[2]) / 2 : p.radius;
      return Math.hypot(p.at[0], p.at[2]) + reach;
    }),
  );
}

/** Thrown when a private space needs a knock before joining. */
class KnockRequired extends Error {}

const NAME_TAG_DISTANCE = 30;
const BUBBLE_MS = 6000;

interface AvatarView {
  player: Player;
  avatar: Avatar;
  /** Stops listening for this player's avatar changes. */
  unlisten: () => void;
  tag: HTMLDivElement;
  bubble: HTMLDivElement;
  bubbleUntil: number;
  lastPos: THREE.Vector3;
  speed: number;
  yaw: number;
}

/** The running client: renderer, connection, prediction and the frame loop. */
export class Game {
  private renderer!: THREE.WebGPURenderer;
  private readonly three = new THREE.Scene();
  private rig!: CameraRig;
  private input!: InputController;
  private room!: Room;
  private client!: Client;
  private predict: Predict | undefined;
  private physics!: PlaceWorld;
  private built: BuiltPlace | undefined;
  private scene: Scene = plazaScene;
  private profile = { name: "", colour: "", avatar: "" };
  private readonly avatars = new Map<string, AvatarView>();
  private pickables: THREE.Object3D[] = [];
  private tapTarget: { x: number; z: number } | undefined;
  private tapMarker!: THREE.Mesh;
  private governor!: FrameGovernor;
  private tier: Tier = "medium";
  private lastFrame = 0;
  private sunTarget = new THREE.Vector3();
  private sun!: THREE.DirectionalLight;
  private readonly raycaster = new THREE.Raycaster();
  private readonly tagLayer = document.getElementById("tags")!;
  /** What physically based avatar materials reflect: the place's sky. */
  private environment: THREE.Texture | undefined;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /** Starts the game. With no token, runs solo practice entirely in the browser (no server). */
  async start(token: string | null, name: string, colour: string, avatar: string): Promise<void> {
    status.value = "connecting";
    this.tier = detectTier();
    const { renderer, backend } = await createRenderer(this.canvas, this.tier);
    this.renderer = renderer;
    renderInfo.value = { backend, tier: this.tier };
    this.governor = new FrameGovernor(this.tier, (tier) => {
      this.tier = tier;
      applyTier(this.renderer, tier);
      renderInfo.value = { backend, tier };
    });

    this.tapMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    this.tapMarker.visible = false;
    this.three.add(this.tapMarker);

    this.rig = new CameraRig(innerWidth / innerHeight);
    this.resize();
    addEventListener("resize", () => this.resize());

    await initPhysics();
    this.profile = { name, colour, avatar: avatarEntry(avatar).id };

    if (token) {
      this.client = new Client(serverUrl());
      this.client.auth.token = token;
      const spaceId = new URLSearchParams(location.search).get("space");
      if (spaceId) {
        // Opened from a space link: go there; if it's closed, start in the plaza with a knock button.
        try {
          await this.enterPlace({ kind: "space", spaceId });
        } catch (err) {
          if (!(err instanceof KnockRequired)) throw err;
          await this.enterPlace({ kind: "plaza" });
          travel.value = { state: "knock", spaceId, message: err.message };
        }
      } else {
        await this.enterPlace({ kind: "plaza" });
      }
    } else {
      this.showScene(plazaScene);
      this.startSolo(name, colour, avatar);
    }

    this.input = new InputController(this.canvas, {
      onTap: (x, y) => this.tapToMove(x, y),
      onDrag: (dx, dy) => this.rig.orbit(dx, dy),
      onZoom: (d) => {
        this.rig.zoomBy(d);
        cameraLevel.value = this.rig.level;
      },
      onToggleLevel: () => this.toggleLevel(),
      onEmote: (e) => this.emote(e),
      onOpenChat: () => (chatOpen.value = true),
    });

    // Test hook: the authoritative position of my avatar, as the server last sent it.
    (window as unknown as { __superworld: unknown }).__superworld = {
      me: () => {
        const p = this.currentMe();
        return p ? { x: p.x, y: p.y, z: p.z } : undefined;
      },
      inputs: () => this.inputStats(),
      room: () => ({
        id: this.room?.roomId,
        name: this.room?.name,
        players: this.room?.state.players?.size,
      }),
      /** Which avatar each player is shown as, once its model has loaded: name → avatar id. */
      avatars: () =>
        Object.fromEntries(
          [...this.avatars.values()].map((v) => [
            v.player.name,
            v.avatar.shown ? avatarEntry(v.player.avatar).id : "",
          ]),
        ),
    };

    status.value = "playing";
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
    if (!this.solo) {
      setInterval(() => this.measurePing(), 3000);
      setInterval(() => this.sendTelemetry(), 30_000);
    }
  }

  // ---------- places and rooms ----------

  /** Leaves the current room (if any) and enters a place. Throws KnockRequired for closed spaces. */
  async enterPlace(to: Destination): Promise<void> {
    travel.value = { state: "travelling", to: to.kind === "plaza" ? "the plaza" : "the space" };
    const roomName = to.kind === "plaza" ? ROOM.plaza : ROOM.space;
    const options = {
      protocol: PROTOCOL_VERSION,
      name: this.profile.name,
      colour: this.profile.colour,
      avatar: this.profile.avatar,
      ...(to.kind === "space" ? { placeId: to.spaceId } : {}),
    };
    let next: Room;
    try {
      next = await this.client.joinOrCreate(roomName, options);
    } catch (err) {
      travel.value = { state: "idle" };
      const message = err instanceof Error ? err.message : String(err);
      if (/private/i.test(message)) throw new KnockRequired(message);
      throw err;
    }
    this.leaveCurrentRoom();
    this.room = next;
    this.myId = next.sessionId;
    const placeReady = new Promise<void>((resolve) => {
      next.onMessage("place", (info: PlaceInfo) => {
        this.onPlaceInfo(info);
        resolve();
      });
    });
    this.bindRoom();
    await placeReady;
    await this.waitForSelf();
    this.setupPrediction();
    const url = new URL(location.href);
    if (to.kind === "space") url.searchParams.set("space", to.spaceId);
    else url.searchParams.delete("space");
    history.replaceState(null, "", url.toString());
    travel.value = { state: "idle" };
  }

  private leaveCurrentRoom(): void {
    if (!this.room) return;
    const old = this.room;
    old.removeAllListeners();
    void old.leave(true).catch(() => {});
    this.predict?.dispose();
    this.predict = undefined;
    for (const id of [...this.avatars.keys()]) this.removeAvatar(id);
    knocks.value = [];
    editResult.value = null;
    agentLog.value = [];
    agentBusy.value = null;
    chatLog.value = [];
  }

  /** The server says what place this is and which scene to show. */
  private onPlaceInfo(info: PlaceInfo): void {
    const userId = account.value?.user.id;
    place.value = {
      id: info.id,
      kind: info.kind,
      name: info.name,
      ownerName: info.ownerName,
      visibility: info.visibility,
      isOwner: Boolean(userId && info.ownerId === userId),
      draftSteps: info.draftSteps,
      agentAvailable: info.agentAvailable,
    };
    this.showScene(Scene.parse(info.scene));
  }

  /** Builds visuals and local physics for a scene, keeping my avatar where it is. */
  private showScene(next: Scene): void {
    this.scene = next;
    if (this.built) {
      this.three.remove(this.built.root);
      this.built.dispose();
    }
    const style = resolveStyle(world.defaultStyle, next.style);
    this.built = buildPlace(next, templates, style);
    this.three.add(this.built.root);
    this.three.fog = fogFor(style);
    this.pickables = this.built.pickables;
    this.sun = this.built.sun;
    this.sun.castShadow = TIERS[this.tier].shadows === "realtime";
    const rig = LIGHT_RIGS[style.light];
    this.environment = skyEnvironment(rig.skyTop, rig.skyBottom, colourOf("ground", style));

    const physics = PlaceWorld.build(next, templates);
    const me = this.myId ? this.currentMe() : undefined;
    if (me && this.myId) physics.addAvatar(this.myId, me);
    this.physics?.dispose();
    this.physics = physics;
  }

  private bindRoom(): void {
    const callbacks = Callbacks.get(this.room);
    callbacks.onAdd("players", (player, sessionId) =>
      this.addAvatar(String(sessionId), player as Player),
    );
    callbacks.onRemove("players", (_player, sessionId) => this.removeAvatar(String(sessionId)));

    this.room.onMessage("chat", (m: ChatBroadcast) => {
      const view = this.avatars.get(m.sessionId);
      if (view && muted.value.includes(personKey(view.player))) return;
      pushChat({
        sessionId: m.sessionId,
        name: m.name,
        text: m.text,
        mine: m.sessionId === this.myId,
      });
      if (view) {
        view.bubble.textContent = m.text;
        view.bubbleUntil = performance.now() + BUBBLE_MS;
        view.avatar.talk(talkSeconds(m.text));
      }
    });
    this.room.onMessage("emote", (m: EmoteBroadcast) => {
      this.avatars.get(m.sessionId)?.avatar.playEmote(m.emote);
    });
    this.room.onMessage("scene-patch", (m: ScenePatchBroadcast) => {
      this.showScene(applyPatch(this.scene, m.patch as PatchOp[]));
      if (place.value) place.value = { ...place.value, draftSteps: m.draftSteps };
    });
    this.room.onMessage("edit-result", (m: EditResultMessage) => {
      editResult.value = {
        ok: m.ok,
        text: m.ok ? (m.summary ?? "Done") : (m.error ?? "That didn't work"),
      };
    });
    this.room.onMessage("agent-progress", (m: AgentProgressMessage) => {
      agentBusy.value = m;
    });
    this.room.onMessage("agent-reply", (m: AgentReplyMessage) => {
      agentBusy.value = null;
      agentLog.value = [
        ...agentLog.value,
        {
          id: Date.now(),
          from: "ai",
          text: m.error ?? m.text,
          steps: m.steps,
          error: Boolean(m.error),
        },
      ];
    });
    this.room.onMessage("knock", (m: KnockBroadcast) => {
      if (!knocks.value.some((k) => k.userId === m.userId)) knocks.value = [...knocks.value, m];
    });
    this.room.onLeave((code) => {
      if (code !== 1000 && code !== 4000) status.value = "error";
    });
  }

  private waitForSelf(): Promise<void> {
    const room = this.room;
    return new Promise((resolve) => {
      const check = () =>
        room.state.players?.get(room.sessionId) ? resolve() : setTimeout(check, 30);
      check();
    });
  }

  private setupPrediction(): void {
    const me = this.room.state.players.get(this.myId) as Player;
    const myId = this.myId;
    this.physics.addAvatar(myId, me);
    const predict = Predict.get(this.room, { mode: "lerp", delay: 100 });
    this.predict = predict;
    predict.attachAll("players", { x: "lerp", y: "lerp", z: "lerp" });
    const input = this.room.input({ type: MoveInput, mode: "reliable" });
    predict.reconciler(me, {
      input,
      fields: [...PREDICTED_FIELDS],
      // this.physics may be rebuilt by an edit; always step against the current one.
      step: (ctx, state, command) =>
        this.physics.stepAvatar(myId, state, toCommand(command), ctx.dt),
      smoothMs: 80,
    });
    this.inputStats = () => ({ sent: input.sentCount, acked: input.lastProcessed });
    this.sendInput = (move, run, jump) => {
      input.data.moveX = quantiseAxis(move[0]);
      input.data.moveZ = quantiseAxis(move[1]);
      input.data.run = run;
      input.data.jump = jump;
      input.send();
    };
  }

  private inputStats: () => { sent: number; acked: number } = () => ({ sent: 0, acked: 0 });
  private sendInput: (move: [number, number], run: boolean, jump: boolean) => void = () => {};

  // ---------- solo practice (no server) ----------

  private startSolo(name: string, colour: string, avatar: string): void {
    this.solo = true;
    soloMode.value = true;
    this.myId = "solo";
    const [x, y, z] = this.physics.spawnPosition(Math.random(), Math.random());
    const me = {
      x,
      y,
      z,
      vy: 0,
      yaw: Math.PI,
      grounded: true,
      name,
      colour,
      avatar: avatarEntry(avatar).id,
    } as unknown as Player;
    this.soloMe = me;
    this.soloPrev = { x, y, z, yaw: Math.PI };
    this.physics.addAvatar(this.myId, me);
    this.addAvatar(this.myId, me);
    pushChat({
      sessionId: "",
      name: "SuperWorld",
      text: "Solo practice: you're exploring offline. Multiplayer needs the game server.",
      mine: false,
      system: true,
    });
    this.sendInput = (move, run, jump) => {
      const p = this.soloMe!;
      this.soloPrev = { x: p.x, y: p.y, z: p.z, yaw: p.yaw };
      this.physics.stepAvatar(
        this.myId,
        p,
        { moveX: move[0], moveZ: move[1], run, jump },
        1 / TICK_RATE,
      );
      this.soloAlpha = 0;
    };
  }

  private currentMe(): Player | undefined {
    if (this.solo) return this.soloMe;
    return this.room?.state.players?.get(this.myId) as Player | undefined;
  }

  /** Render value of a field: predicted/smoothed online, interpolated between fixed steps in solo. */
  private value(p: Player, field: "x" | "y" | "z" | "yaw"): number {
    if (!this.solo) return this.predict ? this.predict.value(p, field) : p[field];
    if (p !== this.soloMe) return p[field];
    if (field === "yaw") return p.yaw;
    const a = Math.min(1, this.soloAlpha);
    return this.soloPrev[field] + (p[field] - this.soloPrev[field]) * a;
  }

  /** Fixed steps due this frame in solo mode (same cap as the networked path). */
  private soloSteps(dt: number): number {
    this.soloAccumulator += dt;
    const step = 1 / TICK_RATE;
    let n = Math.floor(this.soloAccumulator / step);
    this.soloAccumulator -= n * step;
    if (n > 5) n = 5;
    this.soloAlpha = this.soloAccumulator / step;
    return n;
  }

  private solo = false;
  private myId = "";
  private soloMe: Player | undefined;
  private soloPrev = { x: 0, y: 0, z: 0, yaw: 0 };
  private soloAccumulator = 0;
  private soloAlpha = 0;

  private addAvatar(sessionId: string, player: Player): void {
    if (this.avatars.has(sessionId)) return;
    const avatar = new Avatar(avatarUrl(player.avatar), player.colour, {
      castShadow: TIERS[this.tier].shadows === "realtime",
      environment: this.environment,
    });
    avatar.root.position.set(player.x, player.y, player.z);
    this.three.add(avatar.root);
    if (sessionId === this.myId) myAvatar.value = avatarEntry(player.avatar).id;
    // Online, the server confirms avatar switches through the player's state.
    const unlisten = this.solo
      ? () => {}
      : Callbacks.get(this.room).listen(player, "avatar", (id: string) => {
          avatar.setModel(avatarUrl(id));
          if (sessionId === this.myId) myAvatar.value = avatarEntry(id).id;
        });
    const tag = document.createElement("div");
    tag.className = "tag";
    const label = document.createElement("span");
    label.className = "tag-name";
    label.textContent = player.name;
    label.style.setProperty("--c", player.colour);
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    tag.append(bubble, label);
    if (sessionId === this.myId) tag.classList.add("me");
    this.tagLayer.append(tag);
    this.avatars.set(sessionId, {
      player,
      avatar,
      unlisten,
      tag,
      bubble,
      bubbleUntil: 0,
      lastPos: new THREE.Vector3(player.x, player.y, player.z),
      speed: 0,
      yaw: player.yaw,
    });
    this.refreshPeople();
  }

  private removeAvatar(sessionId: string): void {
    const view = this.avatars.get(sessionId);
    if (!view) return;
    this.three.remove(view.avatar.root);
    view.avatar.dispose();
    view.unlisten();
    view.tag.remove();
    this.avatars.delete(sessionId);
    this.refreshPeople();
  }

  private refreshPeople(): void {
    people.value = [...this.avatars.entries()]
      .filter(([id]) => id !== this.myId)
      .map(([sessionId, v]) => ({ sessionId, name: v.player.name, colour: v.player.colour }));
  }

  // ---------- actions from the UI ----------

  sendChat(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.solo) {
      const me = this.avatars.get(this.myId);
      pushChat({
        sessionId: this.myId,
        name: me?.player.name ?? "You",
        text: trimmed.slice(0, 200),
        mine: true,
      });
      if (me) {
        me.bubble.textContent = trimmed.slice(0, 200);
        me.bubbleUntil = performance.now() + BUBBLE_MS;
        me.avatar.talk(talkSeconds(trimmed));
      }
      return;
    }
    this.room.send("chat", { text: trimmed.slice(0, 200) });
  }

  emote(emote: Emote): void {
    if (this.solo) this.avatars.get(this.myId)?.avatar.playEmote(emote);
    else this.room.send("emote", { emote });
  }

  /** Switches my avatar. Online the server confirms it, and everyone nearby sees the change. */
  switchAvatar(id: string): void {
    const entry = avatarEntry(id);
    save("avatar", entry.id);
    this.profile.avatar = entry.id;
    if (!this.solo) {
      this.room.send("avatar", { avatar: entry.id });
      return;
    }
    const me = this.avatars.get(this.myId);
    if (!me) return;
    me.player.avatar = entry.id;
    me.avatar.setModel(avatarUrl(entry.id));
    myAvatar.value = entry.id;
  }

  report(sessionId: string, reason: string): void {
    if (!this.solo) this.room.send("report", { sessionId, reason });
  }

  // ---------- spaces and building ----------

  goToPlaza(): Promise<void> {
    return this.enterPlace({ kind: "plaza" });
  }

  /** Enters a space; a closed private space switches the travel state to "knock". */
  async goToSpace(spaceId: string): Promise<void> {
    try {
      await this.enterPlace({ kind: "space", spaceId });
    } catch (err) {
      if (err instanceof KnockRequired)
        travel.value = { state: "knock", spaceId, message: err.message };
      else throw err;
    }
  }

  /** Runs one Creator SDK tool on my space's draft. */
  edit(tool: string, input: Record<string, unknown>): void {
    editResult.value = null;
    this.room.send("edit", { tool, input });
  }

  /** Asks the building agent to change my space. */
  askAgent(text: string): void {
    agentLog.value = [...agentLog.value, { id: Date.now(), from: "you", text }];
    agentBusy.value = { state: "thinking" };
    this.room.send("agent", { text });
  }

  undo(): void {
    this.room.send("undo");
  }

  saveDraft(): void {
    this.room.send("save");
  }

  discardDraft(): void {
    this.room.send("discard");
  }

  admit(userId: string, allow: boolean): void {
    this.room.send("admit", { userId, allow });
    knocks.value = knocks.value.filter((k) => k.userId !== userId);
  }

  /** A point on the ground in front of me, far enough that an object of this template doesn't land on me. */
  spotAhead(templateId?: string): { x: number; z: number } {
    const distance = 2.5 + (templateId ? footprint(templateId) : 1.5);
    const me = this.avatars.get(this.myId)?.avatar.root.position;
    const { forward } = this.rig.groundAxes();
    return {
      x: Math.round(((me?.x ?? 0) + forward[0] * distance) * 10) / 10,
      z: Math.round(((me?.z ?? 0) + forward[1] * distance) * 10) / 10,
    };
  }

  /** Objects in the current scene, for the build panel. */
  objects(): { id: string; template: string }[] {
    return this.scene.instances.map((i) => ({ id: i.id, template: i.template }));
  }

  toggleLevel(): void {
    this.rig.setLevel(this.rig.level === "walk" ? "overview" : "walk");
    cameraLevel.value = this.rig.level;
  }

  get controls(): InputController {
    return this.input;
  }

  // ---------- frame ----------

  private tapToMove(clientX: number, clientY: number): void {
    const ndc = new THREE.Vector2((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    if (!hit) return;
    this.tapTarget = { x: hit.point.x, z: hit.point.z };
    this.tapMarker.position.set(hit.point.x, 0.05, hit.point.z);
    this.tapMarker.visible = true;
  }

  private framesSinceReport = 0;
  private lastReport = performance.now();

  /** Playtest telemetry: frame rate, tier, backend, ping and device class. No personal data. */
  private sendTelemetry(): void {
    const now = performance.now();
    const fps = (this.framesSinceReport * 1000) / Math.max(1, now - this.lastReport);
    this.framesSinceReport = 0;
    this.lastReport = now;
    const info = renderInfo.value;
    if (!info || document.hidden) return;
    const touch = matchMedia("(pointer: coarse)").matches;
    const device = !touch
      ? "desktop"
      : Math.min(innerWidth, innerHeight) >= 700
        ? "tablet"
        : "phone";
    this.room.send("telemetry", {
      fps: Math.round(fps * 10) / 10,
      tier: info.tier,
      backend: info.backend,
      rttMs: ping.value,
      device,
      viewport: [innerWidth, innerHeight],
    });
  }

  private frame(now: number): void {
    this.framesSinceReport++;
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    const frameMs = now - this.lastFrame;
    this.lastFrame = now;
    const me = this.currentMe();

    // 1. Input: one send per due fixed step; the reconciler predicts each one.
    const intent = this.input.intent();
    if (intent.active) {
      this.tapTarget = undefined;
      this.tapMarker.visible = false;
    }
    const steps = this.solo ? this.soloSteps(dt) : (this.predict?.tick(now) ?? 0);
    for (let i = 0; i < steps; i++) {
      let move: [number, number] = [0, 0];
      if (intent.active) {
        const { forward, right } = this.rig.groundAxes();
        move = [
          forward[0] * intent.y + right[0] * intent.x,
          forward[1] * intent.y + right[1] * intent.x,
        ];
      } else if (this.tapTarget && me) {
        const x = me.x;
        const z = me.z;
        const s = steerTowards(x, z, this.tapTarget.x, this.tapTarget.z);
        move = [s.moveX, s.moveZ];
        if (s.arrived) {
          this.tapTarget = undefined;
          this.tapMarker.visible = false;
        }
      }
      this.sendInput(move, intent.run, i === 0 && this.input.consumeJump());
    }

    // 2. Avatars: predicted position for me, smoothed positions for everyone else.
    for (const [id, view] of this.avatars) {
      const p = view.player;
      const x = this.value(p, "x");
      const y = this.value(p, "y");
      const z = this.value(p, "z");
      const pos = view.avatar.root.position;
      pos.set(x, y, z);
      const moved = Math.hypot(x - view.lastPos.x, z - view.lastPos.z);
      view.speed += ((dt > 0 ? moved / dt : 0) - view.speed) * Math.min(1, dt * 10);
      view.lastPos.set(x, y, z);
      const targetYaw = id === this.myId ? this.value(p, "yaw") : p.yaw;
      let diff = targetYaw - view.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      view.yaw += diff * Math.min(1, dt * 12);
      view.avatar.root.rotation.y = view.yaw;
      view.avatar.update(dt, view.speed, p.grounded || y < 0.05);
    }

    // 3. Camera, sun and overlays follow my avatar.
    const mine = this.avatars.get(this.myId);
    if (mine) {
      this.rig.update(mine.avatar.root.position, dt);
      this.sunTarget.copy(mine.avatar.root.position);
      this.sun.target.position.copy(this.sunTarget);
      this.sun.position.set(this.sunTarget.x + 18, 60, this.sunTarget.z + 12);
      this.updatePortalHint(mine.avatar.root.position);
    }
    this.updateTags(now);
    this.tapMarker.rotation.y += dt * 2;

    this.renderer.render(this.three, this.rig.camera);
    this.governor.sample(frameMs, now);
  }

  private updateTags(now: number): void {
    const cam = this.rig.camera;
    const v = new THREE.Vector3();
    const overview = this.rig.level === "overview";
    for (const view of this.avatars.values()) {
      v.copy(view.avatar.root.position);
      v.y += view.avatar.height + 0.35;
      const dist = v.distanceTo(cam.position);
      const isMuted = muted.value.includes(personKey(view.player));
      v.project(cam);
      const visible =
        v.z < 1 &&
        Math.abs(v.x) < 1.1 &&
        Math.abs(v.y) < 1.1 &&
        (overview || dist < NAME_TAG_DISTANCE) &&
        !isMuted;
      view.tag.style.display = visible ? "" : "none";
      if (!visible) continue;
      const sx = (v.x * 0.5 + 0.5) * innerWidth;
      const sy = (-v.y * 0.5 + 0.5) * innerHeight;
      view.tag.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
      view.bubble.style.display = now < view.bubbleUntil ? "" : "none";
    }
  }

  private updatePortalHint(pos: THREE.Vector3): void {
    let text = "";
    for (const portal of this.scene.portals) {
      if (Math.hypot(pos.x - portal.at[0], pos.z - portal.at[2]) < 6) {
        const target = world.places.find((p) => p.id === portal.target);
        text = target ? `${portal.label} opens in Phase ${target.phase}` : portal.label;
      }
    }
    if (hint.value !== text) hint.value = text;
  }

  private async measurePing(): Promise<void> {
    if (this.solo || !this.room) return;
    const clock = (this.room as unknown as { clock?: { rtt?: () => number } }).clock;
    const rtt = clock?.rtt?.();
    if (typeof rtt === "number" && Number.isFinite(rtt)) ping.value = Math.round(rtt);
  }

  private resize(): void {
    this.renderer?.setSize(innerWidth, innerHeight, false);
    this.rig?.resize(innerWidth / innerHeight);
  }
}

/** How long the mouth moves for a chat message. */
const talkSeconds = (text: string) => 0.4 + text.length * 0.05;

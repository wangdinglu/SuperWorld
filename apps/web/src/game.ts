import { Callbacks, Client, Predict, type Room } from "@colyseus/sdk";
import { initPhysics, PlaceWorld, steerTowards } from "@superworld/core";
import {
  type ChatBroadcast,
  type Emote,
  type EmoteBroadcast,
  MoveInput,
  type Player,
  PREDICTED_FIELDS,
  PROTOCOL_VERSION,
  quantiseAxis,
  ROOM,
  toCommand,
} from "@superworld/protocol";
import {
  applyTier,
  buildPlace,
  CameraRig,
  createRenderer,
  detectTier,
  fogFor,
  FrameGovernor,
  Mannequin,
  type Tier,
  TIERS,
} from "@superworld/render";
import { Scene, TemplateLibrary, World } from "@superworld/schema";
import { resolveStyle } from "@superworld/style";
import * as THREE from "three/webgpu";
import plazaJson from "../../../content/world/plaza.scene.json";
import templatesJson from "../../../content/world/templates.json";
import worldJson from "../../../content/world/world.json";
import { serverUrl } from "./config.ts";
import { InputController } from "./input.ts";
import {
  cameraLevel,
  chatOpen,
  hint,
  muted,
  people,
  personKey,
  ping,
  pushChat,
  renderInfo,
  status,
} from "./store.ts";

const world = World.parse(worldJson);
const templates = TemplateLibrary.parse(templatesJson);
const scene = Scene.parse(plazaJson);

const NAME_TAG_DISTANCE = 30;
const BUBBLE_MS = 6000;

interface AvatarView {
  player: Player;
  mannequin: Mannequin;
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
  private predict!: Predict;
  private physics!: PlaceWorld;
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

  constructor(private readonly canvas: HTMLCanvasElement) {}

  async start(token: string, name: string, colour: string): Promise<void> {
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

    const style = resolveStyle(world.defaultStyle, scene.style);
    const place = buildPlace(scene, templates, style);
    this.three.add(place.root);
    this.three.fog = fogFor(style);
    this.pickables = place.pickables;
    this.sun = place.sun;
    this.sun.castShadow = TIERS[this.tier].shadows === "realtime";

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
    this.physics = PlaceWorld.build(scene, templates);

    const client = new Client(serverUrl());
    client.auth.token = token;
    this.room = await client.joinOrCreate(ROOM.plaza, { protocol: PROTOCOL_VERSION, name, colour });
    this.bindRoom();
    await this.waitForSelf();
    this.setupPrediction();

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
        const p = this.room.state.players.get(this.room.sessionId) as Player | undefined;
        return p ? { x: p.x, y: p.y, z: p.z } : undefined;
      },
      inputs: () => this.inputStats(),
    };

    status.value = "playing";
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
    setInterval(() => this.measurePing(), 3000);
  }

  // ---------- room ----------

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
        mine: m.sessionId === this.room.sessionId,
      });
      if (view) {
        view.bubble.textContent = m.text;
        view.bubbleUntil = performance.now() + BUBBLE_MS;
      }
    });
    this.room.onMessage("emote", (m: EmoteBroadcast) => {
      this.avatars.get(m.sessionId)?.mannequin.playEmote(m.emote);
    });
    this.room.onLeave((code) => {
      if (code !== 1000) {
        status.value = "error";
      }
    });
  }

  private waitForSelf(): Promise<void> {
    return new Promise((resolve) => {
      const check = () =>
        this.room.state.players?.get(this.room.sessionId) ? resolve() : setTimeout(check, 30);
      check();
    });
  }

  private setupPrediction(): void {
    const me = this.room.state.players.get(this.room.sessionId) as Player;
    const myId = this.room.sessionId;
    this.physics.addAvatar(myId, me);
    this.predict = Predict.get(this.room, { mode: "lerp", delay: 100 });
    this.predict.attachAll("players", { x: "lerp", y: "lerp", z: "lerp" });
    const input = this.room.input({ type: MoveInput, mode: "reliable" });
    this.predict.reconciler(me, {
      input,
      fields: [...PREDICTED_FIELDS],
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

  private addAvatar(sessionId: string, player: Player): void {
    if (this.avatars.has(sessionId)) return;
    const mannequin = new Mannequin(player.colour, TIERS[this.tier].shadows === "realtime");
    mannequin.root.position.set(player.x, player.y, player.z);
    this.three.add(mannequin.root);
    const tag = document.createElement("div");
    tag.className = "tag";
    const label = document.createElement("span");
    label.className = "tag-name";
    label.textContent = player.name;
    label.style.setProperty("--c", player.colour);
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    tag.append(bubble, label);
    if (sessionId === this.room.sessionId) tag.classList.add("me");
    this.tagLayer.append(tag);
    this.avatars.set(sessionId, {
      player,
      mannequin,
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
    this.three.remove(view.mannequin.root);
    view.mannequin.dispose();
    view.tag.remove();
    this.avatars.delete(sessionId);
    this.refreshPeople();
  }

  private refreshPeople(): void {
    people.value = [...this.avatars.entries()]
      .filter(([id]) => id !== this.room.sessionId)
      .map(([sessionId, v]) => ({ sessionId, name: v.player.name, colour: v.player.colour }));
  }

  // ---------- actions from the UI ----------

  sendChat(text: string): void {
    const trimmed = text.trim();
    if (trimmed) this.room.send("chat", { text: trimmed.slice(0, 200) });
  }

  emote(emote: Emote): void {
    this.room.send("emote", { emote });
  }

  report(sessionId: string, reason: string): void {
    this.room.send("report", { sessionId, reason });
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

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    const frameMs = now - this.lastFrame;
    this.lastFrame = now;
    const me = this.room.state.players.get(this.room.sessionId) as Player | undefined;

    // 1. Input: one send per due fixed step; the reconciler predicts each one.
    const intent = this.input.intent();
    if (intent.active) {
      this.tapTarget = undefined;
      this.tapMarker.visible = false;
    }
    const steps = this.predict.tick(now);
    for (let i = 0; i < steps; i++) {
      let move: [number, number] = [0, 0];
      if (intent.active) {
        const { forward, right } = this.rig.groundAxes();
        move = [
          forward[0] * intent.y + right[0] * intent.x,
          forward[1] * intent.y + right[1] * intent.x,
        ];
      } else if (this.tapTarget && me) {
        const x = this.predict.value(me, "x");
        const z = this.predict.value(me, "z");
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
      const x = this.predict.value(p, "x");
      const y = this.predict.value(p, "y");
      const z = this.predict.value(p, "z");
      const pos = view.mannequin.root.position;
      pos.set(x, y, z);
      const moved = Math.hypot(x - view.lastPos.x, z - view.lastPos.z);
      view.speed += ((dt > 0 ? moved / dt : 0) - view.speed) * Math.min(1, dt * 10);
      view.lastPos.set(x, y, z);
      const targetYaw = id === this.room.sessionId ? this.predict.value(p, "yaw") : p.yaw;
      let diff = targetYaw - view.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      view.yaw += diff * Math.min(1, dt * 12);
      view.mannequin.root.rotation.y = view.yaw;
      view.mannequin.update(dt, view.speed, p.grounded || y < 0.05);
    }

    // 3. Camera, sun and overlays follow my avatar.
    const mine = this.avatars.get(this.room.sessionId);
    if (mine) {
      this.rig.update(mine.mannequin.root.position, dt);
      this.sunTarget.copy(mine.mannequin.root.position);
      this.sun.target.position.copy(this.sunTarget);
      this.sun.position.set(this.sunTarget.x + 18, 60, this.sunTarget.z + 12);
      this.updatePortalHint(mine.mannequin.root.position);
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
      v.copy(view.mannequin.root.position);
      v.y += 2.1;
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
    for (const portal of scene.portals) {
      if (Math.hypot(pos.x - portal.at[0], pos.z - portal.at[2]) < 6) {
        const target = world.places.find((p) => p.id === portal.target);
        text = target ? `${portal.label} opens in Phase ${target.phase}` : portal.label;
      }
    }
    if (hint.value !== text) hint.value = text;
  }

  private async measurePing(): Promise<void> {
    if (!this.room) return;
    const clock = (this.room as unknown as { clock?: { rtt?: () => number } }).clock;
    const rtt = clock?.rtt?.();
    if (typeof rtt === "number" && Number.isFinite(rtt)) ping.value = Math.round(rtt);
  }

  private resize(): void {
    this.renderer?.setSize(innerWidth, innerHeight, false);
    this.rig?.resize(innerWidth / innerHeight);
  }
}

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  MToonMaterialLoaderPlugin,
  type VRM,
  type VRMHumanBoneName,
  VRMLoaderPlugin,
  VRMUtils,
} from "@pixiv/three-vrm";
import { MToonNodeMaterial } from "@pixiv/three-vrm/nodes";

export type AvatarEmote = "wave" | "dance" | "cheer" | "sit" | "throw" | "play";

const EMOTE_SECONDS: Record<AvatarEmote, number> = {
  wave: 2.4,
  dance: 4,
  cheer: 2.2,
  sit: 6,
  throw: 0.5,
  play: 0.6,
};
/** Short actions that play through movement instead of being cancelled by it. */
const BRIEF: ReadonlySet<AvatarEmote> = new Set(["throw", "play"]);
/** How far the arms hang from the T-pose, in radians. */
const ARMS_DOWN = 1.15;

const loader = new GLTFLoader();
loader.register(
  (parser) =>
    new VRMLoaderPlugin(parser, {
      // MToon as node materials, so the toon shading runs on both WebGPU and WebGL2.
      mtoonMaterialPlugin: new MToonMaterialLoaderPlugin(parser, {
        materialType: MToonNodeMaterial,
      }),
    }),
);

/** Each file is downloaded once; every avatar using it parses its own copy (own materials, own pose). */
const files = new Map<string, Promise<ArrayBuffer>>();
function download(url: string): Promise<ArrayBuffer> {
  let file = files.get(url);
  if (!file) {
    file = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.arrayBuffer();
    });
    file.catch(() => files.delete(url));
    files.set(url, file);
  }
  return file;
}

const shadowGeometry = new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2);
const shadowMaterial = new THREE.MeshBasicMaterial({
  color: "#000000",
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
});

/** Proportions read from the skeleton when a model loads, for the procedural animation. */
interface Rig {
  hipsY: number;
  /** Hip joint to ankle: how far the hips drop to sit with legs out straight. */
  legDrop: number;
  height: number;
  /** Head bone to the top of the model, where hats sit. */
  headTop: number;
}

/**
 * A player's VRM avatar with procedural animation: idle, walk and run, jump, emotes, blinking
 * and talking. Bones are driven through three-vrm's normalized humanoid rig, so any VRM 1.0 works.
 * The model loads in the background; until then only the blob shadow shows.
 */
export class Avatar {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private vrm: VRM | undefined;
  private rig: Rig = { hipsY: 0.9, legDrop: 0.4, height: 1.6, headTop: 0.2 };
  /** Items follow the hand and head bones; they're children of the avatar, not of the model. */
  private readonly handSlot = new THREE.Group();
  private readonly headSlot = new THREE.Group();
  private seated = false;
  private url = "";
  private loads = 0;
  private phase = 0;
  private emote: { name: AvatarEmote; t: number } | undefined;
  private blinkIn = 2 + Math.random() * 3;
  private blinkT = -1;
  private talkFor = 0;
  private time = Math.random() * 10;

  constructor(
    url: string,
    private colour: string,
    private readonly options: { castShadow?: boolean; environment?: THREE.Texture } = {},
  ) {
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.position.y = 0.03;
    shadow.renderOrder = 1;
    this.root.add(this.body, shadow, this.handSlot, this.headSlot);
    this.setModel(url);
  }

  /** Height of the loaded model (an estimate until it loads), for name tags. */
  get height(): number {
    return this.rig.height;
  }

  /** The URL of the model currently shown, or "" while the first one loads. */
  get shown(): string {
    return this.vrm ? this.url : "";
  }

  /** Switches to another VRM file. The current model stays until the new one is ready. */
  setModel(url: string): void {
    if (url === this.url && (this.vrm || this.loads > 0)) return;
    this.url = url;
    const load = ++this.loads;
    download(url)
      .then((data) => loader.parseAsync(data, ""))
      .then((gltf) => {
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) throw new Error(`${url} is not a VRM file`);
        if (load !== this.loads) return VRMUtils.deepDispose(vrm.scene);
        this.attach(vrm);
      })
      .catch((err) => console.error("Avatar failed to load", err));
  }

  private attach(vrm: VRM): void {
    // VRM 0.x models face −Z; turn them to face +Z like VRM 1.0.
    VRMUtils.rotateVRM0(vrm);
    if (this.vrm) {
      this.body.remove(this.vrm.scene);
      release(this.vrm);
    }
    this.vrm = vrm;
    vrm.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = this.options.castShadow ?? false;
      // Metal and glass need something to reflect; toon materials don't use it.
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const pbr = m as THREE.MeshStandardMaterial;
        if (pbr.isMeshStandardMaterial && this.options.environment) {
          pbr.envMap = this.options.environment;
          pbr.needsUpdate = true;
        }
      }
    });
    const at = (bone: VRMHumanBoneName) =>
      vrm.humanoid.getNormalizedBoneNode(bone)?.getWorldPosition(new THREE.Vector3()).y ?? 0;
    vrm.scene.updateMatrixWorld(true);
    this.rig = {
      hipsY: vrm.humanoid.getNormalizedBoneNode("hips")!.position.y,
      legDrop: Math.max(0, at("leftUpperLeg") - at("leftFoot")),
      height: new THREE.Box3().setFromObject(vrm.scene).max.y,
      headTop: 0,
    };
    this.rig.headTop = Math.max(0.1, this.rig.height - at("head"));
    this.tint();
    this.body.add(vrm.scene);
  }

  /** Recolours the model's "Accent" materials (a scarf, a chest panel) in the player's colour. */
  setColour(colour: string): void {
    this.colour = colour;
    this.tint();
  }

  private tint(): void {
    const colour = new THREE.Color(this.colour);
    this.vrm?.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!m.name.startsWith("Accent")) continue;
        const toon = m as THREE.Material & { color?: THREE.Color; shadeColorFactor?: THREE.Color };
        toon.color?.copy(colour);
        toon.shadeColorFactor?.copy(colour).multiplyScalar(0.7);
      }
    });
  }

  playEmote(name: AvatarEmote): void {
    this.emote = { name, t: 0 };
  }

  /** Holds the seated pose until set back to false. */
  setSeated(seated: boolean): void {
    this.seated = seated;
  }

  /** Puts an object in the right hand (or empties it). The avatar doesn't own or dispose it. */
  setHeld(object: THREE.Object3D | null): void {
    this.handSlot.clear();
    if (object) this.handSlot.add(object);
  }

  /** Puts an object on the head (or takes it off). */
  setWorn(object: THREE.Object3D | null): void {
    this.headSlot.clear();
    if (object) this.headSlot.add(object);
  }

  /** Moves the mouth for a while, as if saying a chat message. */
  talk(seconds: number): void {
    this.talkFor = Math.min(4, seconds);
  }

  /** Animates one frame. `speed` is horizontal m/s; any movement cancels an emote. */
  update(dt: number, speed: number, grounded: boolean): void {
    const vrm = this.vrm;
    if (!vrm) return;
    this.time += dt;
    if ((speed > 0.6 || !grounded) && !(this.emote && BRIEF.has(this.emote.name)))
      this.emote = undefined;

    const h = vrm.humanoid;
    const bone = (name: VRMHumanBoneName) => h.getNormalizedBoneNode(name)!;
    const hips = bone("hips");
    const [legL, legR, kneeL, kneeR] = [
      bone("leftUpperLeg"),
      bone("rightUpperLeg"),
      bone("leftLowerLeg"),
      bone("rightLowerLeg"),
    ];
    const [armL, armR, elbowL, elbowR] = [
      bone("leftUpperArm"),
      bone("rightUpperArm"),
      bone("leftLowerArm"),
      bone("rightLowerArm"),
    ];
    const [spine, head] = [bone("spine"), bone("head")];
    // Chest is optional in VRM; fall back to the spine.
    const chest = h.getNormalizedBoneNode("chest") ?? spine;
    for (const b of [
      legL,
      legR,
      kneeL,
      kneeR,
      armL,
      armR,
      elbowL,
      elbowR,
      spine,
      chest,
      head,
      hips,
    ])
      b.rotation.set(0, 0, 0);
    // Arms hang down; positive z raises the left arm, negative raises the right.
    armL.rotation.z = -ARMS_DOWN;
    armR.rotation.z = ARMS_DOWN;
    hips.position.y = this.rig.hipsY;
    this.body.position.y = 0;

    const ex = vrm.expressionManager;
    const mood = { happy: 0, relaxed: 0, surprised: 0, aa: 0 };
    const sitPose = () => {
      hips.position.y = this.rig.hipsY - this.rig.legDrop;
      legL.rotation.x = legR.rotation.x = -1.45;
      armL.rotation.x = armR.rotation.x = -0.4;
      spine.rotation.x = -0.1;
      mood.relaxed = 1;
    };

    if (this.emote) {
      this.emote.t += dt;
      const t = this.emote.t;
      switch (this.emote.name) {
        case "wave":
          armR.rotation.z = -1.25;
          elbowR.rotation.z = -0.3 + Math.sin(t * 10) * 0.45;
          head.rotation.z = Math.sin(t * 5) * 0.08;
          mood.happy = 1;
          break;
        case "dance":
          hips.rotation.y = Math.sin(t * 6) * 0.4;
          hips.position.y = this.rig.hipsY + Math.abs(Math.sin(t * 6)) * 0.06;
          armL.rotation.z = -0.3 + Math.sin(t * 6) * 0.8;
          armR.rotation.z = 0.3 + Math.sin(t * 6) * 0.8;
          legL.rotation.x = -Math.max(0, Math.sin(t * 6)) * 0.5;
          legR.rotation.x = -Math.max(0, -Math.sin(t * 6)) * 0.5;
          head.rotation.z = Math.sin(t * 6 + 1) * 0.15;
          mood.happy = 1;
          break;
        case "cheer":
          armL.rotation.z = 1.25;
          armR.rotation.z = -1.25;
          this.body.position.y = Math.abs(Math.sin(t * 7)) * 0.22;
          mood.happy = 1;
          mood.aa = 0.6;
          break;
        case "sit":
          sitPose();
          break;
        case "throw": {
          // Wind up over the shoulder, then swing the arm through.
          const k = t / EMOTE_SECONDS.throw;
          armR.rotation.x = k < 0.35 ? -2.8 * (k / 0.35) : -2.8 + (k - 0.35) * 5;
          hips.rotation.y = -0.3 + k * 0.6;
          mood.happy = 1;
          break;
        }
        case "play":
          armR.rotation.x = -1 + Math.sin(t * 20) * 0.35;
          armL.rotation.x = -1 - Math.sin(t * 20) * 0.35;
          mood.happy = 1;
          break;
      }
      if (this.seated && this.emote.name !== "sit") {
        const arms = [armL.rotation.x, armR.rotation.x];
        sitPose();
        [armL.rotation.x, armR.rotation.x] = arms as [number, number];
      }
      if (t > EMOTE_SECONDS[this.emote.name]) this.emote = undefined;
    } else if (this.seated) {
      sitPose();
    } else if (!grounded) {
      legL.rotation.x = -0.6;
      kneeL.rotation.x = 0.7;
      legR.rotation.x = 0.25;
      kneeR.rotation.x = 0.4;
      armL.rotation.z = -0.4;
      armR.rotation.z = 0.4;
      mood.surprised = 0.5;
    } else if (speed > 0.15) {
      this.phase += dt * (3 + speed * 1.4);
      const amp = Math.min(speed / 7.5, 1) * 0.55 + 0.3;
      const s = Math.sin(this.phase);
      legL.rotation.x = s * amp;
      legR.rotation.x = -s * amp;
      // Knees bend as each leg swings back.
      kneeL.rotation.x = Math.max(0, s) * amp * 1.1;
      kneeR.rotation.x = Math.max(0, -s) * amp * 1.1;
      armL.rotation.x = -s * amp * 0.8;
      armR.rotation.x = s * amp * 0.8;
      hips.position.y = this.rig.hipsY + Math.abs(Math.cos(this.phase)) * 0.04;
      spine.rotation.x = Math.min(speed / 7.5, 1) * 0.15;
      hips.rotation.y = s * 0.08;
    } else {
      // Idle: breathe, and sway a little.
      const b = Math.sin(this.time * 1.4);
      chest.rotation.x = b * 0.02;
      armL.rotation.z = -ARMS_DOWN + b * 0.03;
      armR.rotation.z = ARMS_DOWN - b * 0.03;
      head.rotation.y = Math.sin(this.time * 0.37) * 0.12;
      head.rotation.z = Math.sin(this.time * 0.23) * 0.04;
    }

    // Carrying something: the right arm holds it out in front, unless an action moves the arm.
    if (this.handSlot.children.length > 0 && (!this.emote || this.emote.name === "sit"))
      armR.rotation.x = -0.9;

    // Face: moods from what the body is doing, blinking, and a chattering mouth while talking.
    if (ex) {
      for (const [name, value] of Object.entries(mood)) ex.setValue(name, value);
      this.blinkIn -= dt;
      if (this.blinkIn <= 0) {
        this.blinkT = 0;
        this.blinkIn = 2.5 + Math.random() * 3.5;
      }
      let blink = 0;
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        blink = Math.sin(Math.min(1, this.blinkT / 0.16) * Math.PI);
        if (this.blinkT > 0.16) this.blinkT = -1;
      }
      ex.setValue("blink", blink);
      if (this.talkFor > 0) {
        this.talkFor -= dt;
        const t = this.time * 9;
        ex.setValue("aa", Math.max(mood.aa, Math.max(0, Math.sin(t)) * 0.8));
        ex.setValue("oh", Math.max(0, Math.sin(t * 0.6 + 2)) * 0.5);
      } else {
        ex.setValue("oh", 0);
      }
    }
    // three-vrm keeps VRM 0.x normalized bones in the 0.x frame (turned half a turn about Y), where
    // the same pose has x and z rotations negated.
    if (vrm.meta.metaVersion === "0") {
      for (const b of [
        legL,
        legR,
        kneeL,
        kneeR,
        armL,
        armR,
        elbowL,
        elbowR,
        spine,
        chest,
        head,
        hips,
      ])
        b.rotation.set(-b.rotation.x, b.rotation.y, -b.rotation.z);
    }
    vrm.update(dt);
    this.followBones(vrm);
  }

  /** Moves the hand and head slots to where the posed bones are. */
  private followBones(vrm: VRM): void {
    const hand = vrm.humanoid.getRawBoneNode("rightHand");
    const head = vrm.humanoid.getRawBoneNode("head");
    if (this.handSlot.children.length > 0 && hand) {
      hand.getWorldPosition(this.handSlot.position);
      this.root.worldToLocal(this.handSlot.position);
      this.handSlot.position.y -= 0.08;
    }
    if (this.headSlot.children.length > 0 && head) {
      head.getWorldPosition(this.headSlot.position);
      this.root.worldToLocal(this.headSlot.position);
      this.headSlot.position.y += this.rig.headTop * 0.85;
    }
  }

  dispose(): void {
    this.loads++;
    if (this.vrm) release(this.vrm);
    this.vrm = undefined;
  }
}

/** Frees a model's GPU resources, keeping the shared environment texture alive. */
function release(vrm: VRM): void {
  vrm.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial)
        (m as THREE.MeshStandardMaterial).envMap = null;
    }
  });
  VRMUtils.deepDispose(vrm.scene);
}

/**
 * A soft sky-gradient environment, so physically based materials (metal, glass) have something
 * to reflect instead of rendering dark. Toon and soft materials ignore it.
 */
export function skyEnvironment(top: string, horizon: string, ground: string): THREE.DataTexture {
  const w = 32;
  const h = 16;
  const data = new Uint8Array(w * h * 4);
  const cTop = new THREE.Color(top);
  const cHorizon = new THREE.Color(horizon);
  const cGround = new THREE.Color(ground);
  const c = new THREE.Color();
  const rgb = { r: 0, g: 0, b: 0 };
  for (let y = 0; y < h; y++) {
    // Row 0 is the bottom of the image, which equirectangular mapping puts straight down.
    const v = y / (h - 1);
    if (v < 0.5) c.copy(cGround).lerp(cHorizon, Math.pow(v * 2, 3));
    else c.copy(cHorizon).lerp(cTop, Math.pow((v - 0.5) * 2, 0.6));
    c.getRGB(rgb, THREE.SRGBColorSpace);
    for (let x = 0; x < w; x++) {
      data.set([rgb.r * 255, rgb.g * 255, rgb.b * 255, 255], (y * w + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, w, h);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

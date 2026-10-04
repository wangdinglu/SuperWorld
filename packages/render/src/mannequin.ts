import * as THREE from "three/webgpu";

export type MannequinEmote = "wave" | "dance" | "cheer" | "sit" | "throw" | "play";

const EMOTE_SECONDS: Record<MannequinEmote, number> = {
  wave: 2.4,
  dance: 4,
  cheer: 2.2,
  sit: 6,
  throw: 0.5,
  play: 0.6,
};

const skinMaterial = new THREE.MeshLambertMaterial({ color: "#f1d3b8" });
const darkMaterial = new THREE.MeshLambertMaterial({ color: "#2b2f3a" });
const shadowMaterial = new THREE.MeshBasicMaterial({
  color: "#000000",
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
});
const geo = {
  limb: new THREE.CapsuleGeometry(0.09, 0.5, 4, 8).translate(0, -0.3, 0),
  leg: new THREE.CapsuleGeometry(0.11, 0.55, 4, 8).translate(0, -0.36, 0),
  torso: new THREE.CapsuleGeometry(0.24, 0.42, 4, 10),
  head: new THREE.SphereGeometry(0.2, 16, 12),
  nose: new THREE.BoxGeometry(0.06, 0.06, 0.08),
  shadow: new THREE.CircleGeometry(0.45, 20).rotateX(-Math.PI / 2),
};

/**
 * Phase 1 avatar: a procedural mannequin built from primitives, so there are no outside assets
 * and no licence questions. VRM avatars replace it in Phase 2.
 */
export class Mannequin {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly clothes: THREE.MeshLambertMaterial;
  private readonly handSlot = new THREE.Group();
  private readonly headSlot = new THREE.Group();
  private phase = 0;
  private emote: { name: MannequinEmote; t: number } | undefined;
  private seated = false;

  constructor(colour: string, castShadow = false) {
    this.clothes = new THREE.MeshLambertMaterial({ color: colour });
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const o = new THREE.Mesh(g, m);
      o.castShadow = castShadow;
      return o;
    };

    this.hips.position.y = 0.9;
    const torso = mesh(geo.torso, this.clothes);
    torso.position.y = 0.38;
    this.hips.add(torso);

    this.head.position.y = 0.98;
    const headMesh = mesh(geo.head, skinMaterial);
    const nose = mesh(geo.nose, skinMaterial);
    nose.position.set(0, 0, 0.19);
    this.headSlot.position.y = 0.17;
    this.head.add(headMesh, nose, this.headSlot);
    this.hips.add(this.head);

    this.armL.position.set(0.32, 0.66, 0);
    this.armR.position.set(-0.32, 0.66, 0);
    this.armL.add(mesh(geo.limb, this.clothes));
    this.armR.add(mesh(geo.limb, this.clothes));
    this.handSlot.position.set(0, -0.66, 0.04);
    this.armR.add(this.handSlot);
    this.hips.add(this.armL, this.armR);

    this.legL.position.set(0.12, 0, 0);
    this.legR.position.set(-0.12, 0, 0);
    this.legL.add(mesh(geo.leg, darkMaterial));
    this.legR.add(mesh(geo.leg, darkMaterial));
    this.hips.add(this.legL, this.legR);

    this.body.add(this.hips);
    const shadow = new THREE.Mesh(geo.shadow, shadowMaterial);
    shadow.position.y = 0.03;
    shadow.renderOrder = 1;
    this.root.add(this.body, shadow);
  }

  setColour(colour: string): void {
    this.clothes.color.set(colour);
  }

  playEmote(name: MannequinEmote): void {
    this.emote = { name, t: 0 };
  }

  /** Holds the seated pose until set back to false. */
  setSeated(seated: boolean): void {
    this.seated = seated;
  }

  /** Puts an object in the right hand (or empties it). The mannequin doesn't own or dispose it. */
  setHeld(object: THREE.Object3D | null): void {
    this.handSlot.clear();
    if (object) this.handSlot.add(object);
  }

  /** Puts an object on the head (or takes it off). */
  setWorn(object: THREE.Object3D | null): void {
    this.headSlot.clear();
    if (object) this.headSlot.add(object);
  }

  private get holding(): boolean {
    return this.handSlot.children.length > 0;
  }

  /** Animates one frame. `speed` is horizontal m/s; any movement cancels an emote. */
  update(dt: number, speed: number, grounded: boolean): void {
    const brief = this.emote?.name === "throw" || this.emote?.name === "play";
    if ((speed > 0.6 || !grounded) && !brief) this.emote = undefined;
    const reset = (g: THREE.Group) => g.rotation.set(0, 0, 0);
    [this.legL, this.legR, this.armL, this.armR, this.head].forEach(reset);
    this.hips.position.y = 0.9;
    this.hips.rotation.set(0, 0, 0);
    this.body.position.y = 0;
    this.pose(dt, speed, grounded);
    // Carrying something: the right arm holds it out in front, unless an emote moves the arm.
    if (this.holding && (!this.emote || this.emote.name === "sit" || this.seated))
      this.armR.rotation.x = -0.9;
  }

  private sitPose(): void {
    this.hips.position.y = 0.42;
    this.legL.rotation.x = -1.45;
    this.legR.rotation.x = -1.45;
    this.armL.rotation.x = -0.4;
    this.armR.rotation.x = -0.4;
  }

  private pose(dt: number, speed: number, grounded: boolean): void {
    if (this.emote) {
      this.emote.t += dt;
      const t = this.emote.t;
      const done = t > EMOTE_SECONDS[this.emote.name];
      switch (this.emote.name) {
        case "wave":
          this.armR.rotation.z = -2.6;
          this.armR.rotation.x = Math.sin(t * 10) * 0.35;
          this.head.rotation.z = Math.sin(t * 5) * 0.08;
          break;
        case "dance":
          this.hips.rotation.y = Math.sin(t * 6) * 0.4;
          this.hips.position.y = 0.9 + Math.abs(Math.sin(t * 6)) * 0.08;
          this.armL.rotation.z = 1.2 + Math.sin(t * 6) * 0.8;
          this.armR.rotation.z = -1.2 + Math.sin(t * 6) * 0.8;
          this.legL.rotation.x = Math.max(0, Math.sin(t * 6)) * 0.5;
          this.legR.rotation.x = Math.max(0, -Math.sin(t * 6)) * 0.5;
          break;
        case "cheer":
          this.armL.rotation.z = 2.7;
          this.armR.rotation.z = -2.7;
          this.body.position.y = Math.abs(Math.sin(t * 7)) * 0.25;
          break;
        case "sit":
          this.sitPose();
          break;
        case "throw": {
          // Wind up, then swing the arm over.
          const k = t / EMOTE_SECONDS.throw;
          this.armR.rotation.x = k < 0.35 ? -2.8 * (k / 0.35) : -2.8 + (k - 0.35) * 5;
          this.hips.rotation.y = -0.3 + k * 0.6;
          break;
        }
        case "play":
          this.armR.rotation.x = -1.2 + Math.sin(t * 20) * 0.4;
          this.armL.rotation.x = -1.2 - Math.sin(t * 20) * 0.4;
          break;
      }
      if (this.seated && this.emote.name !== "sit") this.sitPose();
      if (done) this.emote = undefined;
      return;
    }

    if (this.seated) {
      this.sitPose();
      return;
    }

    if (!grounded) {
      this.legL.rotation.x = -0.5;
      this.legR.rotation.x = 0.3;
      this.armL.rotation.z = 0.9;
      this.armR.rotation.z = -0.9;
      return;
    }
    if (speed > 0.15) {
      this.phase += dt * (3 + speed * 1.4);
      const amp = Math.min(speed / 7.5, 1) * 0.55 + 0.25;
      const s = Math.sin(this.phase);
      this.legL.rotation.x = s * amp;
      this.legR.rotation.x = -s * amp;
      this.armL.rotation.x = -s * amp * 0.8;
      this.armR.rotation.x = s * amp * 0.8;
      this.hips.position.y = 0.9 + Math.abs(Math.cos(this.phase)) * 0.05;
      this.hips.rotation.x = Math.min(speed / 7.5, 1) * 0.12;
    } else {
      // Idle: breathe.
      const b = Math.sin(performance.now() / 700) * 0.015;
      this.hips.position.y = 0.9 + b;
      this.armL.rotation.z = 0.08;
      this.armR.rotation.z = -0.08;
    }
  }

  dispose(): void {
    this.clothes.dispose();
  }
}

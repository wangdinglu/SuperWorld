import * as THREE from "three/webgpu";

const WALK = { distance: 6.5, pitch: 0.34, lookHeight: 1.3 };
const OVERVIEW = { distance: 44, pitch: 1.0, lookHeight: 0 };
const PITCH_MIN = 0.08;
const PITCH_MAX = 1.35;

/**
 * One camera with a continuous height: 0 is the walk camera behind your avatar, 1 is the
 * overview board where you tap to move. 2D mode (later) is the overview camera kept on.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Orbit angle around the avatar. The camera looks along (sin yaw, cos yaw). */
  yaw = Math.PI;
  /** Extra pitch the player added by dragging vertically, in walk view. */
  private pitchOffset = 0;
  private altitude = 0;
  private targetAltitude = 0;
  private readonly focus = new THREE.Vector3();
  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 900);
  }

  get level(): "walk" | "overview" {
    return this.targetAltitude >= 0.5 ? "overview" : "walk";
  }

  setLevel(level: "walk" | "overview"): void {
    this.targetAltitude = level === "overview" ? 1 : 0;
  }

  /** Pinch or wheel: positive zooms out towards the overview. */
  zoomBy(delta: number): void {
    this.targetAltitude = THREE.MathUtils.clamp(this.targetAltitude + delta, 0, 1);
  }

  /** Drag: horizontal pixels orbit, vertical pixels tilt. */
  orbit(dx: number, dy: number): void {
    this.yaw -= dx * 0.006;
    this.pitchOffset = THREE.MathUtils.clamp(this.pitchOffset + dy * 0.004, -0.25, 0.7);
  }

  /** Unit vectors on the ground for camera-relative movement. */
  groundAxes(): { forward: [number, number]; right: [number, number] } {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    return { forward: [s, c], right: [-c, s] };
  }

  update(target: THREE.Vector3, dt: number): void {
    const k = 1 - Math.exp(-dt * 6);
    this.altitude += (this.targetAltitude - this.altitude) * k;
    const t = this.altitude * this.altitude * (3 - 2 * this.altitude);
    const distance = THREE.MathUtils.lerp(WALK.distance, OVERVIEW.distance, t);
    const pitch = THREE.MathUtils.clamp(THREE.MathUtils.lerp(WALK.pitch + this.pitchOffset, OVERVIEW.pitch, t), PITCH_MIN, PITCH_MAX);
    const lookHeight = THREE.MathUtils.lerp(WALK.lookHeight, OVERVIEW.lookHeight, t);

    const goal = new THREE.Vector3(target.x, target.y + lookHeight, target.z);
    if (!this.initialised) {
      this.focus.copy(goal);
      this.initialised = true;
    } else {
      this.focus.lerp(goal, 1 - Math.exp(-dt * 12));
    }
    const horizontal = Math.cos(pitch) * distance;
    this.camera.position.set(
      this.focus.x - Math.sin(this.yaw) * horizontal,
      Math.max(0.4, this.focus.y + Math.sin(pitch) * distance),
      this.focus.z - Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.focus);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

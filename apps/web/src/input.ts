import type { Emote } from "@superworld/protocol";

export interface InputHandlers {
  /** A short tap or click on the 3D view, in client pixels. */
  onTap(x: number, y: number): void;
  /** Drag on the 3D view, in pixels. */
  onDrag(dx: number, dy: number): void;
  /** Wheel or pinch; positive zooms out. */
  onZoom(delta: number): void;
  onToggleLevel(): void;
  onEmote(emote: Emote): void;
  onOpenChat(): void;
}

const EMOTE_KEYS: Record<string, Emote> = {
  Digit1: "wave",
  Digit2: "dance",
  Digit3: "cheer",
  Digit4: "sit",
};
const TAP_MAX_MOVE = 10;
const TAP_MAX_MS = 350;

/**
 * Turns keyboard, mouse and touch into one intent per frame: a move direction in screen terms
 * (x right, y forward), run, and one-shot jumps. The game converts it to world space.
 */
export class InputController {
  private readonly keys = new Set<string>();
  private stick = { x: 0, y: 0 };
  private jumpQueued = false;
  private runToggle = false;
  private readonly pointers = new Map<
    number,
    { x: number; y: number; startX: number; startY: number; t: number }
  >();
  private pinchDistance = 0;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly surface: HTMLElement,
    private readonly handlers: InputHandlers,
  ) {
    const on = <K extends keyof WindowEventMap>(
      target: Window | HTMLElement,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(window, "keydown", (e) => this.keyDown(e));
    on(window, "keyup", (e) => this.keys.delete(e.code));
    on(window, "blur", () => this.keys.clear());
    on(surface, "pointerdown", (e) => this.pointerDown(e));
    on(window, "pointermove", (e) => this.pointerMove(e));
    on(window, "pointerup", (e) => this.pointerUp(e));
    on(window, "pointercancel", (e) => this.pointers.delete(e.pointerId));
    on(
      surface,
      "wheel",
      (e) => {
        e.preventDefault();
        this.handlers.onZoom(e.deltaY * 0.0012);
      },
      { passive: false },
    );
    on(surface, "contextmenu", (e) => e.preventDefault());
  }

  private typing(e: KeyboardEvent): boolean {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
  }

  private keyDown(e: KeyboardEvent): void {
    if (this.typing(e)) return;
    if (e.code === "Enter") {
      e.preventDefault();
      this.handlers.onOpenChat();
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) this.jumpQueued = true;
    }
    if (e.code === "KeyM" && !e.repeat) this.handlers.onToggleLevel();
    const emote = EMOTE_KEYS[e.code];
    if (emote && !e.repeat) this.handlers.onEmote(emote);
    this.keys.add(e.code);
  }

  private pointerDown(e: PointerEvent): void {
    this.surface.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      t: performance.now(),
    });
    if (this.pointers.size === 2) this.pinchDistance = this.currentPinch();
  }

  private pointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 2) {
      const d = this.currentPinch();
      if (this.pinchDistance > 0) this.handlers.onZoom((this.pinchDistance - d) * 0.004);
      this.pinchDistance = d;
      return;
    }
    if (Math.hypot(p.x - p.startX, p.y - p.startY) > TAP_MAX_MOVE) this.handlers.onDrag(dx, dy);
  }

  private pointerUp(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p || this.pointers.size > 0) return;
    const moved = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
    if (moved <= TAP_MAX_MOVE && performance.now() - p.t <= TAP_MAX_MS)
      this.handlers.onTap(e.clientX, e.clientY);
  }

  private currentPinch(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  /** From the on-screen joystick: x right, y up, length ≤ 1. */
  setStick(x: number, y: number): void {
    this.stick = { x, y };
  }

  queueJump(): void {
    this.jumpQueued = true;
  }

  setRun(on: boolean): void {
    this.runToggle = on;
  }

  /** Screen-relative intent: x right, y forward. */
  intent(): { x: number; y: number; run: boolean; active: boolean } {
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    let x = k("KeyD") + k("ArrowRight") - k("KeyA") - k("ArrowLeft") + this.stick.x;
    let y = k("KeyW") + k("ArrowUp") - k("KeyS") - k("ArrowDown") + this.stick.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    const stickLen = Math.hypot(this.stick.x, this.stick.y);
    const run =
      this.keys.has("ShiftLeft") ||
      this.keys.has("ShiftRight") ||
      this.runToggle ||
      stickLen > 0.92;
    return { x, y, run, active: len > 0.05 };
  }

  consumeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  dispose(): void {
    for (const c of this.cleanup) c();
  }
}

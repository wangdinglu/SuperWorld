import { useRef, useState } from "preact/hooks";

/** Virtual stick for touch screens. Reports x right, y up, length ≤ 1. */
export function Joystick(props: { onChange(x: number, y: number): void }) {
  const base = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const radius = 52;

  const update = (e: PointerEvent) => {
    const rect = base.current!.getBoundingClientRect();
    let dx = e.clientX - (rect.left + rect.width / 2);
    let dy = e.clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > radius) {
      dx = (dx / len) * radius;
      dy = (dy / len) * radius;
    }
    setKnob({ x: dx, y: dy });
    props.onChange(dx / radius, -dy / radius);
  };
  const end = () => {
    pointer.current = null;
    setKnob({ x: 0, y: 0 });
    props.onChange(0, 0);
  };

  return (
    <div
      ref={base}
      class="joystick"
      aria-label="Move"
      onPointerDown={(e) => {
        pointer.current = e.pointerId;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => pointer.current === e.pointerId && update(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div class="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

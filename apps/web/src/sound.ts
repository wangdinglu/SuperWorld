/** Instrument sounds, synthesised with Web Audio so there are no sound files to load. */
let ctx: AudioContext | undefined;

function audio(): AudioContext | undefined {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return undefined;
  }
}

const BASE_HZ: Record<string, number> = { chime: 880, bell: 660, pluck: 330, drum: 110 };

/** Plays one note: `semitones` from the instrument's base pitch, at `volume` (0–1, by distance). */
export function playNote(sound: string, semitones: number, volume = 1): void {
  const ac = audio();
  if (!ac || volume <= 0.01) return;
  const now = ac.currentTime;
  const hz = (BASE_HZ[sound] ?? 440) * Math.pow(2, semitones / 12);
  const gain = ac.createGain();
  gain.connect(ac.destination);
  const osc = ac.createOscillator();
  osc.connect(gain);
  const peak = 0.25 * volume;
  if (sound === "drum") {
    osc.type = "sine";
    osc.frequency.setValueAtTime(hz * 2, now);
    osc.frequency.exponentialRampToValueAtTime(hz, now + 0.12);
    gain.gain.setValueAtTime(peak * 1.6, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.start(now);
    osc.stop(now + 0.4);
    return;
  }
  osc.type = sound === "pluck" ? "triangle" : "sine";
  osc.frequency.setValueAtTime(hz, now);
  const decay = sound === "pluck" ? 0.6 : 1.8;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + decay);
  osc.start(now);
  osc.stop(now + decay + 0.05);
}

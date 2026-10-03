import { signal } from "@preact/signals";
import type { Tier } from "@superworld/render";
import { load, save } from "./storage.ts";

export interface ChatEntry {
  id: number;
  sessionId: string;
  name: string;
  text: string;
  mine: boolean;
  system?: boolean;
}

export interface Person {
  sessionId: string;
  name: string;
  colour: string;
}

export const status = signal<"login" | "connecting" | "playing" | "error">("login");
export const errorMessage = signal("");
export const chatLog = signal<ChatEntry[]>([]);
export const people = signal<Person[]>([]);
export const ping = signal(0);
export const renderInfo = signal<{ backend: "webgpu" | "webgl2"; tier: Tier } | null>(null);
export const cameraLevel = signal<"walk" | "overview">("walk");
export const hint = signal("");
export const chatOpen = signal(false);

/** Locally muted players (by display name + colour, since session ids change on rejoin). */
export const muted = signal<string[]>(load<string[]>("muted", []));
export const personKey = (p: { name: string; colour: string }) => `${p.name}|${p.colour}`;
export function toggleMute(p: Person): void {
  const key = personKey(p);
  muted.value = muted.value.includes(key)
    ? muted.value.filter((k) => k !== key)
    : [...muted.value, key];
  save("muted", muted.value);
}

let nextId = 1;
export function pushChat(entry: Omit<ChatEntry, "id">): void {
  chatLog.value = [...chatLog.value.slice(-49), { ...entry, id: nextId++ }];
}
export const soloMode = signal(false);

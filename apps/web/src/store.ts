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
export const notice = signal("");

/** The place you're in, as the server describes it. */
export interface CurrentPlace {
  id: string;
  kind: "plaza" | "space";
  name: string;
  ownerName: string | null;
  visibility: "public" | "friends" | "private";
  isOwner: boolean;
  draftSteps: string[];
}
export const place = signal<CurrentPlace | null>(null);

/** Travel between places, including knocking on a private space. */
export const travel = signal<
  | { state: "idle" }
  | { state: "travelling"; to: string }
  | { state: "knock"; spaceId: string; message: string }
  | { state: "knocking"; spaceId: string }
  | { state: "denied"; message: string }
>({ state: "idle" });

/** Visitors knocking on my space. */
export const knocks = signal<{ userId: string; name: string }[]>([]);

/** The last Creator SDK result, for the build panel. */
export const editResult = signal<{ ok: boolean; text: string } | null>(null);

import { signal } from "@preact/signals";
import { serverUrl } from "./config.ts";
import { load, save } from "./storage.ts";
import { errorMessage } from "./store.ts";

export interface AccountUser {
  id: string;
  kind: "guest" | "member";
  name: string;
  colour: string;
  email: string | null;
}

interface Session {
  token: string;
  user: AccountUser;
}

/** The signed-in account, remembered on this device so a returning player keeps their account. */
export const account = signal<Session | null>(load<Session | null>("session", null));

function remember(session: Session): Session {
  account.value = session;
  save("session", session);
  save("name", session.user.name);
  save("colour", session.user.colour);
  return session;
}

/** Thrown when the page is hosted somewhere with no game server (e.g. GitHub Pages). */
export class NoServerError extends Error {}

/**
 * Calls the game server's API. Retries for up to a minute while a sleeping free-tier server wakes,
 * and throws NoServerError when the address clearly has no game server.
 */
export async function api(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${serverUrl()}${path}`, {
        method: init.method ?? (init.body ? "POST" : "GET"),
        headers: {
          "content-type": "application/json",
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      });
      const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
      if (res.status === 404 || res.status === 405 || res.status === 501 || (res.ok && !isJson))
        throw new NoServerError();
      if (res.status !== 502 && res.status !== 503 && res.status !== 504) return res;
    } catch (err) {
      if (err instanceof NoServerError) throw err;
      // Network error: the server may be starting.
    }
    if (attempt >= 12) throw new Error("the server didn't answer");
    errorMessage.value = "Waking up the server, this can take up to a minute…";
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `Server said ${res.status}`;
}

/** Signs in with the remembered account (updating name and colour), or creates a guest. */
export async function signIn(name: string, colour: string): Promise<Session> {
  const saved = account.value;
  if (saved) {
    const res = await api("/api/me", {
      method: "PATCH",
      body: { name, colour },
      token: saved.token,
    });
    if (res.ok) return remember((await res.json()) as Session);
    if (res.status !== 401) throw new Error(await errorOf(res));
  }
  const res = await api("/api/guest", { body: { name, colour } });
  if (!res.ok) throw new Error(await errorOf(res));
  return remember((await res.json()) as Session);
}

/** If the page was opened from an emailed sign-in link, completes it. Returns a message to show. */
export async function finishLoginLinkFromUrl(): Promise<string | undefined> {
  const url = new URL(location.href);
  const token = url.searchParams.get("login");
  if (!token) return undefined;
  url.searchParams.delete("login");
  history.replaceState(null, "", url.toString());
  try {
    const res = await api("/api/auth/email/finish", { body: { token } });
    if (!res.ok) return await errorOf(res);
    const session = remember((await res.json()) as Session);
    return `Signed in as ${session.user.email}. Welcome back, ${session.user.name}!`;
  } catch {
    return "Couldn't reach the server to finish signing in.";
  }
}

/** Emails a link that keeps this guest account (or signs in to an existing one). */
export async function requestKeepAccount(email: string): Promise<void> {
  const res = await api("/api/auth/email/start", {
    body: { email },
    ...(account.value ? { token: account.value.token } : {}),
  });
  if (!res.ok) throw new Error(await errorOf(res));
}

export function signOut(): void {
  account.value = null;
  save("session", null);
}

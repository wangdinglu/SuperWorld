/** Where the game server lives. Set VITE_SERVER_URL for split deploys (e.g. client on Cloudflare Pages). */
export function serverUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const fromQuery = new URLSearchParams(location.search).get("server");
  if (fromQuery) return fromQuery.replace(/\/$/, "");
  // Local development: Vite on 5173, game server on 2567.
  if (location.port === "5173" || location.port === "4173") return `${location.protocol}//${location.hostname}:2567`;
  return location.origin;
}

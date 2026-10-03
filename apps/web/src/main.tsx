import { render } from "preact";
import type { Game } from "./game.ts";
import { serverUrl } from "./config.ts";
import { save } from "./storage.ts";
import { errorMessage, status } from "./store.ts";
import { Hud } from "./ui/Hud.tsx";
import { Login } from "./ui/Login.tsx";
import "./styles.css";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
let game: Game | undefined;

async function enter(name: string, colour: string): Promise<void> {
  save("name", name);
  save("colour", colour);
  errorMessage.value = "";
  status.value = "connecting";
  try {
    const res = await requestGuest(name, colour);
    if (!res.ok)
      throw new Error(
        ((await res.json().catch(() => ({}))) as { error?: string }).error ??
          `Server said ${res.status}`,
      );
    const guest = (await res.json()) as { token: string; name: string; colour: string };
    // The 3D engine, physics and netcode load only now, so the sign-in screen appears fast.
    const { Game } = await import("./game.ts");
    game ??= new Game(canvas);
    await game.start(guest.token, guest.name, guest.colour);
  } catch (err) {
    console.error(err);
    status.value = "login";
    errorMessage.value = `Couldn't enter the plaza: ${err instanceof Error ? err.message : String(err)}. Is the server running?`;
  }
}

/** Asks for a guest token. Retries while a sleeping free-tier server wakes up (up to about a minute). */
async function requestGuest(name: string, colour: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${serverUrl()}/api/guest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, colour }),
      });
      if (res.status !== 502 && res.status !== 503 && res.status !== 504) return res;
    } catch {
      // Network error: the server may be starting.
    }
    if (attempt >= 12) throw new Error("the server didn't answer");
    errorMessage.value = "Waking up the server, this can take up to a minute…";
    await new Promise((r) => setTimeout(r, 5000));
  }
}

function App() {
  if (status.value === "playing" && game) return <Hud game={game} />;
  if (status.value === "error") {
    return (
      <div class="login-wrap">
        <div class="card login">
          <h1>Disconnected</h1>
          <p class="lead">The connection to the plaza was lost.</p>
          <button class="primary" onClick={() => location.reload()}>
            Reconnect
          </button>
        </div>
      </div>
    );
  }
  return (
    <Login
      busy={status.value === "connecting"}
      error={errorMessage.value}
      onEnter={(n, c) => void enter(n, c)}
    />
  );
}

render(<App />, document.getElementById("ui")!);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

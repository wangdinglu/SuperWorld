import { render } from "preact";
import type { Game } from "./game.ts";
import { save } from "./storage.ts";
import { finishLoginLinkFromUrl, NoServerError, signIn } from "./account.ts";
import { errorMessage, notice, status } from "./store.ts";
import { Hud } from "./ui/Hud.tsx";
import { Login } from "./ui/Login.tsx";
import "./styles.css";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
let game: Game | undefined;

async function startGame(
  token: string | null,
  name: string,
  colour: string,
  avatar: string,
): Promise<void> {
  // The 3D engine, physics and netcode load only now, so the sign-in screen appears fast.
  const { Game } = await import("./game.ts");
  game ??= new Game(canvas);
  await game.start(token, name, colour, avatar);
}

async function enter(name: string, colour: string, avatar: string, solo = false): Promise<void> {
  save("name", name);
  save("colour", colour);
  save("avatar", avatar);
  errorMessage.value = "";
  status.value = "connecting";
  try {
    if (solo) {
      await startGame(null, name, colour, avatar);
      return;
    }
    const session = await signIn(name, colour);
    await startGame(session.token, session.user.name, session.user.colour, avatar);
  } catch (err) {
    let failure = err;
    if (err instanceof NoServerError) {
      // A static host (e.g. GitHub Pages) with no game server: explore solo instead.
      try {
        await startGame(null, name, colour, avatar);
        return;
      } catch (soloErr) {
        failure = soloErr;
      }
    }
    console.error(failure);
    status.value = "login";
    errorMessage.value = `Couldn't enter the plaza: ${failure instanceof Error ? failure.message : String(failure)}. Please reload and try again.`;
  }
}

// Opened from an emailed sign-in link?
void finishLoginLinkFromUrl().then((message) => {
  if (message) notice.value = message;
});

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
      notice={notice.value}
      onEnter={(n, c, a) => void enter(n, c, a)}
      onSolo={(n, c, a) => void enter(n, c, a, true)}
    />
  );
}

render(<App />, document.getElementById("ui")!);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

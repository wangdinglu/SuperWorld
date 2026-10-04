# SuperWorld

One shared 3D world that opens from a link on any laptop or phone. Phase 1, the walkable plaza, is in progress.

**Try it:** https://wangdinglu.github.io/SuperWorld/ — runs in solo practice mode until a game server is connected (see Deploy).

- **Plan:** [docs/plan/index.html](docs/plan/index.html) (the product plan)
- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Build order and status:** [docs/PROCESS_PLAN.md](docs/PROCESS_PLAN.md)
- **Decisions:** [docs/adr/](docs/adr/)

## Run it locally

Needs Node 22 and pnpm 10 (`corepack enable` gives you pnpm).

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173 in two browser windows (or on your phone, using your computer's local IP address) and walk around together. The game server runs on port 2567.

| Control         | Desktop                                            | Phone                                       |
| --------------- | -------------------------------------------------- | ------------------------------------------- |
| Move            | WASD or arrow keys; click the ground to walk there | Joystick; tap the ground to walk there      |
| Run / jump      | Shift / Space                                      | Push the joystick to the edge / jump button |
| Look            | Drag                                               | Drag with one finger                        |
| Overview camera | M, or scroll                                       | Pinch, or the map button                    |
| Chat            | Enter                                              | Chat button                                 |
| Emotes          | 1–4                                                | Emote button                                |
| Switch avatar   | 🎭 button                                          | 🎭 button                                   |

## Checks

```sh
pnpm check      # lint, package boundaries, formatting, types, content, unit tests
pnpm test:e2e   # two browsers join the plaza (builds first)
pnpm bots 50    # load test: 50 bot players wander a running server
pnpm avatars    # rebuild the VRM avatars in content/avatars (made in code)
pnpm avatars:thumbnails   # re-render their picker thumbnails (headless Chromium)
```

## Repository

```text
apps/web          browser client (Vite, three.js, Preact)
apps/server       game server (Colyseus 0.18); also serves the built client
packages/core     shared movement simulation (Rapier), runs on server and client
packages/schema   content formats (Zod)
packages/protocol network state, inputs and messages
packages/style    style inheritance and palettes
packages/render   three.js scene building, avatars, camera, quality tiers
content/world     the world, templates and plaza scene, as data
content/avatars   VRM 1.0 avatars, one per style, and their library
tools/avatars     the code that builds the avatars
```

## Deploy (free tier)

**Web client on GitHub Pages (automatic).** Every push to `master` rebuilds https://wangdinglu.github.io/SuperWorld/ via `.github/workflows/pages.yml`. With no game server it runs solo practice. To make it multiplayer, deploy the server (below), then set the repository variable `SERVER_URL` to the server's URL (Settings → Secrets and variables → Actions → Variables) and re-run the workflow — or just open the page with `?server=<url>`.

**Everything on Render (simplest).** Render → New → Blueprint → choose this repo. `render.yaml` creates one free web service that runs the game server and serves the client. The free plan sleeps after 15 minutes without visitors; the first visitor waits up to a minute while it wakes (the sign-in screen says so).

**Client on Cloudflare Pages (optional, faster worldwide).** Create a Pages project from this repo with build command `pnpm --filter @superworld/web build`, output directory `apps/web/dist`, and the environment variable `VITE_SERVER_URL` set to your Render URL. Then set `ALLOWED_ORIGINS` on Render to your Pages URL.

## Reading a playtest

The server log (Render → your service → Logs) has one JSON line per event:

- `client-telemetry`: every 30 s per player — frame rate, quality tier, WebGPU or WebGL2, ping, phone/tablet/desktop, screen size.
- `room-stats`: every 30 s per room — players and average server step time (budget: 33 ms).
- `report`: a player pressed Report in the people panel.

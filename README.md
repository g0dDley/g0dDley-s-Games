# ZOMBIES FROM MARS

**Zombies From Mars — Multiplayer Tower Defense - Resistance Vs. Zombies**

A multiplayer, asymmetric tower-defense shooter in the browser, inspired by
*Orcs Must Die* and *Fortnite: Save the World*. Built with Three.js and plain
JavaScript (no build step) over direct-mode WebSockets with a fully
server-authoritative simulation.

Up to **16 players** per room — max **4 Resistance Heroes** defend the
safehouse at the end of a foggy, post-apocalyptic street ("Zombieville");
everyone else plays **Player Zombies** marching with the mindless AI horde.
See [DESIGN.md](DESIGN.md) for the full design brief.

## Run it

```bash
npm install
npm start          # http://localhost:8080  →  pick "SOLO DEMO" and hit PLAY
```

Node 18+ required. The only runtime dependency is `ws` (multiplayer only).

## Modes

- **Solo Demo (offline)** — the default. The authoritative sim runs entirely
  in your browser tab, so it needs **no server and no network** — the lobby is
  instantly filled to 16 with AI bot heroes and bot zombies, and you play
  either side. (`public/js/core.js` is the same sim the Node server runs,
  loaded straight into the page via an in-memory transport in `net.js`.)
- **Multiplayer (online)** — public rooms of up to 16 real players over
  WebSockets, served by `server.js`.

## How a match works

1. **Prep (5:00 max)** — heroes place traps (`E` + scroll) and build
   walls/floors/ramps (`Q` + scroll). Everyone can READY-up (`F`) to start early.
2. **3 rounds** of AI waves. Player Zombies respawn while AI remain, burning
   the shared zombie-lives pool.
3. **Zombies win** by clawing the safehouse barricade to 0 HP (all zombies
   claw automatically once they reach it).
   **Resistance wins** by clearing all AI *and* all player zombies, three rounds in a row.

## Controls

| Key | Resistance | Zombies |
|---|---|---|
| WASD / SPACE / SHIFT | move / jump / sprint | move / jump / sprint |
| Mouse / LMB / RMB | look / fire / aim (ADS) | look / claw / — |
| 1 / 2 / 3 | main / secondary / melee | — |
| R | reload | — |
| E | traps menu (+ scroll) | class special (cooldown) |
| Q | build menu (+ scroll) | lunge → grapple (victim mashes SPACE) |
| F | ready up | ready up |
| TAB / T / V (hold) / ESC | scoreboard / chat / voice / pause | same |

## Deployment

- **Anywhere Node runs**: `PORT=80 node server.js` (Render/Fly/Railway/VPS…).
  WebSockets and static files share one port.
- **Supabase Edge Function** (how the demo is hosted): `npm run build:edge`
  packs the client + sim into a single Deno function; deploy `supabase/functions/game`.
  Note: the edge runtime enforces a per-connection wall-clock limit, so the
  client auto-reconnects mid-match; a dedicated Node host is the smoother option.

## Project layout

```
server.js          Node entry: static file server + WS wrapper
game/core.js       Runtime-agnostic authoritative sim (rooms, AI, traps, combat, bots)
public/            The whole client (ES modules, no build step)
  js/shared.js     Constants shared by client & server
  js/game.js       Engine: controls, prediction, rendering, placement
  js/world.js      Procedural Zombieville map, textures & skybox
  js/models.js     Procedural characters, traps, build pieces
  js/hud.js        HUD, menus, chat, scoreboard
  js/net.js        WebSocket client (auto-reconnect)
  js/voice.js      Push-to-talk voice chat relay
scripts/build-edge.js   Packs everything into a Supabase Edge Function
```

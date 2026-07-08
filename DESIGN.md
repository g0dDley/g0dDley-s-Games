# ZOMBIES FROM MARS — Design Brief

> Studio intake: consolidated from the client's written spec (2026-07-07) and the
> "Zombies Must Die (Zombies from Space)" design document (Google Drive), read in full.
> Working title on the marquee: **Zombies From Mars**.

## 1. Pitch

A multiplayer, asymmetric **tower-defense shooter** in the browser, inspired by
*Orcs Must Die* and *Fortnite: Save the World*. Up to **16 players** per room:
at most **4 Resistance Heroes** defend a boarded-up safehouse full of survivors
at the end of a foggy, post-apocalyptic downtown road ("**Zombieville**");
everyone else plays as **Player Zombies**, marching alongside a mindless AI horde.

## 2. Modes

- **Multiplayer** — public rooms, up to 16 players, locked 4-hero ratio.
- **Solo vs Bots** (client request, 2026-07-07) — a private room instantly
  filled to 16 with bot heroes and bot zombies; the player picks either side.
  Bot heroes place traps, patrol the choke and shoot; bot zombies march,
  lunge-grapple heroes, spit (Belchers) and claw the barricade.

## 3. Match Flow

1. **Prep phase — 5:00 max.** Heroes place traps and build walls/floors/ramps.
   Everyone gets an on-screen READY button; if all players ready-up, the match
   starts early.
2. **3 Rounds** of escalating AI waves. 30s build intermission between rounds.
3. **Zombie team wins** the moment the safehouse's final barricade HP reaches 0
   (all zombies claw it automatically when in reach — persists across rounds).
4. **Resistance wins a round** when every AI zombie is dead **and** every Player
   Zombie is dead. Player Zombies respawn continuously while AI remain; each
   death burns one life from the shared **Zombie Team lives pool**. When the AI
   are gone, respawns stop. Survive all 3 rounds to win the match.

## 4. Teams

### Resistance Heroes (max 4) — from the design doc's Character Class System
| Hero | Archetype | HP | Main weapon | Melee | Trait |
|---|---|---|---|---|---|
| Tommy "Survivalist" | Ranged specialist | 100 | Patriot AR (first-person ADS) | Machete | Headshots ×2.5, extra reserve ammo |
| Tina Mackenzie | Light + mobility | 85 | Ice Breaker shotgun | Barbed hockey stick (bleed) | Fastest sprint |
| Bulldozer Joe | Heavy tank | 150 | Wrecker double-barrel | Giant sledgehammer | Slow but hard to grab (mash bonus) |
| Father Nathan | Faith | 100 | Redemption crossbow (fire bolts → burn) | Censer staff | Balanced |

- **Secondary weapon** chosen at spawn: Pistol / SMG / Sniper / Pump Shotgun.
- Slots: `1` main, `2` secondary, `3` melee. `R` reload.
- RMB aim: slight zoom (pistol/shotguns), true first-person down-sights (AR/sniper).
- Respawn 5s at the safehouse: "Respawning in X.Xs — Killed by <name> (Player|AI)".

### Player Zombies — from the doc's playable Enemy Classes
Cannot be detected by hero systems (no nametags, ignored by auto-turrets),
**vastly increased health**, **60% resistance to trap damage & effects**.

| Class | HP | Speed | E special (cooldown) |
|---|---|---|---|
| Runner (avg civilian) | 300 | fast | Adrenaline — sprint surge |
| Stalker (climber) | 220 | fastest | Leap — huge lunging jump |
| Belcher (ranged) | 380 | slow | Acid Spit — arcing projectile |
| Brute (heavy) | 600 | medium | Charge — knockback dash |

- `Q` **Lunge**: dash; on contact the hero is **grappled** and takes rapid damage —
  the hero mashes SPACE to break free (doc: crawler/grapple mechanic).
- LMB claw damages heroes, traps, buildings and the final barricade.

### AI Horde — from the doc's Enemy Class System
Walkers (light/slow), Runners (light/fast), Brutes (heavy), **Exploders**
(doc: "go straight for barriers" — detonate on structures). They walk the route
like OMD orcs, eat through blocking builds, and claw the final barricade.

## 5. Traps & Building (doc's Trap Ideas + Build Mechanic)

Trap menu `E` + scroll wheel; sell-back at 60%. Coins from kills + round bonuses.
Player Zombies can destroy traps (doc: zombie team can destroy deployed tech).

| Trap | Cost | Effect |
|---|---|---|
| Landmine | 100 | 90 AOE damage, re-arms |
| Bear Trap | 80 | Holds + bleeds a zombie, resets |
| Spike Strip | 120 | Bleed tick + 40% slow (caltrops) |
| Flame Vent | 200 | Cycling burst, ignites (**Burn** status) |
| Auto Turret | 300 | Tracks nearest **AI** (cannot see Player Zombies) |
| Thriller Boombox | 150 | Doc favourite: zombies **can't help dancing** |

Build menu `Q` + scroll wheel: **Wall / Floor-Ceiling / Ramp** (Fortnite-style
wood pieces with HP; zombies chew through what blocks the route).

Statuses implemented from the doc: **Burn** (tick to a cap), **Bleed** (tick),
**Held** (bear trap), **Dance** (boombox — reduced duration on player zombies),
**Slow** (spikes).

## 6. Map — "Zombieville"

One long nighttime downtown road (~280 m), intersections rubble-blocked to keep
the single route, varied procedural buildings either side, wrecked cars, fog,
dim flickering street lights. Safehouse at the end: boarded windows, glowing
barricade door with a fat HP bar, survivor silhouettes inside. All textures and
the night skybox are generated in code (canvas), no external assets.

## 7. UI (English)

- **Main menu**: glowing logo **ZOMBIES FROM MARS**, subtitle *"Multiplayer Tower
  Defense - Resistance Vs. Zombies"*, nickname input (min 2 chars), team/class
  pickers, PLAY, controls hint, version line.
- **HUD**: crosshair, HP bar, coins, trap list + build list with prices, ammo
  counter + weapon name, Q/E cooldown pips, kill feed, score, hit markers,
  barricade HP, zombie-lives pool, round banner, ready button in prep.
- `TAB` scoreboard (PLAYER / KILLS / DEATHS, "(you)" row) · `T` chat with
  join/leave lines · `V` hold-to-talk voice ("MICROPHONE ON", graceful fallback)
  · `ESC` "PAUSED" overlay with controls + BACK TO GAME · death screen **"YOU DED"**.

## 8. Tech

- **Client**: Three.js (vendored, ES modules — no build step), plain JS.
  Client-side prediction for own movement; snapshot interpolation for others.
- **Server**: Node.js `ws`, "direct" socket mode, fully authoritative state
  (players, AI, projectiles, traps, builds, barricade, scores, lives).
  The sim core (`game/core.js`) is runtime-agnostic so the same code runs on
  Node and on the Supabase Edge (Deno) deployment.
- **Protocol**: JSON over WebSocket; voice = opus/webm chunks relayed by server.

## 9. Deliberately out of scope (v1)

Single-player story/endless modes, alien classes & bosses, upgradable
special classes, gadget items, the Cleric/stealth heroes — documented in the
Google Doc and left as the v2 roadmap.

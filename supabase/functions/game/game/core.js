// Runtime-agnostic authoritative game simulation.
// Used by server.js (Node) and the Supabase Edge deployment (Deno).
import {
  ROOM_MAX, MAX_RESISTANCE, PHASE, PREP_TIME, INTERMISSION_TIME, END_TIME, ROUNDS,
  TICK_RATE, MAP, BARRICADE_MAX_HP, START_COINS, ROUND_BONUS, SELL_REFUND,
  HEROES, SECONDARIES, WEAPONS, ZCLASSES, ZOMBIE_TRAP_RESIST,
  LUNGE_CD, LUNGE_TIME, GRAPPLE_DPS_TICK, GRAPPLE_TICK, GRAPPLE_MASH_NEED,
  CLAW_BARRICADE_DMG, AI_KINDS, WAVES, ZLIVES_BASE, ZLIVES_PER_PLAYER,
  TRAPS, BUILDS, BURN, BLEED, RESPAWN_HERO, RESPAWN_ZOMBIE, clamp, dist2,
  ZPOINTS, ZITEMS, ZCLASS_ORDER, RESPAWN_INVULN, TRAP_TIERS, BUILD_TIERS,
} from '../public/js/shared.js';

let nextEntity = 1;
const eid = () => (nextEntity++).toString(36);

function now() { return Date.now() / 1000; }
function rand(a, b) { return a + Math.random() * (b - a); }
function pickRand(arr) { return arr[(Math.random() * arr.length) | 0]; }

// ---- zombie armor helpers ---------------------------------------------------
function newArmor() {
  return { items: {}, helmetHp: 0, shieldHp: 0, shieldMax: 0, energyHp: 0, energyMax: 0,
           sprintMult: 1, lungeCdMult: 1, lastHumanHitT: 0 };
}
// Recompute armor maxes from owned items and refill to full (called on spawn/buy).
function refillArmor(p) {
  const a = p.arm;
  a.helmetMax = 0; a.shieldMax = 0; a.energyMax = 0; a.sprintMult = 1; a.lungeCdMult = 1;
  for (const key of Object.keys(a.items)) {
    const it = ZITEMS[key]; if (!it) continue;
    if (it.helmetHp) a.helmetMax += it.helmetHp;
    if (it.shieldHp) a.shieldMax += it.shieldHp;
    if (it.energyHp) a.energyMax += it.energyHp;
    if (it.sprintMult) a.sprintMult *= it.sprintMult;
    if (it.lungeCdMult) a.lungeCdMult *= it.lungeCdMult;
  }
  a.helmetHp = a.helmetMax; a.shieldHp = a.shieldMax; a.energyHp = a.energyMax;
}
function armorMsg(p) {
  const a = p.arm;
  return { t: 'ev', k: 'armor', helmet: Math.round(a.helmetHp), helmetMax: a.helmetMax | 0,
           shield: Math.round(a.shieldHp), shieldMax: a.shieldMax | 0,
           energy: Math.round(a.energyHp), energyMax: a.energyMax | 0,
           items: Object.keys(a.items) };
}

const BOT_HERO_NAMES = ['Sarge Brick', 'Tex Winchester', 'Doc Hollow', 'Ranger Kate'];
const BOT_ZOMBIE_NAMES = [
  'Brains McGee', 'Rot Rod', 'Gnarly Carl', 'Chompers', 'Moldy Mandy', 'Limpy Lou',
  'Ol\' Gnasher', 'Sludge', 'Patient Zero', 'Crusty Dave', 'Gutz', 'Shuffles',
];

// ---------------------------------------------------------------------------
class Room {
  constructor(hub, id, solo = false) {
    this.hub = hub;
    this.id = id;
    this.solo = solo;
    this.players = new Map();      // pid -> player
    this.ai = new Map();
    this.traps = new Map();
    this.builds = new Map();
    this.projectiles = new Map();
    this.resetMatch();
  }

  resetMatch() {
    this.phase = PHASE.PREP;
    this.phaseEnds = now() + PREP_TIME;
    this.round = 0;
    this.barricadeHp = BARRICADE_MAX_HP;
    this.zlives = 0;
    this.spawnQueue = [];
    this.nextAiSpawn = 0;
    this.ai.clear();
    this.traps.clear();
    this.builds.clear();
    this.projectiles.clear();
    for (const p of this.players.values()) {
      p.coins = START_COINS;
      p.kills = 0; p.deaths = 0; p.score = 0;
      p.ready = !!p.isBot;
      if (p.bot) { p.bot.placed = 0; p.bot.trapT = 0; }
      this.spawnPlayer(p);
    }
  }

  // ---- membership -----------------------------------------------------------
  countTeam(team) {
    let n = 0;
    for (const p of this.players.values()) if (p.team === team) n++;
    return n;
  }

  addPlayer(client, joinMsg) {
    const nick = String(joinMsg.nick || 'Anon').slice(0, 16).trim() || 'Anon';
    let team = joinMsg.team === 'resistance' || joinMsg.team === 'zombie' ? joinMsg.team : 'auto';
    if (team === 'auto') team = this.countTeam('resistance') < MAX_RESISTANCE ? 'resistance' : 'zombie';
    if (team === 'resistance' && this.countTeam('resistance') >= MAX_RESISTANCE) team = 'zombie';

    const p = {
      id: client.id, client, nick, team,
      cls: null, secondary: null,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, anim: 0,
      hp: 100, maxHp: 100, alive: false, deadUntil: 0, killedBy: null,
      coins: START_COINS, kills: 0, deaths: 0, score: 0, ready: false,
      lastFire: 0, lastMelee: 0, lastLunge: -99, lungeUntil: 0, lastSpecial: -99,
      grapple: null,           // hero: {zid, mash} / zombie: {hid}
      lastClaw: 0, lastMoveT: now(),
      speedBoostUntil: 0, statuses: {},
      // zombie progression
      points: ZPOINTS.start, reachedDoor: false, lastPtZ: 0, ptSync: 0,
      arm: newArmor(), invulnUntil: 0,
    };
    if (team === 'resistance') {
      const hk = HEROES[joinMsg.cls] ? joinMsg.cls : 'tommy';
      p.cls = hk;
      p.secondary = SECONDARIES.includes(joinMsg.secondary) ? joinMsg.secondary : 'pistol';
      p.maxHp = HEROES[hk].hp;
    } else {
      // Every player zombie starts as a Walker and upgrades with points in-game.
      p.cls = 'walker';
      p.maxHp = ZCLASSES.walker.hp;
    }
    this.players.set(p.id, p);
    this.spawnPlayer(p);

    client.send({
      t: 'w', id: p.id, room: this.id, team: p.team, cls: p.cls,
      roster: this.rosterList(), traps: this.trapList(), builds: this.buildList(),
      ph: this.phase, tl: Math.max(0, this.phaseEnds - now()), rd: this.round,
      bar: this.barricadeHp, barMax: BARRICADE_MAX_HP, zl: this.zlives,
      pos: [p.x, p.y, p.z],
    });
    this.broadcast({ t: 'ev', k: 'join', id: p.id, nick, team: p.team, cls: p.cls }, p.id);
    if (this.solo && !this.botsAdded) { this.botsAdded = true; this.fillBots(); }
    this.broadcast({ t: 'ev', k: 'roster', roster: this.rosterList() });
    return p;
  }

  removePlayer(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    this.endGrappleFor(p);
    this.players.delete(pid);
    this.broadcast({ t: 'ev', k: 'leave', id: pid, nick: p.nick });
    this.broadcast({ t: 'ev', k: 'roster', roster: this.rosterList() });
  }

  humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot) n++;
    return n;
  }

  // ---- bots (solo mode) -------------------------------------------------------
  addBot(team, cls, nick) {
    const fakeClient = { id: 'bot' + eid(), send() {}, sendRaw() {} };
    const zombie = team !== 'resistance';
    const p = {
      id: fakeClient.id, client: fakeClient, nick, team, isBot: true,
      cls: zombie ? 'walker' : cls, secondary: 'pistol',
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, anim: 0,
      hp: 100, maxHp: 100, alive: false, deadUntil: 0, killedBy: null,
      coins: START_COINS, kills: 0, deaths: 0, score: 0, ready: true,
      lastFire: 0, lastMelee: 0, lastLunge: -99, lungeUntil: 0, lastSpecial: -99,
      grapple: null, lastClaw: 0, lastMoveT: now(),
      speedBoostUntil: 0, statuses: {},
      points: zombie ? rand(200, 900) : 0, reachedDoor: false, lastPtZ: 0, ptSync: 0,
      arm: newArmor(), invulnUntil: 0,
      bot: { wanderT: 0, tx: 0, tz: 0, laneX: rand(-MAP.roadHalfW + 1.5, MAP.roadHalfW - 1.5),
             trapT: 0, placed: 0, wantClass: zombie ? pickRand(['runner', 'stalker', 'belcher', 'brute']) : null, upT: 0 },
    };
    p.maxHp = team === 'resistance' ? HEROES[cls].hp : ZCLASSES[p.cls].hp;
    this.players.set(p.id, p);
    this.spawnPlayer(p);
    return p;
  }

  fillBots() {
    const heroSlots = MAX_RESISTANCE - this.countTeam('resistance');
    const heroKeys = Object.keys(HEROES);
    for (let i = 0; i < heroSlots; i++) {
      const b = this.addBot('resistance', heroKeys[i % heroKeys.length], BOT_HERO_NAMES[i % BOT_HERO_NAMES.length]);
      b.secondary = pickRand(SECONDARIES);
    }
    const zSlots = ROOM_MAX - this.players.size;
    const zKeys = Object.keys(ZCLASSES);
    for (let i = 0; i < zSlots; i++) {
      this.addBot('zombie', zKeys[i % zKeys.length], BOT_ZOMBIE_NAMES[i % BOT_ZOMBIE_NAMES.length]);
    }
    this.broadcast({ t: 'ev', k: 'chat', id: 0, nick: 'SYSTEM', team: 'resistance', text: 'Solo match: lobby filled with bots. Hit READY to start early.' });
  }

  tickBots(t, dt) {
    for (const p of this.players.values()) {
      if (!p.isBot || !p.alive) continue;
      if (p.team === 'resistance') this.tickBotHero(p, t, dt);
      else this.tickBotZombie(p, t, dt);
    }
  }

  tickBotHero(p, t, dt) {
    const b = p.bot;
    const hero = HEROES[p.cls];
    // place traps near the choke whenever there's cash (doc: buy/place any time)
    {
      if (t - b.trapT > 2.5 && p.coins >= 120 && b.placed < 10) {
        b.trapT = t;
        const kinds = ['mine', 'spikes', 'flame', 'turret', 'beartrap', 'boombox'];
        const kind = pickRand(kinds);
        if (p.coins >= TRAPS[kind].cost) {
          this.onPlaceTrap(p, {
            kind,
            x: rand(-MAP.roadHalfW + 1, MAP.roadHalfW - 1),
            z: MAP.doorZ - rand(8, 42),
            rotY: 0,
          });
          b.placed++;
        }
      }
    }
    if (this.phase !== PHASE.COMBAT) return;

    if (p.grapple) { // mash!
      if (Math.random() < 0.5) this.onMash(p);
      return;
    }

    // find target: nearest AI or player zombie within 38m
    let target = null, bd = 38 * 38;
    for (const a of this.ai.values()) {
      if (a.dead) continue;
      const d = dist2(p.x, p.z, a.x, a.z);
      if (d < bd) { bd = d; target = { x: a.x, y: 1.1, z: a.z, ent: a, ai: true }; }
    }
    for (const z of this.players.values()) {
      if (z.team !== 'zombie' || !z.alive) continue;
      const d = dist2(p.x, p.z, z.x, z.z);
      if (d < bd) { bd = d; target = { x: z.x, y: z.y + 1.1, z: z.z, ent: z, ai: false }; }
    }

    const speed = hero.walk;
    if (target) {
      p.yaw = Math.atan2(target.x - p.x, target.z - p.z);
      // keep some distance, back to the door
      const tooClose = bd < 6 * 6;
      const dir = tooClose ? -1 : (bd > 26 * 26 ? 1 : 0);
      if (dir !== 0) {
        const dx = Math.sin(p.yaw) * dir, dz = Math.cos(p.yaw) * dir;
        p.x = clamp(p.x + dx * speed * dt, -MAP.walkHalfW + 1, MAP.walkHalfW - 1);
        p.z = clamp(p.z + dz * speed * dt, MAP.spawnZ + 30, MAP.doorZ - 2);
      }
      // shoot
      const w = WEAPONS[hero.main];
      if (t - p.lastFire > w.rof * 1.6) {
        p.lastFire = t;
        const hitChance = target.ai ? 0.72 : 0.55;
        const o = [p.x, p.y + 1.5, p.z];
        const d = [target.x - p.x, target.y - (p.y + 1.5), target.z - p.z];
        this.broadcast({ t: 'ev', k: 'tracer', id: p.id, o, d, w: hero.main });
        if (Math.random() < hitChance) {
          const dmg = w.dmg * (w.pellets || 1) * 0.8;
          if (target.ai) this.damageAI(target.ent, dmg, p, hero.main);
          else this.damageZombiePlayer(target.ent, dmg, p, hero.main);
        }
      }
    } else {
      // patrol defense zone
      if (t > b.wanderT || dist2(p.x, p.z, b.tx, b.tz) < 2) {
        b.wanderT = t + rand(3, 7);
        b.tx = rand(-9, 9); b.tz = MAP.doorZ - rand(5, 26);
      }
      const dx = b.tx - p.x, dz = b.tz - p.z;
      const dl = Math.hypot(dx, dz) || 1;
      p.yaw = Math.atan2(dx, dz);
      p.x += (dx / dl) * speed * 0.7 * dt;
      p.z += (dz / dl) * speed * 0.7 * dt;
    }
    p.anim = 1;
  }

  tickBotZombie(p, t, dt) {
    if (this.phase !== PHASE.COMBAT) {
      // mill around spawn during prep
      p.anim = 0;
      return;
    }
    const b = p.bot;
    // spend points like a real player: upgrade class first, then grab items
    if (t - b.upT > 3) {
      b.upT = t;
      const want = ZCLASSES[b.wantClass];
      if (p.cls === 'walker' && want && p.points >= want.cost) this.onUpgradeClass(p, { cls: b.wantClass });
      else for (const key of ['helmet', 'shoes', 'lid', 'riot', 'chain', 'energy']) {
        if (!p.arm.items[key] && p.points >= ZITEMS[key].cost && Math.random() < 0.4) { this.onBuyItem(p, { item: key }); break; }
      }
    }
    const zc = ZCLASSES[p.cls];
    if (p.grapple) return; // busy chewing on a hero

    // nearest hero
    let hero = null, hd = 1e9;
    for (const h of this.players.values()) {
      if (h.team !== 'resistance' || !h.alive) continue;
      const d = dist2(p.x, p.z, h.x, h.z);
      if (d < hd) { hd = d; hero = h; }
    }

    // lunge if a hero is close
    if (hero && hd < 10 * 10 && t - p.lastLunge > LUNGE_CD && Math.random() < 0.03) {
      p.lastLunge = t;
      p.lungeUntil = t + LUNGE_TIME;
      this.broadcast({ t: 'ev', k: 'lunge', id: p.id });
    }
    // belcher spit (onSpecial enforces the cooldown)
    if (hero && p.cls === 'belcher' && hd < 30 * 30) {
      const dl = Math.sqrt(hd) || 1;
      this.onSpecial(p, { d: [(hero.x - p.x) / dl, 0.25, (hero.z - p.z) / dl] });
    }

    let speed = zc.walk;
    let txv, tzv;
    if (p.lungeUntil > t && hero) {
      speed = 15;
      const dl = Math.sqrt(hd) || 1;
      txv = (hero.x - p.x) / dl; tzv = (hero.z - p.z) / dl;
    } else if (hero && hd < 14 * 14 && p.cls !== 'belcher') {
      // chase nearby hero
      speed = zc.sprint;
      const dl = Math.sqrt(hd) || 1;
      txv = (hero.x - p.x) / dl; tzv = (hero.z - p.z) / dl;
    } else {
      // march to the barricade
      const wob = Math.sin(t * 0.7 + (p.bot.laneX || 0)) * 0.5;
      const dx = clamp(b.laneX + wob - p.x, -1, 1);
      txv = dx * 0.5; tzv = 1;
    }
    // blocking build? claw it
    let blocking = null;
    for (const bb of this.builds.values()) {
      if (bb.y > 1.5) continue;
      const dz = bb.z - p.z;
      if (dz > 0 && dz < 2.4 && Math.abs(bb.x - p.x) < 2.4) { blocking = bb; break; }
    }
    if (blocking && t - p.lastMelee > 0.6) {
      p.lastMelee = t;
      this.damageBuild(blocking, WEAPONS.claw.dmg);
      this.broadcast({ t: 'ev', k: 'swing', id: p.id });
    } else if (!blocking) {
      p.x = clamp(p.x + txv * speed * dt, -MAP.walkHalfW + 0.6, MAP.walkHalfW - 0.6);
      p.z = clamp(p.z + tzv * speed * dt, MAP.minZ + 1, MAP.doorZ - 1.6);
    }
    p.yaw = Math.atan2(txv, tzv);
    p.anim = 1;

    // grapple contact during lunge
    if (p.lungeUntil > t && hero && dist2(p.x, p.z, hero.x, hero.z) < 1.7 && !hero.grapple) {
      this.startGrapple(p, hero);
    }
    // swipe heroes in reach
    if (hero && hd < 2.4 * 2.4 && t - p.lastMelee > WEAPONS.claw.rof) {
      p.lastMelee = t;
      this.damageHero(hero, WEAPONS.claw.dmg, p, 'claw');
      this.broadcast({ t: 'ev', k: 'swing', id: p.id });
    }
  }

  rosterList() {
    return [...this.players.values()].map(p => ({
      id: p.id, nick: p.nick, team: p.team, cls: p.cls, kills: p.kills, deaths: p.deaths,
      score: p.score, ready: p.ready,
    }));
  }
  trapList() {
    return [...this.traps.values()].map(t => ({ id: t.id, kind: t.kind, x: t.x, z: t.z, rotY: t.rotY, hp: t.hp, owner: t.owner, tier: t.tier || 1 }));
  }
  buildList() {
    return [...this.builds.values()].map(b => ({ id: b.id, kind: b.kind, x: b.x, y: b.y, z: b.z, rotY: b.rotY, hp: b.hp, tier: b.tier || 1 }));
  }

  spawnPlayer(p) {
    p.alive = true;
    if (p.team === 'zombie') p.maxHp = ZCLASSES[p.cls].hp;   // reflect any class upgrade
    p.hp = p.maxHp;
    p.statuses = {};
    p.grapple = null;
    p.invulnUntil = now() + RESPAWN_INVULN;                  // brief spawn protection
    if (p.team === 'resistance') {
      // heroes respawn up on the fire-escape balcony beside the safehouse door
      p.x = rand(-7, 7); p.y = 0; p.z = MAP.doorZ - rand(5, 9); p.yaw = 0; // face down the road
    } else {
      p.x = rand(-8, 8); p.y = 0; p.z = MAP.spawnZ + rand(0, 8); p.yaw = Math.PI; // face the safehouse
      refillArmor(p);
      p.lastPtZ = p.z; p.reachedDoor = false;
      p.client.send(armorMsg(p));
      p.client.send({ t: 'ev', k: 'zpts', pts: Math.floor(p.points), cls: p.cls });
    }
    p.client.send({ t: 'ev', k: 'spawn', pos: [p.x, p.y, p.z], yaw: p.yaw, hp: p.hp, invuln: RESPAWN_INVULN });
  }

  broadcast(msg, exceptId) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.id !== exceptId) p.client.sendRaw(s);
    }
  }

  // ---- phases ---------------------------------------------------------------
  setPhase(phase, dur) {
    this.phase = phase;
    this.phaseEnds = now() + dur;
    this.broadcast({ t: 'ev', k: 'phase', ph: phase, tl: dur, rd: this.round });
  }

  startRound() {
    this.round++;
    const heroes = Math.max(1, this.countTeam('resistance'));
    const scale = 0.75 + 0.25 * heroes;
    const table = WAVES[Math.min(this.round, ROUNDS) - 1];
    this.spawnQueue = [];
    for (const [kind, count] of Object.entries(table)) {
      for (let i = 0; i < Math.round(count * scale); i++) this.spawnQueue.push(kind);
    }
    // shuffle
    for (let i = this.spawnQueue.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [this.spawnQueue[i], this.spawnQueue[j]] = [this.spawnQueue[j], this.spawnQueue[i]];
    }
    let humanZ = 0, botZ = 0;
    for (const p of this.players.values()) if (p.team === 'zombie') (p.isBot ? botZ++ : humanZ++);
    this.zlives = ZLIVES_BASE + ZLIVES_PER_PLAYER * humanZ + 2 * botZ;
    this.nextAiSpawn = now() + 2;
    for (const p of this.players.values()) { p.ready = !!p.isBot; if (!p.alive) this.spawnPlayer(p); }
    this.setPhase(PHASE.COMBAT, 9999);
    this.broadcast({ t: 'ev', k: 'round', rd: this.round, total: ROUNDS, zl: this.zlives });
  }

  endMatch(winner, reason) {
    this.setPhase(PHASE.END, END_TIME);
    this.broadcast({ t: 'ev', k: 'gameOver', winner, reason });
  }

  allReady() {
    if (this.players.size === 0) return false;
    for (const p of this.players.values()) if (!p.ready) return false;
    return true;
  }

  // ---- messages ---------------------------------------------------------------
  onMessage(p, m) {
    switch (m.t) {
      case 'in': this.onInput(p, m); break;
      case 'fire': this.onFire(p, m); break;
      case 'melee': this.onMelee(p, m); break;
      case 'place': this.onPlaceTrap(p, m); break;
      case 'build': this.onBuild(p, m); break;
      case 'sell': this.onSell(p, m); break;
      case 'lunge': this.onLunge(p, m); break;
      case 'special': this.onSpecial(p, m); break;
      case 'mash': this.onMash(p); break;
      case 'ready': this.onReady(p); break;
      case 'chat': this.onChat(p, m); break;
      case 'voice': this.onVoice(p, m); break;
      case 'upClass': this.onUpgradeClass(p, m); break;
      case 'buyItem': this.onBuyItem(p, m); break;
      case 'upBuild': this.onUpgradeBuild(p, m); break;
      case 'upTrap': this.onUpgradeTrap(p, m); break;
    }
  }

  // ---- zombie progression ---------------------------------------------------
  addPoints(p, n) {
    if (p.team !== 'zombie' || n <= 0) return;
    p.points += n;
    const t = now();
    if (t - p.ptSync > 0.4 || n >= 100) {   // throttle the HUD sync, but push kills instantly
      p.ptSync = t;
      p.client.send({ t: 'ev', k: 'zpts', pts: Math.floor(p.points), cls: p.cls });
    }
  }

  onUpgradeClass(p, m) {
    if (p.team !== 'zombie') return;
    const key = String(m.cls);
    const spec = ZCLASSES[key];
    if (!spec || key === p.cls) return;
    if (p.points < spec.cost) return;
    p.points -= spec.cost;
    p.cls = key;
    p.maxHp = spec.hp;
    if (p.alive) { p.hp = Math.min(p.hp + (spec.hp - p.hp) * 0.5 + 60, spec.hp); }  // partial heal on upgrade
    p.client.send({ t: 'ev', k: 'upgraded', cls: key, pts: Math.floor(p.points), hp: Math.round(p.hp), maxHp: spec.hp });
    this.broadcast({ t: 'ev', k: 'reclass', id: p.id, cls: key }, p.id);
    this.broadcast({ t: 'ev', k: 'roster', roster: this.rosterList() });
  }

  onBuyItem(p, m) {
    if (p.team !== 'zombie') return;
    const key = String(m.item);
    const it = ZITEMS[key];
    if (!it || p.arm.items[key]) return;   // one of each
    if (p.points < it.cost) return;
    p.points -= it.cost;
    p.arm.items[key] = true;
    refillArmor(p);
    p.client.send({ t: 'ev', k: 'zpts', pts: Math.floor(p.points), cls: p.cls });
    p.client.send(armorMsg(p));
    this.broadcast({ t: 'ev', k: 'reitem', id: p.id, items: Object.keys(p.arm.items) }, p.id);
  }

  onUpgradeBuild(p, m) {
    if (p.team !== 'resistance' || !p.alive) return;
    const b = this.builds.get(m.id);
    if (!b) return;
    const nextTier = (b.tier || 1);
    if (nextTier >= BUILD_TIERS.length) return;   // already max
    const spec = BUILD_TIERS[nextTier];           // cost to reach tier index+1
    if (p.coins < spec.cost) return;
    p.coins -= spec.cost;
    b.tier = nextTier + 1;
    const baseHp = BUILDS[b.kind].hp;
    const mult = BUILD_TIERS[b.tier - 1].hpMult;
    b.maxHp = Math.round(baseHp * mult);
    b.hp = b.maxHp;
    this.broadcast({ t: 'ev', k: 'buildTier', id: b.id, tier: b.tier, hp: b.hp });
    p.client.send({ t: 'ev', k: 'coins', coins: p.coins });
  }

  onUpgradeTrap(p, m) {
    if (p.team !== 'resistance' || !p.alive) return;
    const tr = this.traps.get(m.id);
    if (!tr) return;
    const nextTier = (tr.tier || 1);
    if (nextTier >= TRAP_TIERS.length) return;
    const spec = TRAP_TIERS[nextTier];
    if (p.coins < spec.cost) return;
    p.coins -= spec.cost;
    tr.tier = nextTier + 1;
    const base = TRAPS[tr.kind];
    tr.maxHp = Math.round(base.hp * TRAP_TIERS[tr.tier - 1].hpMult);
    tr.hp = tr.maxHp;
    this.broadcast({ t: 'ev', k: 'trapTier', id: tr.id, tier: tr.tier, hp: tr.hp });
    p.client.send({ t: 'ev', k: 'coins', coins: p.coins });
  }

  onInput(p, m) {
    if (!p.alive) return;
    if (p.grapple && p.team === 'resistance') { p.yaw = +m.yaw || 0; return; } // held: no movement
    const t = now();
    const dt = Math.min(0.5, t - p.lastMoveT);
    p.lastMoveT = t;
    const base = p.team === 'resistance' ? HEROES[p.cls] : ZCLASSES[p.cls];
    let maxSpeed = base.sprint * (t < p.speedBoostUntil ? 1.6 : 1) * (p.arm ? p.arm.sprintMult : 1);
    if (p.lungeUntil > t) maxSpeed = Math.max(maxSpeed, 18);
    if (p.statuses.charge && p.statuses.charge > t) maxSpeed = Math.max(maxSpeed, 20);
    const nx = clamp(+m.x || 0, -MAP.walkHalfW - 14, MAP.walkHalfW + 14);
    const nz = clamp(+m.z || 0, MAP.minZ, MAP.maxZ);
    const ny = clamp(+m.y || 0, 0, 40);
    const d = Math.sqrt(dist2(p.x, p.z, nx, nz));
    if (d <= maxSpeed * dt * 1.8 + 0.6) { p.x = nx; p.z = nz; p.y = ny; }
    else { // too fast: pull toward target at max speed (soft correction)
      const f = (maxSpeed * dt * 1.8) / (d || 1);
      p.x += (nx - p.x) * f; p.z += (nz - p.z) * f; p.y = ny;
    }
    p.yaw = +m.yaw || 0; p.pitch = +m.pitch || 0; p.anim = m.a | 0;

    // zombie lunge contact check
    if (p.team === 'zombie' && p.lungeUntil > t && !p.grapple) {
      for (const h of this.players.values()) {
        if (h.team !== 'resistance' || !h.alive || h.grapple) continue;
        if (dist2(p.x, p.z, h.x, h.z) < 1.7 && Math.abs(p.y - h.y) < 1.6) {
          this.startGrapple(p, h);
          break;
        }
      }
    }
    // brute charge contact
    if (p.team === 'zombie' && p.statuses.charge && p.statuses.charge > t) {
      for (const h of this.players.values()) {
        if (h.team !== 'resistance' || !h.alive) continue;
        if (dist2(p.x, p.z, h.x, h.z) < 2.2 && !h.statuses['chargeHit' + p.id]) {
          h.statuses['chargeHit' + p.id] = t + 1;
          this.damageHero(h, 30, p, 'charge');
          h.client.send({ t: 'ev', k: 'knockback', dir: [h.x - p.x, 0.5, h.z - p.z] });
        }
      }
    }
  }

  startGrapple(z, h) {
    if (this.phase !== PHASE.COMBAT) return;
    z.grapple = { hid: h.id };
    h.grapple = { zid: z.id, mash: 0, nextTick: now() + GRAPPLE_TICK };
    this.broadcast({ t: 'ev', k: 'grapple', z: z.id, h: h.id });
  }
  endGrapple(z, h, escaped) {
    if (z) z.grapple = null;
    if (h) h.grapple = null;
    this.broadcast({ t: 'ev', k: 'grappleEnd', z: z ? z.id : 0, h: h ? h.id : 0, escaped: !!escaped });
  }
  endGrappleFor(p) {
    if (!p.grapple) return;
    if (p.team === 'zombie') {
      const h = this.players.get(p.grapple.hid);
      this.endGrapple(p, h, false);
    } else {
      const z = this.players.get(p.grapple.zid);
      this.endGrapple(z, p, false);
    }
  }

  onMash(p) {
    if (!p.grapple || p.team !== 'resistance') return;
    const bonus = p.cls === 'joe' ? 1.5 : 1;
    p.grapple.mash += bonus;
    if (p.grapple.mash >= GRAPPLE_MASH_NEED) {
      const z = this.players.get(p.grapple.zid);
      this.endGrapple(z, p, true);
    }
  }

  onLunge(p, m) {
    if (p.team !== 'zombie' || !p.alive || this.phase !== PHASE.COMBAT) return;
    const t = now();
    if (t - p.lastLunge < LUNGE_CD * (p.arm ? p.arm.lungeCdMult : 1)) return;
    p.lastLunge = t;
    p.lungeUntil = t + LUNGE_TIME;
    this.broadcast({ t: 'ev', k: 'lunge', id: p.id });
  }

  onSpecial(p, m) {
    if (p.team !== 'zombie' || !p.alive || this.phase !== PHASE.COMBAT) return;
    const zc = ZCLASSES[p.cls];
    const t = now();
    if (t - p.lastSpecial < zc.specialCd) return;
    p.lastSpecial = t;
    const d = Array.isArray(m.d) ? m.d.map(Number) : [0, 0, 1];
    switch (zc.special) {
      case 'adrenaline': p.speedBoostUntil = t + 3; break;
      case 'leap': break; // movement handled client-side; event animates it
      case 'charge': p.statuses.charge = t + 0.9; break;
      case 'spit': {
        const id = eid();
        const sp = 22;
        this.projectiles.set(id, {
          id, kind: 'spit', owner: p.id,
          x: p.x + d[0], y: p.y + 1.5, z: p.z + d[2],
          vx: d[0] * sp, vy: d[1] * sp + 3.5, vz: d[2] * sp,
        });
        break;
      }
    }
    this.broadcast({ t: 'ev', k: 'special', id: p.id, kind: zc.special, d });
  }

  onFire(p, m) {
    if (p.team !== 'resistance' || !p.alive || p.grapple) return;
    if (this.phase !== PHASE.COMBAT && this.phase !== PHASE.INTERMISSION) return;
    const wkey = String(m.w);
    const hero = HEROES[p.cls];
    if (wkey !== hero.main && wkey !== p.secondary) return;
    const w = WEAPONS[wkey];
    if (!w || w.melee) return;
    const t = now();
    if (t - p.lastFire < w.rof * 0.85) return;
    p.lastFire = t;
    const o = m.o.map(Number), dir = m.d.map(Number);
    // clamp origin near player
    if (dist2(o[0], o[2], p.x, p.z) > 9) return;
    const pellets = w.pellets || 1;
    let anyHit = false, anyHead = false;
    for (let i = 0; i < pellets; i++) {
      const s = w.spread * (pellets > 1 ? 1 : 0.5);
      const d = [dir[0] + rand(-s, s), dir[1] + rand(-s, s), dir[2] + rand(-s, s)];
      const hit = this.raycast(o, d, w.range, p);
      if (hit) {
        anyHit = true;
        if (hit.type === 'ai') {
          let dmg = w.dmg;
          if (hit.head) { dmg *= hero.headshot; anyHead = true; }
          this.damageAI(hit.ent, dmg, p, wkey);
          if (w.burn) this.applyStatus(hit.ent, 'burn');
        } else if (hit.type === 'pz') {
          const headMult = hit.head ? hero.headshot : 1;
          if (hit.head) anyHead = true;
          this.damageZombiePlayer(hit.ent, w.dmg, p, wkey, false, headMult);
          if (w.burn) this.applyStatusP(hit.ent, 'burn');
        } else if (hit.type === 'build') {
          // friendly structures: no damage from heroes
        }
      }
    }
    if (anyHit) p.client.send({ t: 'ev', k: 'hit', head: anyHead });
    this.broadcast({ t: 'ev', k: 'tracer', id: p.id, o, d: dir, w: wkey }, p.id);
  }

  onMelee(p, m) {
    if (!p.alive) return;
    if (this.phase !== PHASE.COMBAT && this.phase !== PHASE.INTERMISSION) return;
    const t = now();
    const wkey = p.team === 'zombie' ? 'claw' : (m.w && WEAPONS[m.w] && WEAPONS[m.w].melee ? m.w : 'machete');
    const w = WEAPONS[wkey];
    if (t - p.lastMelee < w.rof * 0.85) return;
    p.lastMelee = t;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const cx = p.x + fx * w.range * 0.6, cz = p.z + fz * w.range * 0.6;
    const r2 = w.range * w.range * 0.8;
    let hitSomething = false;

    if (p.team === 'resistance') {
      for (const a of this.ai.values()) {
        if (!a.dead && dist2(cx, cz, a.x, a.z) < r2) {
          this.damageAI(a, w.dmg, p, wkey);
          if (w.bleed) this.applyStatus(a, 'bleed');
          hitSomething = true;
        }
      }
      for (const z of this.players.values()) {
        if (z.team === 'zombie' && z.alive && dist2(cx, cz, z.x, z.z) < r2) {
          this.damageZombiePlayer(z, w.dmg, p, wkey);
          if (w.bleed) this.applyStatusP(z, 'bleed');
          hitSomething = true;
        }
      }
    } else {
      // zombie claw: heroes, traps, builds, barricade
      for (const h of this.players.values()) {
        if (h.team === 'resistance' && h.alive && dist2(cx, cz, h.x, h.z) < r2 && Math.abs(p.y - h.y) < 2) {
          this.damageHero(h, w.dmg, p, 'claw');
          hitSomething = true;
        }
      }
      for (const tr of this.traps.values()) {
        if (dist2(cx, cz, tr.x, tr.z) < r2) { this.damageTrap(tr, w.dmg); hitSomething = true; }
      }
      for (const b of this.builds.values()) {
        if (dist2(cx, cz, b.x, b.z) < r2 + 2 && Math.abs(p.y - b.y) < 3.4) { this.damageBuild(b, w.dmg); hitSomething = true; }
      }
      if (p.z > MAP.doorZ - 3 && Math.abs(p.x) < 7) {
        this.damageBarricade(CLAW_BARRICADE_DMG, p);
        hitSomething = true;
      }
    }
    if (hitSomething) p.client.send({ t: 'ev', k: 'hit', head: false });
    this.broadcast({ t: 'ev', k: 'swing', id: p.id }, p.id);
  }

  raycast(o, d, range, shooter) {
    // normalize
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    const dx = d[0] / len, dy = d[1] / len, dz = d[2] / len;
    let best = null, bestT = range;
    const sphere = (x, y, z, r) => {
      const ox = x - o[0], oy = y - o[1], oz = z - o[2];
      const tc = ox * dx + oy * dy + oz * dz;
      if (tc < 0 || tc > bestT) return -1;
      const d2 = ox * ox + oy * oy + oz * oz - tc * tc;
      if (d2 > r * r) return -1;
      return tc - Math.sqrt(Math.max(0, r * r - d2));
    };
    for (const a of this.ai.values()) {
      if (a.dead) continue;
      const k = AI_KINDS[a.kind];
      const tHit = sphere(a.x, a.y + k.height * 0.5, a.z, Math.max(k.radius * 1.4, k.height * 0.42));
      if (tHit >= 0 && tHit < bestT) {
        const hy = o[1] + dy * tHit;
        best = { type: 'ai', ent: a, head: hy > a.y + k.height * 0.72 };
        bestT = tHit;
      }
    }
    for (const z of this.players.values()) {
      if (z.team !== 'zombie' || !z.alive || z === shooter) continue;
      const k = ZCLASSES[z.cls];
      const tHit = sphere(z.x, z.y + k.height * 0.5, z.z, Math.max(k.radius * 1.4, k.height * 0.42));
      if (tHit >= 0 && tHit < bestT) {
        const hy = o[1] + dy * tHit;
        best = { type: 'pz', ent: z, head: hy > z.y + k.height * 0.72 };
        bestT = tHit;
      }
    }
    // builds block shots (simple sphere approximation per piece)
    for (const b of this.builds.values()) {
      const tHit = sphere(b.x, b.y + 1.5, b.z, 2.2);
      if (tHit >= 0 && tHit < bestT) { best = { type: 'build', ent: b }; bestT = tHit; }
    }
    return best;
  }

  // ---- placement --------------------------------------------------------------
  onPlaceTrap(p, m) {
    if (p.team !== 'resistance' || !p.alive) return;
    const spec = TRAPS[m.kind];
    if (!spec || p.coins < spec.cost) return;
    const x = Math.round((+m.x || 0) / MAP.gridTrap) * MAP.gridTrap;
    const z = Math.round((+m.z || 0) / MAP.gridTrap) * MAP.gridTrap;
    if (Math.abs(x) > MAP.walkHalfW || z < MAP.spawnZ + 24 || z > MAP.doorZ - 2) return;
    for (const t of this.traps.values()) if (t.x === x && t.z === z) return; // occupied
    p.coins -= spec.cost;
    const tr = { id: eid(), kind: m.kind, x, z, rotY: +m.rotY || 0, hp: spec.hp, maxHp: spec.hp, tier: 1, owner: p.id,
                 armT: 0, cycleT: now(), lastShot: 0, held: null, tickT: 0 };
    this.traps.set(tr.id, tr);
    this.broadcast({ t: 'ev', k: 'trapAdd', trap: { id: tr.id, kind: tr.kind, x, z, rotY: tr.rotY, hp: tr.hp, owner: p.id, tier: 1 } });
    p.client.send({ t: 'ev', k: 'coins', coins: p.coins });
  }

  onBuild(p, m) {
    if (p.team !== 'resistance' || !p.alive) return;
    const spec = BUILDS[m.kind];
    if (!spec || p.coins < spec.cost) return;
    const g = MAP.gridBuild;
    const x = Math.round((+m.x || 0) / g) * g;
    const z = Math.round((+m.z || 0) / g) * g;
    const y = clamp(Math.round((+m.y || 0) / MAP.buildLevel) * MAP.buildLevel, 0, 12);
    if (Math.abs(x) > MAP.walkHalfW + 2 || z < MAP.spawnZ + 24 || z > MAP.doorZ - 2) return;
    const rotY = (Math.round((+m.rotY || 0) / (Math.PI / 2)) * (Math.PI / 2)) % (Math.PI * 2);
    for (const b of this.builds.values()) {
      if (b.x === x && b.z === z && b.y === y && b.kind === m.kind && Math.abs(b.rotY - rotY) < 0.01) return;
    }
    p.coins -= spec.cost;
    const b = { id: eid(), kind: m.kind, x, y, z, rotY, hp: spec.hp, maxHp: spec.hp, tier: 1 };
    this.builds.set(b.id, b);
    this.broadcast({ t: 'ev', k: 'buildAdd', build: b });
    p.client.send({ t: 'ev', k: 'coins', coins: p.coins });
  }

  onSell(p, m) {
    if (p.team !== 'resistance') return;
    const tr = this.traps.get(m.id);
    if (tr) {
      this.traps.delete(tr.id);
      p.coins += Math.round(TRAPS[tr.kind].cost * SELL_REFUND);
      this.broadcast({ t: 'ev', k: 'trapDel', id: tr.id });
      p.client.send({ t: 'ev', k: 'coins', coins: p.coins });
      return;
    }
    const b = this.builds.get(m.id);
    if (b) {
      this.builds.delete(b.id);
      p.coins += Math.round(BUILDS[b.kind].cost * SELL_REFUND);
      this.broadcast({ t: 'ev', k: 'buildDel', id: b.id });
      p.client.send({ t: 'ev', k: 'coins', coins: p.coins });
    }
  }

  onReady(p) {
    if (this.phase !== PHASE.PREP && this.phase !== PHASE.INTERMISSION) return;
    p.ready = true;
    let n = 0;
    for (const q of this.players.values()) if (q.ready) n++;
    this.broadcast({ t: 'ev', k: 'ready', n, total: this.players.size });
  }

  onChat(p, m) {
    const text = String(m.text || '').slice(0, 200).trim();
    if (!text) return;
    this.broadcast({ t: 'ev', k: 'chat', id: p.id, nick: p.nick, team: p.team, text });
  }

  onVoice(p, m) {
    if (typeof m.d !== 'string' || m.d.length > 90000) return;
    this.broadcast({ t: 'voice', from: p.id, nick: p.nick, d: m.d, seq: m.seq | 0 }, p.id);
  }

  // ---- damage -------------------------------------------------------------------
  applyStatus(a, kind) {
    const t = now();
    if (kind === 'burn') a.statuses.burn = { until: t + BURN.dur, dealt: a.statuses.burn ? a.statuses.burn.dealt : 0, tickT: t };
    if (kind === 'bleed') a.statuses.bleed = { until: t + BLEED.dur, dealt: a.statuses.bleed ? a.statuses.bleed.dealt : 0, tickT: t };
  }
  applyStatusP(p, kind) {
    const t = now();
    const mult = ZOMBIE_TRAP_RESIST;
    if (kind === 'burn') p.statuses.burn = { until: t + BURN.dur * mult, dealt: 0, tickT: t };
    if (kind === 'bleed') p.statuses.bleed = { until: t + BLEED.dur * mult, dealt: 0, tickT: t };
  }

  damageAI(a, dmg, attacker, cause) {
    if (a.dead || this.phase !== PHASE.COMBAT) return;
    a.hp -= dmg;
    if (a.hp <= 0) {
      a.dead = true;
      const k = AI_KINDS[a.kind];
      if (a.kind === 'exploder' && cause !== 'boomself') this.explode(a.x, a.y, a.z, k.boomDmg, k.boomR, null);
      if (attacker) {
        attacker.kills++;
        attacker.score += k.reward;
        attacker.coins += k.reward;
        attacker.client.send({ t: 'ev', k: 'coins', coins: attacker.coins });
        this.broadcast({ t: 'ev', k: 'kill', killer: attacker.nick, killerId: attacker.id, victim: a.kind.toUpperCase() + ' (AI)', ai: true, weapon: cause });
      }
      this.broadcast({ t: 'ev', k: 'aiDie', id: a.id, x: a.x, y: a.y, z: a.z, kind: a.kind });
      this.ai.delete(a.id);
    }
  }

  // Layered soak: Energy Barrier -> Shields -> Helmet -> flesh. headMult (>1 for
  // headshots) is suppressed while any helmet HP remains.
  damageZombiePlayer(z, dmg, attacker, cause, isTrap, headMult) {
    if (!z.alive || this.phase !== PHASE.COMBAT) return;
    const t = now();
    if (t < z.invulnUntil) return;
    const a = z.arm;
    headMult = headMult || 1;
    let d = isTrap ? dmg * ZOMBIE_TRAP_RESIST : dmg;
    // Energy Barrier — trap-immune while up; only Hero weapons deplete it.
    if (a.energyMax > 0 && a.energyHp > 0) {
      if (isTrap) return;                 // invulnerable to traps
      a.lastHumanHitT = t;
      if (d <= a.energyHp) { a.energyHp -= d; z.client.send(armorMsg(z)); return; }
      d -= a.energyHp; a.energyHp = 0;
    } else if (!isTrap) {
      a.lastHumanHitT = t;
    }
    // Shields
    if (a.shieldHp > 0) {
      if (d <= a.shieldHp) { a.shieldHp -= d; z.client.send(armorMsg(z)); return; }
      d -= a.shieldHp; a.shieldHp = 0;
    }
    // Helmet (blocks headshot bonus while intact)
    const helmetWasUp = a.helmetHp > 0;
    if (a.helmetHp > 0) {
      if (d <= a.helmetHp) { a.helmetHp -= d; z.client.send(armorMsg(z)); return; }
      d -= a.helmetHp; a.helmetHp = 0;
    }
    if (!helmetWasUp && headMult > 1) d *= headMult;
    z.hp -= d;
    if (a.helmetMax || a.shieldMax || a.energyMax) z.client.send(armorMsg(z));
    z.client.send({ t: 'ev', k: 'dmg', hp: Math.max(0, z.hp), from: attacker ? attacker.nick : cause });
    if (z.hp <= 0) this.killPlayer(z, attacker, cause, isTrap);
  }

  damageHero(h, dmg, attacker, cause) {
    if (!h.alive || this.phase !== PHASE.COMBAT) return;
    if (now() < h.invulnUntil) return;    // spawn protection
    h.hp -= dmg;
    h.client.send({ t: 'ev', k: 'dmg', hp: Math.max(0, h.hp), from: attacker ? attacker.nick : cause });
    if (h.hp <= 0) this.killPlayer(h, attacker, cause, false);
  }

  killPlayer(p, attacker, cause, byTrap) {
    p.alive = false;
    p.deaths++;
    this.endGrappleFor(p);
    // bots count as AI for the "(Player)/(AI)" designation, but keep their nick
    const isNamedKiller = attacker && attacker.nick !== undefined && attacker.client;
    const isPlayerKiller = isNamedKiller && !attacker.isBot;
    const killerName = isNamedKiller ? attacker.nick : (cause === 'ai' ? 'ZOMBIE HORDE' : (byTrap ? String(cause).toUpperCase() + ' TRAP' : String(cause || 'THE APOCALYPSE').toUpperCase()));
    p.killedBy = { name: killerName, player: !!isPlayerKiller };
    if (isNamedKiller && attacker !== p) {
      attacker.kills++;
      const reward = p.team === 'zombie' ? 60 : 0;
      attacker.score += p.team === 'zombie' ? 60 : 100;
      if (attacker.team === 'resistance' && reward) {
        attacker.coins += reward;
        attacker.client.send({ t: 'ev', k: 'coins', coins: attacker.coins });
      }
      // Killing a Hero is a huge zombie payday — instantly funds an upgrade.
      if (attacker.team === 'zombie' && p.team === 'resistance') {
        this.addPoints(attacker, ZPOINTS.humanKill);
        attacker.client.send({ t: 'ev', k: 'humanKill' });
      }
    }
    let respawn = 0;
    if (p.team === 'zombie') {
      const aiRemaining = this.ai.size > 0 || this.spawnQueue.length > 0;
      if (this.phase === PHASE.COMBAT && aiRemaining && this.zlives > 0) {
        this.zlives--;
        respawn = RESPAWN_ZOMBIE;
        this.broadcast({ t: 'ev', k: 'zlives', zl: this.zlives });
      } else {
        respawn = -1; // no respawn this round
      }
    } else {
      respawn = RESPAWN_HERO;
    }
    p.deadUntil = respawn > 0 ? now() + respawn : Infinity;
    p.client.send({
      t: 'ev', k: 'died', respawn, killer: killerName, killerIsPlayer: !!isPlayerKiller,
    });
    this.broadcast({
      t: 'ev', k: 'kill',
      killer: killerName,
      killerId: isNamedKiller ? attacker.id : 0,
      victim: p.nick, victimId: p.id, ai: !isPlayerKiller,
    });
    this.broadcast({ t: 'ev', k: 'roster', roster: this.rosterList() });
  }

  damageTrap(tr, dmg) {
    tr.hp -= dmg;
    if (tr.hp <= 0) {
      this.traps.delete(tr.id);
      this.broadcast({ t: 'ev', k: 'trapDel', id: tr.id, destroyed: true });
    } else {
      this.broadcast({ t: 'ev', k: 'trapHp', id: tr.id, hp: tr.hp });
    }
  }

  damageBuild(b, dmg) {
    b.hp -= dmg;
    if (b.hp <= 0) {
      this.builds.delete(b.id);
      this.broadcast({ t: 'ev', k: 'buildDel', id: b.id, destroyed: true });
    } else {
      this.broadcast({ t: 'ev', k: 'buildHp', id: b.id, hp: b.hp });
    }
  }

  damageBarricade(dmg, attacker) {
    if (this.phase !== PHASE.COMBAT) return;
    this.barricadeHp = Math.max(0, this.barricadeHp - dmg);
    if (attacker && attacker.score !== undefined) attacker.score += Math.round(dmg / 10);
    this.broadcast({ t: 'ev', k: 'bar', hp: this.barricadeHp });
    if (this.barricadeHp <= 0) this.endMatch('zombie', 'The final barricade has fallen. The survivors are lost.');
  }

  explode(x, y, z, dmg, radius, attacker) {
    this.broadcast({ t: 'ev', k: 'boom', x, y, z, r: radius });
    const r2 = radius * radius;
    for (const a of [...this.ai.values()]) {
      if (!a.dead && dist2(x, z, a.x, a.z) < r2) this.damageAI(a, dmg, attacker, attacker ? 'mine' : 'boomself');
    }
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (dist2(x, z, p.x, p.z) < r2 && Math.abs(p.y - y) < 3) {
        if (p.team === 'zombie') this.damageZombiePlayer(p, dmg, attacker, 'mine', true);
        else this.damageHero(p, dmg * 0.5, null, 'explosion');
      }
    }
    for (const b of [...this.builds.values()]) {
      if (dist2(x, z, b.x, b.z) < r2) this.damageBuild(b, dmg);
    }
    if (Math.abs(x) < 8 && z > MAP.doorZ - radius) this.damageBarricade(dmg * 0.8, attacker);
  }

  // ---- tick ----------------------------------------------------------------------
  tick(dt) {
    const t = now();
    switch (this.phase) {
      case PHASE.PREP:
        if (t >= this.phaseEnds || this.allReady()) this.startRound();
        break;
      case PHASE.INTERMISSION:
        if (t >= this.phaseEnds || this.allReady()) this.startRound();
        break;
      case PHASE.END:
        if (t >= this.phaseEnds) {
          this.resetMatch();
          this.broadcast({ t: 'ev', k: 'reset' });
          this.broadcast({ t: 'ev', k: 'phase', ph: this.phase, tl: PREP_TIME, rd: 0 });
          this.broadcast({ t: 'ev', k: 'roster', roster: this.rosterList() });
        }
        return;
      case PHASE.COMBAT:
        this.tickCombat(t, dt);
        break;
    }
    if (this.solo) this.tickBots(t, dt);
    this.tickRespawns(t);
    this.tickProjectiles(t, dt);
  }

  tickRespawns(t) {
    for (const p of this.players.values()) {
      if (!p.alive && p.deadUntil !== Infinity && t >= p.deadUntil) this.spawnPlayer(p);
    }
  }

  tickCombat(t, dt) {
    // AI spawning
    if (this.spawnQueue.length && t >= this.nextAiSpawn) {
      const n = Math.min(this.spawnQueue.length, 1 + ((Math.random() * 3) | 0));
      for (let i = 0; i < n; i++) {
        const kind = this.spawnQueue.pop();
        const k = AI_KINDS[kind];
        const a = {
          id: eid(), kind, hp: k.hp, dead: false,
          x: rand(-MAP.roadHalfW + 1, MAP.roadHalfW - 1), y: 0, z: MAP.spawnZ + rand(-6, 4),
          laneX: rand(-MAP.roadHalfW + 1.5, MAP.roadHalfW - 1.5),
          atkT: 0, statuses: {}, wob: Math.random() * 10,
        };
        this.ai.set(a.id, a);
      }
      this.nextAiSpawn = t + rand(1.0, 2.2);
    }

    // AI behaviour
    for (const a of [...this.ai.values()]) {
      if (a.dead) continue;
      const k = AI_KINDS[a.kind];
      this.tickStatusesAI(a, t);
      if (a.statuses.held && a.statuses.held > t) continue;
      if (a.statuses.dance && a.statuses.dance > t) continue;
      let speed = k.speed * (a.statuses.slow && a.statuses.slow > t ? 0.6 : 1);

      // nearest blocking build directly ahead
      let blocking = null;
      for (const b of this.builds.values()) {
        if (b.y > 1.5) continue;
        const dz = b.z - a.z;
        if (dz > 0 && dz < 2.6 && Math.abs(b.x - a.x) < 2.6) { blocking = b; break; }
      }
      // nearby hero to swipe at
      let hero = null;
      for (const h of this.players.values()) {
        if (h.team === 'resistance' && h.alive && dist2(a.x, a.z, h.x, h.z) < 2.6 && Math.abs(h.y - a.y) < 1.8) { hero = h; break; }
      }

      const atBarricade = a.z > MAP.doorZ - 2.2 && Math.abs(a.x) < 8;

      if (a.kind === 'exploder' && (blocking || atBarricade)) {
        a.dead = true;
        this.broadcast({ t: 'ev', k: 'aiDie', id: a.id, x: a.x, y: a.y, z: a.z, kind: a.kind });
        this.ai.delete(a.id);
        this.explode(a.x, a.y + 0.5, a.z, k.boomDmg, k.boomR, null);
        continue;
      }

      if (hero && k.dmg > 0) {
        if (t - a.atkT > k.atkCd) { a.atkT = t; this.damageHero(hero, k.dmg, null, 'ai'); }
      } else if (blocking) {
        if (t - a.atkT > k.atkCd) { a.atkT = t; this.damageBuild(blocking, Math.max(6, k.dmg)); }
      } else if (atBarricade) {
        if (t - a.atkT > k.atkCd) { a.atkT = t; this.damageBarricade(Math.max(6, k.dmg), null); }
      } else {
        // shamble forward toward the door, drifting to lane
        const wob = Math.sin(t * 0.8 + a.wob) * 0.4;
        const txv = clamp(a.laneX + wob - a.x, -1, 1);
        a.z += speed * dt;
        a.x += txv * speed * 0.4 * dt;
        a.x = clamp(a.x, -MAP.walkHalfW + 0.6, MAP.walkHalfW - 0.6);
        if (a.z > MAP.doorZ - 2) a.z = MAP.doorZ - 2;
      }
    }

    // player zombie: points from forward progress, energy regen, auto-claw
    for (const p of this.players.values()) {
      if (p.team !== 'zombie' || !p.alive) continue;
      this.tickStatusesPlayer(p, t);
      if (p.z > p.lastPtZ) { this.addPoints(p, (p.z - p.lastPtZ) * ZPOINTS.perMeter); p.lastPtZ = p.z; }
      if (!p.reachedDoor && p.z > MAP.doorZ - 4) { p.reachedDoor = true; this.addPoints(p, ZPOINTS.reachDoor); }
      const a = p.arm;
      if (a.energyMax > 0 && a.energyHp < a.energyMax && t - a.lastHumanHitT >= ZITEMS.energy.regenDelay) {
        a.energyHp = a.energyMax; p.client.send(armorMsg(p));
      }
      if (p.z > MAP.doorZ - 2.8 && Math.abs(p.x) < 8 && t - p.lastClaw > 0.8) {
        p.lastClaw = t;
        this.damageBarricade(CLAW_BARRICADE_DMG, p);
        this.addPoints(p, ZPOINTS.clawBarricade);
        this.broadcast({ t: 'ev', k: 'swing', id: p.id });
      }
    }

    // grapple damage ticks
    for (const h of this.players.values()) {
      if (h.team !== 'resistance' || !h.grapple || !h.alive) continue;
      const z = this.players.get(h.grapple.zid);
      if (!z || !z.alive) { this.endGrapple(z, h, false); continue; }
      if (t >= h.grapple.nextTick) {
        h.grapple.nextTick = t + GRAPPLE_TICK;
        this.damageHero(h, GRAPPLE_DPS_TICK, z, 'grapple');
      }
    }

    this.tickTraps(t, dt);

    // round end check (resistance clears the wave)
    if (this.spawnQueue.length === 0 && this.ai.size === 0) {
      let zombiesAlive = 0;
      for (const p of this.players.values()) if (p.team === 'zombie' && p.alive) zombiesAlive++;
      if (zombiesAlive === 0) {
        // round cleared
        for (const p of this.players.values()) {
          if (p.team === 'resistance') {
            p.coins += ROUND_BONUS; p.score += ROUND_BONUS;
            p.client.send({ t: 'ev', k: 'coins', coins: p.coins });
          }
        }
        if (this.round >= ROUNDS) {
          this.endMatch('resistance', 'All three waves destroyed. The survivors live to see dawn.');
        } else {
          this.broadcast({ t: 'ev', k: 'roundClear', rd: this.round });
          for (const p of this.players.values()) { p.ready = !!p.isBot; if (!p.alive) { p.deadUntil = 0; } }
          this.setPhase(PHASE.INTERMISSION, INTERMISSION_TIME);
        }
      }
    }
  }

  tickStatusesAI(a, t) {
    const s = a.statuses;
    if (s.burn) {
      if (t < s.burn.until && s.burn.dealt < BURN.cap) {
        if (t - s.burn.tickT >= 0.5) { s.burn.tickT = t; s.burn.dealt += BURN.dps * 0.5; this.damageAI(a, BURN.dps * 0.5, s.burn.by || null, 'burn'); }
      } else delete s.burn;
    }
    if (a.dead) return;
    if (s.bleed) {
      if (t < s.bleed.until && s.bleed.dealt < BLEED.cap) {
        if (t - s.bleed.tickT >= 0.5) { s.bleed.tickT = t; s.bleed.dealt += BLEED.dps * 0.5; this.damageAI(a, BLEED.dps * 0.5, null, 'bleed'); }
      } else delete s.bleed;
    }
  }

  tickStatusesPlayer(p, t) {
    const s = p.statuses;
    if (s.burn) {
      if (t < s.burn.until && s.burn.dealt < BURN.cap) {
        if (t - s.burn.tickT >= 0.5) { s.burn.tickT = t; s.burn.dealt += BURN.dps * 0.5; this.damageZombiePlayer(p, BURN.dps * 0.5, null, 'burn', true); }
      } else delete s.burn;
    }
    if (!p.alive) return;
    if (s.bleed) {
      if (t < s.bleed.until && s.bleed.dealt < BLEED.cap) {
        if (t - s.bleed.tickT >= 0.5) { s.bleed.tickT = t; s.bleed.dealt += BLEED.dps * 0.5; this.damageZombiePlayer(p, BLEED.dps * 0.5, null, 'bleed', true); }
      } else delete s.bleed;
    }
  }

  *trapVictims(x, z, r) {
    const r2 = r * r;
    for (const a of this.ai.values()) if (!a.dead && dist2(x, z, a.x, a.z) < r2 && a.y < 1.5) yield { ai: a };
    for (const p of this.players.values()) {
      if (p.team === 'zombie' && p.alive && dist2(x, z, p.x, p.z) < r2 && p.y < 1.5) yield { pz: p };
    }
  }

  tickTraps(t, dt) {
    for (const tr of [...this.traps.values()]) {
      const spec = TRAPS[tr.kind];
      const dmul = TRAP_TIERS[(tr.tier || 1) - 1].dmgMult;
      switch (tr.kind) {
        case 'mine': {
          if (tr.armT > t) break;
          let trigger = false;
          for (const v of this.trapVictims(tr.x, tr.z, spec.radius * 0.55)) { trigger = true; break; }
          if (trigger) {
            tr.armT = t + spec.rearm;
            this.broadcast({ t: 'ev', k: 'trapFire', id: tr.id, kind: 'mine' });
            const r2 = spec.radius * spec.radius;
            for (const a of [...this.ai.values()]) if (!a.dead && dist2(tr.x, tr.z, a.x, a.z) < r2) this.damageAI(a, spec.dmg * dmul, this.players.get(tr.owner) || null, 'mine');
            for (const p of this.players.values()) {
              if (p.team === 'zombie' && p.alive && dist2(tr.x, tr.z, p.x, p.z) < r2) this.damageZombiePlayer(p, spec.dmg * dmul, this.players.get(tr.owner) || null, 'mine', true);
            }
            this.broadcast({ t: 'ev', k: 'boom', x: tr.x, y: 0.3, z: tr.z, r: spec.radius });
          }
          break;
        }
        case 'beartrap': {
          if (tr.held) {
            const v = tr.held;
            const ent = v.ai || v.pz;
            const gone = v.ai ? (v.ai.dead || !this.ai.has(v.ai.id)) : (!v.pz.alive);
            if (gone || t >= tr.holdUntil) {
              tr.held = null;
              tr.armT = t + spec.rearm;
              this.broadcast({ t: 'ev', k: 'trapState', id: tr.id, open: false });
            } else if (t - tr.tickT >= 1) {
              tr.tickT = t;
              if (v.ai) { v.ai.statuses.held = tr.holdUntil; this.damageAI(v.ai, spec.dmg * dmul, this.players.get(tr.owner) || null, 'beartrap'); }
              else this.damageZombiePlayer(v.pz, spec.dmg * dmul, this.players.get(tr.owner) || null, 'beartrap', true);
            }
            break;
          }
          if (tr.armT > t) break;
          for (const v of this.trapVictims(tr.x, tr.z, 1.0)) {
            tr.held = v; tr.tickT = t;
            if (v.ai) { tr.holdUntil = t + spec.holdAI; v.ai.statuses.held = tr.holdUntil; }
            else { tr.holdUntil = t + spec.holdPZ; v.pz.client.send({ t: 'ev', k: 'held', until: tr.holdUntil - t }); }
            this.broadcast({ t: 'ev', k: 'trapFire', id: tr.id, kind: 'beartrap' });
            break;
          }
          break;
        }
        case 'spikes': {
          if (t - tr.tickT < spec.tick) break;
          tr.tickT = t;
          for (const v of this.trapVictims(tr.x, tr.z, 1.6)) {
            if (v.ai) { v.ai.statuses.slow = t + 0.8; this.damageAI(v.ai, spec.dmg * dmul, this.players.get(tr.owner) || null, 'spikes'); this.applyStatus(v.ai, 'bleed'); }
            else this.damageZombiePlayer(v.pz, spec.dmg * dmul, this.players.get(tr.owner) || null, 'spikes', true);
          }
          break;
        }
        case 'flame': {
          const cycle = (t - tr.cycleT) % (spec.on + spec.off);
          const active = cycle < spec.on;
          if (active !== !!tr.active) { tr.active = active; this.broadcast({ t: 'ev', k: 'trapState', id: tr.id, on: active }); }
          if (!active || t - tr.tickT < spec.tick) break;
          tr.tickT = t;
          for (const v of this.trapVictims(tr.x, tr.z, 2.4)) {
            if (v.ai) { this.damageAI(v.ai, spec.dmg * dmul, this.players.get(tr.owner) || null, 'flame'); this.applyStatus(v.ai, 'burn'); }
            else { this.damageZombiePlayer(v.pz, spec.dmg * dmul, this.players.get(tr.owner) || null, 'flame', true); this.applyStatusP(v.pz, 'burn'); }
          }
          break;
        }
        case 'turret': {
          if (t - tr.lastShot < spec.rof) break;
          // Turrets can NOT see player zombies (undetectable per spec) — AI only.
          let target = null, bd = spec.range * spec.range;
          for (const a of this.ai.values()) {
            if (a.dead) continue;
            const d = dist2(tr.x, tr.z, a.x, a.z);
            if (d < bd) { bd = d; target = a; }
          }
          if (target) {
            tr.lastShot = t;
            this.damageAI(target, spec.dmg * dmul, this.players.get(tr.owner) || null, 'turret');
            this.broadcast({ t: 'ev', k: 'turretShot', id: tr.id, to: [target.x, target.y + 1.2, target.z] });
          }
          break;
        }
        case 'boombox': {
          const cycle = (t - tr.cycleT) % spec.period;
          const playing = cycle < spec.play;
          if (playing !== !!tr.active) {
            tr.active = playing;
            this.broadcast({ t: 'ev', k: 'trapState', id: tr.id, on: playing });
            if (playing) {
              for (const v of this.trapVictims(tr.x, tr.z, spec.radius)) {
                if (v.ai) { v.ai.statuses.dance = t + spec.danceAI; }
                else v.pz.client.send({ t: 'ev', k: 'dance', dur: spec.dancePZ });
              }
              this.broadcast({ t: 'ev', k: 'thriller', x: tr.x, z: tr.z, r: spec.radius });
            }
          }
          break;
        }
      }
    }
  }

  tickProjectiles(t, dt) {
    for (const pr of [...this.projectiles.values()]) {
      pr.vy -= 12 * dt;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
      let hit = false;
      if (pr.kind === 'spit') {
        for (const h of this.players.values()) {
          if (h.team !== 'resistance' || !h.alive) continue;
          if (dist2(pr.x, pr.z, h.x, h.z) < 1.2 && Math.abs(pr.y - (h.y + 1)) < 1.6) {
            this.damageHero(h, 30, this.players.get(pr.owner) || null, 'spit');
            hit = true; break;
          }
        }
      }
      if (pr.y <= 0 || hit || Math.abs(pr.x) > 60 || pr.z < MAP.minZ || pr.z > MAP.maxZ) {
        this.projectiles.delete(pr.id);
        this.broadcast({ t: 'ev', k: 'splat', x: pr.x, y: Math.max(0, pr.y), z: pr.z });
      }
    }
  }

  // ---- snapshots -------------------------------------------------------------------
  snapshot() {
    const r2 = v => Math.round(v * 100) / 100;
    const pl = [];
    for (const p of this.players.values()) {
      pl.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), Math.max(0, Math.round(p.hp)), p.alive ? 1 : 0, p.anim,
               p.grapple ? (p.team === 'zombie' ? p.grapple.hid : p.grapple.zid) : 0]);
    }
    const ai = [];
    for (const a of this.ai.values()) {
      if (a.dead) continue;
      let st = 0;
      const t = now();
      if (a.statuses.burn) st |= 1;
      if (a.statuses.held && a.statuses.held > t) st |= 2;
      if (a.statuses.dance && a.statuses.dance > t) st |= 4;
      if (a.statuses.slow && a.statuses.slow > t) st |= 8;
      ai.push([a.id, a.kind[0], r2(a.x), r2(a.z), Math.max(0, Math.round(a.hp)), st]);
    }
    const pr = [];
    for (const q of this.projectiles.values()) pr.push([q.id, r2(q.x), r2(q.y), r2(q.z)]);
    return {
      t: 's', ph: this.phase, tl: Math.max(0, Math.round((this.phaseEnds - now()) * 10) / 10),
      rd: this.round, bar: this.barricadeHp, zl: this.zlives,
      qn: this.spawnQueue.length + this.ai.size,
      pl, ai, pr,
    };
  }
}

// ---------------------------------------------------------------------------
export function createHub() {
  const rooms = new Map();
  let nextRoom = 1, nextClient = 1;
  const clients = new Map();

  function findRoom(solo) {
    if (solo) {
      const r = new Room(hub, 'solo-' + (nextRoom++), true);
      rooms.set(r.id, r);
      return r;
    }
    for (const r of rooms.values()) if (!r.solo && r.players.size < ROOM_MAX) return r;
    const r = new Room(hub, 'room-' + (nextRoom++));
    rooms.set(r.id, r);
    return r;
  }

  const hub = {
    connect(transport) {
      const id = 'p' + (nextClient++);
      const client = {
        id, transport, room: null, player: null,
        send(obj) { this.sendRaw(JSON.stringify(obj)); },
        sendRaw(s) { try { transport.send(s); } catch (_) { /* gone */ } },
        onMessage(raw) {
          let m;
          try { m = JSON.parse(raw); } catch (_) { return; }
          if (!m || typeof m.t !== 'string') return;
          if (m.t === 'join' && !this.player) {
            this.room = findRoom(!!m.solo);
            this.player = this.room.addPlayer(this, m);
            return;
          }
          if (this.room && this.player) this.room.onMessage(this.player, m);
        },
        onClose() {
          clients.delete(id);
          if (this.room) {
            this.room.removePlayer(id);
            if (this.room.humanCount() === 0) rooms.delete(this.room.id);
          }
        },
      };
      clients.set(id, client);
      return client;
    },
    stats() {
      return { rooms: rooms.size, clients: clients.size };
    },
  };

  // sim loop
  let last = now();
  const tickMs = 1000 / TICK_RATE;
  setInterval(() => {
    const t = now();
    const dt = Math.min(0.25, t - last);
    last = t;
    for (const r of rooms.values()) {
      try { r.tick(dt); } catch (e) { console.error('room tick error', e); }
    }
  }, tickMs);

  // snapshot loop
  setInterval(() => {
    for (const r of rooms.values()) {
      if (r.players.size === 0) continue;
      try { r.broadcast(r.snapshot()); } catch (e) { console.error('snapshot error', e); }
    }
  }, 1000 / 12);

  return hub;
}

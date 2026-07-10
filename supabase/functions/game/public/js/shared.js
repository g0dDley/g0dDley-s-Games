// Shared constants between server sim and client. Plain ESM, no deps.

export const VERSION = '1.0.0';
export const GAME_NAME = 'ZOMBIES FROM MARS';

// Roster: 4 Resistance heroes + up to 16 player Zombies (20 seats total).
export const MAX_RESISTANCE = 4;
export const MAX_ZOMBIES = 16;
export const ROOM_MAX = MAX_RESISTANCE + MAX_ZOMBIES;   // 20
export const LATE_JOIN_SLOTS = 3;   // extra drop-in seats once a match is in combat

export const PHASE = { PREP: 'prep', COMBAT: 'combat', INTERMISSION: 'intermission', END: 'end' };
export const PREP_TIME = 300;          // seconds, max trap-placing time
export const INTERMISSION_TIME = 30;   // between rounds
export const END_TIME = 18;            // victory screen before reset
export const ROUNDS = 3;

export const TICK_RATE = 30;           // server sim Hz
export const SNAP_RATE = 12;           // snapshot broadcast Hz
export const INPUT_RATE = 20;          // client input send Hz

// ---- Map ------------------------------------------------------------------
// Road runs along Z. Zombies spawn at MAP.spawnZ, safehouse door at MAP.doorZ.
export const MAP = {
  roadHalfW: 9,          // drivable road half width
  walkHalfW: 15,         // playable half width (road + sidewalks)
  spawnZ: -250,          // zombie end
  doorZ: 16,             // safehouse barricade door plane
  minZ: -262, maxZ: 30,  // hard bounds
  gridTrap: 2,           // trap snap
  gridBuild: 4,          // build snap
  buildLevel: 3,         // vertical build step
};

export const BARRICADE_MAX_HP = 4000;

// ---- Economy --------------------------------------------------------------
export const START_COINS = 600;
export const ROUND_BONUS = 300;
export const SELL_REFUND = 0.6;
export const KILL_REWARD = { walker: 15, runner: 20, brute: 40, exploder: 25, player: 60 };

// ---- Heroes ---------------------------------------------------------------
export const HEROES = {
  tommy:  { name: 'Tommy "Survivalist"', hp: 100, walk: 6.0, sprint: 9.0,
            main: 'ar',      melee: 'machete', headshot: 2.5, reserveMult: 1.6,
            desc: 'Ranged specialist. Headshots hit harder, carries more ammo.' },
  tina:   { name: 'Tina Mackenzie',      hp: 85,  walk: 6.8, sprint: 10.2,
            main: 'icebreaker', melee: 'hockey', headshot: 2.0, reserveMult: 1.0,
            desc: 'Roller-skate speedster. Barbed hockey stick makes them bleed.' },
  joe:    { name: 'Bulldozer Joe',       hp: 150, walk: 5.4, sprint: 7.8,
            main: 'doublebarrel', melee: 'sledge', headshot: 2.0, reserveMult: 1.0,
            desc: '8-foot tradie tank. Slow, huge, shrugs off grabs faster.' },
  nathan: { name: 'Father Nathan',       hp: 100, walk: 6.0, sprint: 9.0,
            main: 'crossbow', melee: 'censer', headshot: 2.0, reserveMult: 1.0,
            desc: 'Former preacher. Blessed fire bolts ignite the unholy.' },
};

export const SECONDARIES = ['pistol', 'smg', 'sniper', 'pump'];

// dmg per hit (per pellet for shotguns), rof = seconds between shots
export const WEAPONS = {
  ar:           { label: 'PATRIOT AR',      dmg: 16, rof: 0.105, mag: 30, reserve: 150, reload: 2.0, ads: 'fps',  pellets: 1, spread: 0.014, range: 120 },
  icebreaker:   { label: 'ICE BREAKER',     dmg: 9,  rof: 0.85,  mag: 6,  reserve: 42,  reload: 2.4, ads: 'zoom', pellets: 8, spread: 0.06,  range: 30 },
  doublebarrel: { label: 'WRECKER DBL-BRL', dmg: 12, rof: 0.6,   mag: 2,  reserve: 32,  reload: 2.6, ads: 'zoom', pellets: 10, spread: 0.075, range: 24 },
  crossbow:     { label: 'REDEMPTION XBOW', dmg: 85, rof: 1.1,   mag: 1,  reserve: 30,  reload: 1.7, ads: 'zoom', pellets: 1, spread: 0.002, range: 140, burn: true },
  pistol:       { label: 'M1911 PISTOL',    dmg: 25, rof: 0.28,  mag: 12, reserve: 72,  reload: 1.5, ads: 'zoom', pellets: 1, spread: 0.012, range: 80 },
  smg:          { label: 'STREET SMG',      dmg: 11, rof: 0.075, mag: 25, reserve: 150, reload: 1.9, ads: 'zoom', pellets: 1, spread: 0.03,  range: 60 },
  sniper:       { label: 'LONGSHOT SNIPER', dmg: 120, rof: 1.4,  mag: 5,  reserve: 25,  reload: 2.8, ads: 'fps',  pellets: 1, spread: 0.001, range: 260 },
  pump:         { label: 'PUMP SHOTGUN',    dmg: 8,  rof: 0.95,  mag: 6,  reserve: 36,  reload: 2.4, ads: 'zoom', pellets: 8, spread: 0.065, range: 28 },
  // melee (range in meters)
  machete:      { label: 'MACHETE',   dmg: 45, rof: 0.5,  melee: true, range: 2.4 },
  hockey:       { label: 'BARBED HOCKEY STICK', dmg: 35, rof: 0.45, melee: true, range: 2.6, bleed: true },
  sledge:       { label: 'GIANT SLEDGEHAMMER',  dmg: 90, rof: 0.9,  melee: true, range: 2.8 },
  censer:       { label: 'CENSER STAFF', dmg: 40, rof: 0.5, melee: true, range: 2.5 },
  claw:         { label: 'CLAWS',     dmg: 15, rof: 0.45, melee: true, range: 2.4 },
};

// ---- Player zombie classes --------------------------------------------------
// Every player zombie STARTS as a Walker and upgrades with points (see ZPOINTS).
export const ZCLASSES = {
  walker:  { name: 'Walker',  hp: 200, walk: 5.2, sprint: 7.6,  radius: 0.55, height: 1.8, cost: 0,
             special: 'none', specialCd: 0, desc: 'The baseline shambler every zombie starts as. Cheap, no special — advance and kill Heroes to earn upgrades.' },
  runner:  { name: 'Runner',  hp: 320, walk: 6.4, sprint: 9.6,  radius: 0.55, height: 1.8, cost: 500,
             special: 'adrenaline', specialCd: 12, desc: 'Sprinter. More health & speed. E: Adrenaline speed surge.' },
  stalker: { name: 'Stalker', hp: 240, walk: 6.9, sprint: 10.8, radius: 0.5,  height: 1.7, cost: 650,
             special: 'leap', specialCd: 8, desc: 'Climber. Fastest, nimble. E: huge leap forward.' },
  belcher: { name: 'Belcher', hp: 420, walk: 4.8, sprint: 6.6,  radius: 0.75, height: 1.8, cost: 800,
             special: 'spit', specialCd: 6, desc: 'Ranged bruiser. E: arcing acid spit that hits Heroes at distance.' },
  brute:   { name: 'Brute',   hp: 680, walk: 5.4, sprint: 7.8,  radius: 0.85, height: 2.2, cost: 1100,
             special: 'charge', specialCd: 10, desc: 'Huge tank. E: knockback charge that flattens Heroes.' },
};
export const ZCLASS_ORDER = ['walker', 'runner', 'stalker', 'belcher', 'brute'];

// ---- Zombie progression (points) --------------------------------------------
// Tuned so ~2-3 average advances (die partway down the road) buys a class, but
// a single Hero kill instantly funds even the priciest upgrade.
export const ZPOINTS = {
  perMeter: 1.3,      // points per metre of forward progress toward the door
  humanKill: 1200,    // instant character upgrade
  reachDoor: 200,     // reaching the barricade
  clawBarricade: 4,   // per auto-claw on the safehouse door
  start: 0,
};

// ---- Zombie item upgrades (cheap, stack & mix) ------------------------------
// Bought freely from the upgrade menu; a description is shown before purchase.
// Layered damage soak order: Energy Barrier -> Shields -> Helmet -> base HP.
export const ZITEMS = {
  helmet: { name: 'Helmet',          cost: 120, helmetHp: 70, look: 'helmet',
            desc: 'Football helmet / traffic pylon. +70 soak that also NULLIFIES headshot bonus damage until it is knocked off.' },
  shoes:  { name: 'Running Shoes',   cost: 150, sprintMult: 1.22, lungeCdMult: 0.7, look: 'shoes',
            desc: 'Faster sprint and a much shorter Lunge cooldown. No armour, pure mobility.' },
  lid:    { name: 'Garbage Can Lid', cost: 180, shieldHp: 90,  look: 'lid',
            desc: 'A dented steel lid strapped to your arm. +90 shield health.' },
  riot:   { name: 'Riot Shield',     cost: 280, shieldHp: 180, look: 'riot',
            desc: 'Looted police riot shield. +180 shield health.' },
  chain:  { name: 'Chain Armor',     cost: 360, shieldHp: 300, look: 'chain',
            desc: 'Heavy scavenged chainmail. +300 shield health — the most raw armour you can wear.' },
  energy: { name: 'Energy Barrier',  cost: 520, energyHp: 140, regenDelay: 8, look: 'energy',
            desc: 'Martian tech bubble. INVULNERABLE to traps while up; only Hero weapons deplete it. Fully regenerates after 8s without taking Hero damage.' },
  climb:  { name: 'Mountaineering Gear', cost: 300, climb: true, look: 'climb',
            desc: 'Pitons & claws. Climb over ANY wall, ramp or obstacle by simply pushing forward into it — the trick every Stalker is born with.' },
};
export const ZITEM_ORDER = ['helmet', 'shoes', 'lid', 'riot', 'chain', 'climb', 'energy'];

// Respawn beacon: a death-time choice (not a worn item). Beam back down at the
// spot you fell with FULL health — the alternative to burning a life at spawn.
export const BEACON_COST = 380;          // points spent at death to deploy the beacon
export const CLIMB_SPEED = 4.4;          // vertical climb rate for Stalkers / Mountaineering

export const ZOMBIE_TRAP_RESIST = 0.4;   // player zombies take 40% of trap damage
export const LUNGE_CD = 5;               // Q cooldown seconds
export const LUNGE_SPEED = 16; export const LUNGE_TIME = 0.45;
export const GRAPPLE_DPS_TICK = 10;      // dmg per grapple tick
export const GRAPPLE_TICK = 0.4;         // seconds per tick
export const GRAPPLE_MASH_NEED = 8;      // space taps to escape
export const CLAW_BARRICADE_DMG = 8;     // player claw vs barricade per swing
export const RESPAWN_INVULN = 3;         // seconds of spawn protection (heroes)

// ---- AI horde ---------------------------------------------------------------
export const AI_KINDS = {
  walker:   { hp: 60,  speed: 1.7, dmg: 8,  atkCd: 1.2, radius: 0.5,  height: 1.75, reward: 15 },
  runner:   { hp: 45,  speed: 4.3, dmg: 6,  atkCd: 1.0, radius: 0.45, height: 1.7,  reward: 20 },
  stalker:  { hp: 70,  speed: 5.0, dmg: 7,  atkCd: 0.9, radius: 0.5,  height: 1.7,  reward: 22, climber: true },
  belcher:  { hp: 150, speed: 2.2, dmg: 14, atkCd: 1.5, radius: 0.72, height: 1.85, reward: 30, spit: true, spitR: 14 },
  brute:    { hp: 260, speed: 1.9, dmg: 18, atkCd: 1.6, radius: 0.8,  height: 2.3,  reward: 40 },
  exploder: { hp: 55,  speed: 3.6, dmg: 0,  atkCd: 1.0, radius: 0.5,  height: 1.7,  reward: 25, boomDmg: 150, boomR: 4 },
};
// Per-round wave tables: [kind, count]
export const WAVES = [
  { walker: 16, runner: 8 },
  { walker: 20, runner: 12, brute: 3, exploder: 3 },
  { walker: 24, runner: 16, brute: 6, exploder: 6 },
];
export const ZLIVES_BASE = 10;           // + ZLIVES_PER_PLAYER * playerZombieCount
export const ZLIVES_PER_PLAYER = 5;

// ---- Life-point wave system (replaces per-round zlives) ---------------------
// The zombie team shares a fluctuating pool of life points. Each zombie death
// (AI or player) spends 1; damaging the barricade grants extra points. Waves of
// WAVE_SIZE are released with up to ZOMBIE_ONSCREEN alive at once.
export const ZOMBIE_LIFE_BASE = 240;     // starting team life-point pool per round
export const ZOMBIE_ONSCREEN = 30;       // max zombies (AI + players) on the field at once
export const WAVE_SIZE = 60;             // AI horde released per round from the pool
export const LIFE_PER_BARRICADE = 14;    // barricade damage needed to earn +1 life point
export const LIFE_BARRICADE_CAP = 120;   // most bonus life a single round can bank
// Barricade breach mini-game: a well-timed strike carves a big chunk out and
// alerts the Heroes that a *player* zombie is breaching.
export const BARRICADE_STRIKE_DMG = 150; // base chunk on a good strike (x class mult)
export const BARRICADE_STRIKE_LIFE = 2;  // life points granted to the team per good strike

// ---- Zombie pre-game draft (prep phase) -------------------------------------
// Zombies cannot start the match early; instead they spend prep drafting. Draft
// budget grows the longer the Heroes take. Weight points reallocate the AI wave
// class makeup; free item picks are handed out each elapsed minute.
export const DRAFT_BASE = 8;             // class-weight points available at prep start
export const DRAFT_PER_MIN = 5;          // + weight points granted per elapsed prep minute
export const DRAFT_FREE_ITEMS = 1;       // free zombie item upgrades granted per elapsed minute
export const HORDE_CLASSES = ['walker', 'runner', 'stalker', 'belcher', 'brute', 'exploder'];

// ---- Traps ------------------------------------------------------------------
export const TRAPS = {
  mine:    { label: 'LANDMINE',      cost: 100, hp: 150, dmg: 90,  radius: 3.0, rearm: 8 },
  beartrap:{ label: 'BEAR TRAP',     cost: 80,  hp: 150, dmg: 15,  holdAI: 3.0, holdPZ: 1.2, rearm: 6 },
  spikes:  { label: 'SPIKE STRIP',   cost: 120, hp: 200, dmg: 12,  tick: 0.5, slow: 0.4 },
  flame:   { label: 'FLAME VENT',    cost: 200, hp: 200, dmg: 14,  tick: 0.4, on: 2.0, off: 2.5, burn: true },
  turret:  { label: 'AUTO TURRET',   cost: 300, hp: 250, dmg: 7,   rof: 0.25, range: 18 },
  boombox: { label: 'THRILLER BOOMBOX', cost: 150, hp: 150, period: 9, play: 3, radius: 8, danceAI: 4, dancePZ: 1.5 },
};
export const TRAP_ORDER = ['mine', 'beartrap', 'spikes', 'flame', 'turret', 'boombox'];

// Trap tier upgrades (tier 1 = as-placed). Multipliers applied to hp & damage,
// plus the coin cost to step up. Max tier 3.
export const TRAP_TIERS = [
  { hpMult: 1.0, dmgMult: 1.0, cost: 0 },
  { hpMult: 1.8, dmgMult: 1.5, cost: 120 },
  { hpMult: 3.0, dmgMult: 2.2, cost: 250 },
];

// ---- Builds -----------------------------------------------------------------
// hp is tier-1; walls/floors/ramps upgrade through 3 material tiers.
export const BUILDS = {
  wall: { label: 'WOOD WALL',  cost: 30, hp: 250 },
  floor:{ label: 'FLOOR/CEILING', cost: 30, hp: 200 },
  ramp: { label: 'WOOD RAMP',  cost: 30, hp: 200 },
};
export const BUILD_ORDER = ['wall', 'floor', 'ramp'];
// Tier 1 wood -> Tier 2 stone -> Tier 3 steel.
export const BUILD_TIERS = [
  { name: 'WOOD',  hpMult: 1.0, cost: 0,  color: 0x6a4a26 },
  { name: 'STONE', hpMult: 2.2, cost: 40, color: 0x6b7079 },
  { name: 'STEEL', hpMult: 4.0, cost: 80, color: 0x8b95a6 },
];

// ---- Statuses ----------------------------------------------------------------
export const BURN = { dps: 8, dur: 4, cap: 60 };    // fire tick to a maximum (doc)
export const BLEED = { dps: 5, dur: 5, cap: 40 };

export const RESPAWN_HERO = 5.0;
export const RESPAWN_ZOMBIE = 4.0;

// One long fire-escape balcony spanning the safehouse frontage, one storey up.
// Each Hero has a dedicated respawn spot along it (assigned by seat order) and
// climbs a ladder at either end (press F). Zombies cannot use the ladders.
export const FIRE_ESCAPE_TOP = 3.4;
export const BALCONY = { y: FIRE_ESCAPE_TOP, z: MAP.doorZ - 9.5, halfW: 13.5, depth: 3.4 };
// Dedicated per-hero respawn spots, left→right, one per Resistance seat.
export const HERO_SPAWNS = [-9.5, -3.2, 3.2, 9.5].map((x) => ({ x, y: BALCONY.y, z: BALCONY.z }));
// Ladders at both ends of the long balcony.
export const LADDERS = [
  { x: -BALCONY.halfW + 1.2, z: BALCONY.z - BALCONY.depth / 2 - 0.4 },
  { x: BALCONY.halfW - 1.2, z: BALCONY.z - BALCONY.depth / 2 - 0.4 },
];

export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
export function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

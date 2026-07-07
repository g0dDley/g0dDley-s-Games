// Game engine: rendering, third-person controls, prediction, combat, placement.
import * as THREE from 'three';
import {
  MAP, PHASE, HEROES, ZCLASSES, WEAPONS, SECONDARIES, TRAPS, TRAP_ORDER, BUILDS, BUILD_ORDER,
  LUNGE_CD, LUNGE_TIME, INPUT_RATE, clamp,
} from './shared.js';
import { buildWorld } from './world.js';
import { makeCharacter, makeAIZombie, makeTrap, makeBuild, makeGunMesh } from './models.js';

const GRAVITY = 24;
const JUMP_V = 8.5;
const EYE = 1.62;

// ---- tiny synth sfx ---------------------------------------------------------
class SFX {
  constructor() { this.ctx = null; }
  ensure() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} } return this.ctx; }
  play(kind) {
    const ctx = this.ensure(); if (!ctx) return;
    const t = ctx.currentTime;
    if (kind === 'shot' || kind === 'shotgun') {
      const dur = kind === 'shotgun' ? 0.22 : 0.09;
      const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const g = ctx.createGain(); g.gain.value = kind === 'shotgun' ? 0.35 : 0.22;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400;
      src.connect(f).connect(g).connect(ctx.destination); src.start();
    } else if (kind === 'boom') {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(t + 0.65);
    } else if (kind === 'hit') {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 880;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(t + 0.08);
    } else if (kind === 'thriller') {
      // funky little bass riff, our beloved boombox
      const notes = [110, 130.8, 146.8, 130.8, 110, 98, 110, 146.8];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        const g = ctx.createGain();
        const st = t + i * 0.18;
        g.gain.setValueAtTime(0.0001, st); g.gain.linearRampToValueAtTime(0.12, st + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, st + 0.16);
        o.connect(g).connect(ctx.destination); o.start(st); o.stop(st + 0.18);
      });
    } else if (kind === 'growl') {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(70 + Math.random() * 40, t); o.frequency.linearRampToValueAtTime(45, t + 0.3);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(t + 0.4);
    }
  }
}

function nameSprite(text, color = '#7df9ff') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.font = 'bold 26px sans-serif'; g.textAlign = 'center';
  g.fillStyle = '#000a'; g.fillRect(0, 0, 256, 48);
  g.fillStyle = color; g.fillText(text.slice(0, 16), 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(2.2, 0.42, 1);
  return sp;
}

export class Game {
  constructor(net, hud, voice) {
    this.net = net; this.hud = hud; this.voice = voice;
    this.sfx = new SFX();
    this.renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game'), antialias: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 500);
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    this.world = buildWorld(this.scene);

    // my state
    this.me = {
      id: null, team: null, cls: null, secondary: null,
      pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(),
      yaw: 0, pitch: 0, onGround: true, alive: true, hp: 100, maxHp: 100,
      coins: 0, score: 0, grappledBy: null, mashHint: 0,
      lungeT: -99, specialT: -99, lungeVec: null, danceUntil: 0, heldUntil: 0,
      speedBoostUntil: 0, chargeUntil: 0,
    };
    this.keys = {};
    this.mouseDown = false; this.rmb = false;
    this.pointerLocked = false;
    this.paused = false;
    this.chatOpen = false;
    this.phase = PHASE.PREP; this.phaseTimeLeft = 300; this.round = 0;

    // weapons
    this.slots = [];           // [mainKey, secondaryKey, meleeKey] for heroes / ['claw']
    this.slotIdx = 0;
    this.ammo = {};            // key -> {mag, reserve}
    this.reloadUntil = 0;
    this.lastFireT = 0;

    // placement
    this.menuMode = null;      // 'traps' | 'build' | null
    this.menuIdx = 0;
    this.ghost = null;

    // remote entities
    this.players = new Map();  // id -> {mesh, name, target:{...}, prev:{...}, team, cls, anim}
    this.aiz = new Map();      // id -> {mesh, kind, target, prev, st}
    this.projs = new Map();
    this.trapMeshes = new Map();
    this.buildMeshes = new Map();
    this.buildData = new Map(); // id -> {kind,x,y,z,rotY}
    this.roster = [];
    this.effects = [];

    this.myMesh = null;
    this.gunMesh = null;
    this.lastInputSend = 0;
    this.clock = new THREE.Clock();

    this.bindInput();
    this.bindNet();
  }

  // =========================================================================
  bindInput() {
    addEventListener('keydown', (e) => this.onKeyDown(e));
    addEventListener('keyup', (e) => this.onKeyUp(e));
    addEventListener('mousedown', (e) => {
      if (!this.running || this.paused || this.chatOpen) return;
      if (!this.pointerLocked) { this.lockPointer(); return; }
      if (e.button === 0) { this.mouseDown = true; this.onPrimary(); }
      if (e.button === 2) this.rmb = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rmb = false;
    });
    addEventListener('contextmenu', (e) => { if (this.running) e.preventDefault(); });
    addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || this.paused || this.chatOpen) return;
      const sens = 0.0021;
      this.me.yaw -= e.movementX * sens;
      this.me.pitch = clamp(this.me.pitch - e.movementY * sens, -1.45, 1.45);
    });
    addEventListener('wheel', (e) => {
      if (!this.running || !this.menuMode) return;
      const order = this.menuMode === 'traps' ? TRAP_ORDER : BUILD_ORDER;
      this.menuIdx = ((this.menuIdx + (e.deltaY > 0 ? 1 : -1)) % order.length + order.length) % order.length;
      this.refreshTray();
      this.makeGhost();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
      if (!this.pointerLocked && this.running && !this.chatOpen && !this.paused) {
        this.setPaused(true);
      }
    });
    document.getElementById('backBtn').onclick = () => this.setPaused(false);
    document.getElementById('readyBtn').onclick = () => {
      this.net.send({ t: 'ready' });
      const b = document.getElementById('readyBtn');
      b.classList.add('done'); b.textContent = 'READY ✔ WAITING...';
    };
  }

  lockPointer() {
    this.renderer.domElement.requestPointerLock();
  }

  setPaused(v) {
    this.paused = v;
    if (v) { this.hud.show('pause'); document.exitPointerLock(); }
    else { this.hud.hide('pause'); this.lockPointer(); }
  }

  onKeyDown(e) {
    if (!this.running) return;
    if (this.chatOpen) {
      if (e.key === 'Escape') this.closeChat(false);
      return;
    }
    this.keys[e.code] = true;
    switch (e.code) {
      case 'Escape': this.setPaused(!this.paused); break;
      case 'Tab': e.preventDefault(); this.hud.show('scoreboard'); this.hud.renderScoreboard(this.roster, this.me.id); break;
      case 'KeyT': e.preventDefault(); this.openChat(); break;
      case 'KeyV': if (!e.repeat) this.voice.start(); break;
      case 'KeyR': this.startReload(); break;
      case 'Digit1': this.setSlot(0); break;
      case 'Digit2': this.setSlot(1); break;
      case 'Digit3': this.setSlot(2); break;
      case 'KeyE':
        if (this.me.team === 'resistance') this.toggleMenu('traps');
        else this.useSpecial();
        break;
      case 'KeyQ':
        if (this.me.team === 'resistance') this.toggleMenu('build');
        else this.useLunge();
        break;
      case 'KeyF':
        if ((this.phase === PHASE.PREP || this.phase === PHASE.INTERMISSION) && this.running) {
          document.getElementById('readyBtn').click();
        }
        break;
      case 'Space':
        if (this.me.grappledBy) { this.net.send({ t: 'mash' }); this.me.mashHint++; }
        break;
    }
  }
  onKeyUp(e) {
    this.keys[e.code] = false;
    if (e.code === 'KeyV') this.voice.stop();
    if (e.code === 'Tab') this.hud.hide('scoreboard');
  }

  openChat() {
    this.chatOpen = true;
    this.hud.show('chat'); this.hud.show('chatinputwrap');
    const input = this.hud.el.chatinput;
    input.value = '';
    setTimeout(() => input.focus(), 0);
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = input.value.trim();
        if (text) this.net.send({ t: 'chat', text });
        this.closeChat(true);
      } else if (e.key === 'Escape') this.closeChat(false);
    };
    document.exitPointerLock();
  }
  closeChat() {
    this.chatOpen = false;
    this.hud.hide('chatinputwrap');
    this.hud.el.chatinput.blur();
    if (!this.paused) this.lockPointer();
  }

  // =========================================================================
  start(welcome) {
    this.running = true;
    this.me.id = welcome.id;
    this.me.team = welcome.team;
    this.me.cls = welcome.cls;
    this.me.pos.set(welcome.pos[0], welcome.pos[1], welcome.pos[2]);
    this.phase = welcome.ph; this.phaseTimeLeft = welcome.tl; this.round = welcome.rd;
    this.roster = welcome.roster || [];

    if (this.me.team === 'resistance') {
      const h = HEROES[this.me.cls];
      this.me.maxHp = h.hp; this.me.hp = h.hp;
      this.me.secondary = this.netJoin && this.netJoin.secondary || 'pistol';
      this.slots = [h.main, this.me.secondary, h.melee];
      for (const k of [h.main, this.me.secondary]) {
        const w = WEAPONS[k];
        this.ammo[k] = { mag: w.mag, reserve: Math.round(w.reserve * (h.reserveMult || 1)) };
      }
      this.me.coins = 600;
    } else {
      const z = ZCLASSES[this.me.cls];
      this.me.maxHp = z.hp; this.me.hp = z.hp;
      this.slots = ['claw'];
    }
    this.slotIdx = 0;

    // my body (visible in 3rd person)
    this.myMesh = makeCharacter(this.me.team, this.me.cls);
    this.scene.add(this.myMesh);
    this.gunMesh = null;
    this.updateGunMesh();

    for (const tr of welcome.traps || []) this.addTrapMesh(tr);
    for (const b of welcome.builds || []) this.addBuildMesh(b);
    this.world.setBarricadeHp(welcome.bar);
    this.hud.setBarricade(welcome.bar);

    this.hud.hide('menu');
    this.hud.show('hud');
    this.hud.setPhase(this.phase, this.round);
    this.updatePhaseUI();
    this.hud.setCoins(this.me.team === 'resistance' ? this.me.coins : null);
    this.hud.setHp(this.me.hp, this.me.maxHp);
    this.refreshWeaponHud();
    this.lockPointer();
    this.clock.start();
    this.loop();
  }

  updateGunMesh() {
    if (this.gunMesh) { this.myMesh.remove(this.gunMesh); this.gunMesh = null; }
    const key = this.slots[this.slotIdx];
    if (!key || key === 'claw') return;
    this.gunMesh = makeGunMesh(key);
    this.gunMesh.position.set(0.32, 1.18, 0.28);
    this.myMesh.add(this.gunMesh);
  }

  setSlot(i) {
    if (this.me.team !== 'resistance' || i >= this.slots.length) return;
    this.slotIdx = i;
    this.reloadUntil = 0;
    this.menuMode = null; this.refreshTray(); this.killGhost();
    this.refreshWeaponHud();
    this.updateGunMesh();
  }

  toggleMenu(mode) {
    this.menuMode = this.menuMode === mode ? null : mode;
    this.menuIdx = 0;
    this.refreshTray();
    if (this.menuMode) this.makeGhost(); else this.killGhost();
  }

  refreshTray() { this.hud.renderTray(this.menuMode, this.menuIdx, this.me.coins); }

  refreshWeaponHud() {
    const key = this.slots[this.slotIdx];
    if (!key) return;
    const w = WEAPONS[key];
    if (this.me.team === 'zombie') { this.hud.setWeapon('CLAWS', null); return; }
    if (w.melee) this.hud.setWeapon(w.label, null);
    else {
      const a = this.ammo[key];
      this.hud.setWeapon(w.label, a.mag, a.reserve, performance.now() < this.reloadUntil);
    }
  }

  // =========================================================================
  onPrimary() {
    if (!this.me.alive || this.paused) return;
    if (this.menuMode) { this.tryPlace(); return; }
    if (this.me.team === 'zombie') { this.doMelee(); return; }
    const key = this.slots[this.slotIdx];
    const w = WEAPONS[key];
    if (w.melee) this.doMelee();
    else this.tryFire();
  }

  tryFire() {
    const key = this.slots[this.slotIdx];
    const w = WEAPONS[key];
    const nowT = performance.now();
    if (nowT < this.reloadUntil) return;
    if (nowT - this.lastFireT < w.rof * 1000) return;
    const a = this.ammo[key];
    if (a.mag <= 0) { this.startReload(); return; }
    this.lastFireT = nowT;
    a.mag--;
    const dir = this.aimDir();
    const o = this.camera.position.clone().add(dir.clone().multiplyScalar(0.4));
    // keep origin near body for server validation
    const bodyO = this.me.pos.clone().add(new THREE.Vector3(0, EYE, 0));
    this.net.send({ t: 'fire', w: key, o: [bodyO.x, bodyO.y, bodyO.z], d: [dir.x, dir.y, dir.z] });
    this.sfx.play(w.pellets > 1 ? 'shotgun' : 'shot');
    this.spawnTracer(o, dir, w.range);
    this.me.pitch = clamp(this.me.pitch + 0.012 * (w.pellets > 1 ? 2.4 : 1), -1.45, 1.45);
    this.refreshWeaponHud();
    if (a.mag <= 0) this.startReload();
  }

  startReload() {
    if (this.me.team !== 'resistance') return;
    const key = this.slots[this.slotIdx];
    const w = WEAPONS[key];
    if (w.melee) return;
    const a = this.ammo[key];
    if (a.mag >= w.mag || a.reserve <= 0 || performance.now() < this.reloadUntil) return;
    this.reloadUntil = performance.now() + w.reload * 1000;
    this.refreshWeaponHud();
    setTimeout(() => {
      const need = w.mag - a.mag;
      const take = Math.min(need, a.reserve);
      a.mag += take; a.reserve -= take;
      this.refreshWeaponHud();
    }, w.reload * 1000);
  }

  doMelee() {
    const nowT = performance.now();
    const key = this.me.team === 'zombie' ? 'claw' : this.slots[this.slotIdx];
    const w = WEAPONS[key] || WEAPONS.claw;
    if (nowT - this.lastFireT < w.rof * 1000) return;
    this.lastFireT = nowT;
    this.net.send({ t: 'melee', w: key });
    this.sfx.play('growl');
    this.swingArm(this.myMesh);
  }

  useLunge() {
    const t = performance.now() / 1000;
    if (t - this.me.lungeT < LUNGE_CD || !this.me.alive) return;
    this.me.lungeT = t;
    const dir = this.aimDir(); dir.y = 0; dir.normalize();
    this.me.lungeVec = dir;
    this.net.send({ t: 'lunge', d: [dir.x, dir.y, dir.z] });
    this.sfx.play('growl');
  }

  useSpecial() {
    const t = performance.now() / 1000;
    const zc = ZCLASSES[this.me.cls];
    if (!zc || t - this.me.specialT < zc.specialCd || !this.me.alive) return;
    this.me.specialT = t;
    const dir = this.aimDir();
    this.net.send({ t: 'special', d: [dir.x, dir.y, dir.z] });
    if (zc.special === 'leap') {
      this.me.vel.x = dir.x * 14; this.me.vel.z = dir.z * 14; this.me.vel.y = 9;
      this.me.onGround = false;
    }
    if (zc.special === 'adrenaline') this.me.speedBoostUntil = t + 3;
    if (zc.special === 'charge') this.me.chargeUntil = t + 0.9;
    this.sfx.play('growl');
  }

  aimDir() {
    const d = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.me.pitch, this.me.yaw, 0, 'YXZ'));
    return d.normalize();
  }

  // ---- placement ------------------------------------------------------------
  placePoint() {
    // ray from camera to ground/build surface
    const dir = this.aimDir();
    const o = this.camera.position.clone();
    // ground plane y=0 (or y=3 when aiming at elevated spot — keep simple: y=0)
    if (dir.y > -0.05) return null;
    const t = -o.y / dir.y;
    if (t < 0 || t > 26) return null;
    const p = o.add(dir.multiplyScalar(t));
    if (Math.abs(p.x) > MAP.walkHalfW + 2 || p.z < MAP.spawnZ + 24 || p.z > MAP.doorZ - 2) return null;
    return p;
  }

  makeGhost() {
    this.killGhost();
    if (!this.menuMode) return;
    const order = this.menuMode === 'traps' ? TRAP_ORDER : BUILD_ORDER;
    const kind = order[this.menuIdx];
    this.ghost = this.menuMode === 'traps' ? makeTrap(kind) : makeBuild(kind);
    this.ghost.traverse((m) => {
      if (m.material) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.45; }
    });
    this.ghost.userData.kind = kind;
    this.scene.add(this.ghost);
  }
  killGhost() { if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; } }

  tryPlace() {
    const p = this.placePoint();
    if (!p || !this.menuMode) return;
    const order = this.menuMode === 'traps' ? TRAP_ORDER : BUILD_ORDER;
    const kind = order[this.menuIdx];
    const spec = (this.menuMode === 'traps' ? TRAPS : BUILDS)[kind];
    if (this.me.coins < spec.cost) { this.hud.centerMsg('NOT ENOUGH COINS', 900); return; }
    const rotY = Math.round(this.me.yaw / (Math.PI / 2)) * (Math.PI / 2);
    if (this.menuMode === 'traps') this.net.send({ t: 'place', kind, x: p.x, z: p.z, rotY });
    else this.net.send({ t: 'build', kind, x: p.x, y: 0, z: p.z, rotY });
  }

  // =========================================================================
  bindNet() {
    const n = this.net;
    n.on('s', (m) => this.onSnapshot(m));
    n.on('ev', (m) => this.onEvent(m));
    n.on('voice', (m) => this.voice.playIncoming(m));
    n.on('close', () => { if (this.running) this.hud.show('connmsg'); });
    n.on('open', () => this.hud.hide('connmsg'));
  }

  onEvent(m) {
    switch (m.k) {
      case 'spawn': {
        this.me.pos.set(m.pos[0], m.pos[1], m.pos[2]);
        this.me.yaw = m.yaw; this.me.vel.set(0, 0, 0);
        this.me.alive = true; this.me.hp = m.hp;
        this.me.grappledBy = null;
        this.hud.hideDeath();
        this.hud.setHp(this.me.hp, this.me.maxHp);
        break;
      }
      case 'died': {
        this.me.alive = false;
        this.hud.showDeath(m.killer, m.killerIsPlayer, m.respawn);
        break;
      }
      case 'dmg': {
        this.me.hp = m.hp;
        this.hud.setHp(m.hp, this.me.maxHp);
        this.hud.flashDamage();
        break;
      }
      case 'hit': this.hud.hitmarker(m.head); this.sfx.play('hit'); break;
      case 'coins': {
        this.me.coins = m.coins;
        this.hud.setCoins(this.me.coins);
        if (this.menuMode) this.refreshTray();
        break;
      }
      case 'kill': this.hud.killfeed(m.killer, m.victim, m.ai); break;
      case 'join': this.hud.sysMsg(`${m.nick} joined the game`); break;
      case 'leave': {
        this.hud.sysMsg(`${m.nick} left the game`);
        const rp = this.players.get(m.id);
        if (rp) { this.scene.remove(rp.mesh); this.players.delete(m.id); }
        break;
      }
      case 'roster': this.roster = m.roster; if (!this.hud.el.scoreboard.classList.contains('hidden')) this.hud.renderScoreboard(this.roster, this.me.id); break;
      case 'chat': this.hud.chatMsg(m.nick, m.text, m.team); break;
      case 'phase': {
        this.phase = m.ph; this.phaseTimeLeft = m.tl; this.round = m.rd;
        this.hud.setPhase(this.phase, this.round);
        this.updatePhaseUI();
        if (m.ph === PHASE.INTERMISSION) this.hud.centerMsg(`ROUND ${m.rd} CLEARED`);
        break;
      }
      case 'round': {
        this.phase = PHASE.COMBAT; this.round = m.rd;
        this.hud.setPhase(this.phase, this.round);
        this.hud.centerMsg(`ROUND ${m.rd} — THEY'RE COMING`, 3000);
        this.updatePhaseUI();
        this.sfx.play('growl');
        break;
      }
      case 'ready': this.hud.el.readyCount.textContent = `${m.n} / ${m.total} players ready`; break;
      case 'bar': {
        this.hud.setBarricade(m.hp);
        this.world.setBarricadeHp(m.hp);
        break;
      }
      case 'zlives': this.hud.setZLives(m.zl, this._aiLeft); break;
      case 'trapAdd': this.addTrapMesh(m.trap); break;
      case 'trapDel': this.delTrapMesh(m.id); break;
      case 'trapHp': break;
      case 'trapFire': {
        const t = this.trapMeshes.get(m.id);
        if (t && m.kind === 'mine') this.sfx.play('boom');
        break;
      }
      case 'trapState': {
        const t = this.trapMeshes.get(m.id);
        if (t && t.userData.flame) t.userData.flame.visible = !!m.on;
        if (t && t.userData.led) t.userData.led.material.color.set(m.on ? 0xff2266 : 0x22ff66);
        break;
      }
      case 'turretShot': {
        const t = this.trapMeshes.get(m.id);
        if (t) {
          const from = t.position.clone().add(new THREE.Vector3(0, 0.8, 0));
          const to = new THREE.Vector3(...m.to);
          this.spawnBeam(from, to, 0xffee88);
          if (t.userData.head) t.userData.head.lookAt(to.x, 0.8, to.z);
        }
        break;
      }
      case 'buildAdd': this.addBuildMesh(m.build); break;
      case 'buildDel': this.delBuildMesh(m.id); break;
      case 'buildHp': {
        const b = this.buildMeshes.get(m.id);
        if (b) b.children[0].material = b.children[0].material; // hp bars omitted; flash instead
        break;
      }
      case 'boom': {
        this.spawnExplosion(new THREE.Vector3(m.x, m.y, m.z), m.r);
        this.sfx.play('boom');
        break;
      }
      case 'thriller': this.sfx.play('thriller'); break;
      case 'dance': { this.me.danceUntil = performance.now() / 1000 + m.dur; this.hud.centerMsg('🕺 YOU CAN\'T HELP DANCING', 1400); break; }
      case 'held': { this.me.heldUntil = performance.now() / 1000 + m.until; this.hud.centerMsg('BEAR TRAP! HOLD ON...', 1200); break; }
      case 'tracer': {
        const o = new THREE.Vector3(...m.o), d = new THREE.Vector3(...m.d);
        this.spawnTracer(o, d, (WEAPONS[m.w] || {}).range || 60);
        break;
      }
      case 'swing': {
        const rp = this.players.get(m.id);
        if (rp) this.swingArm(rp.mesh);
        break;
      }
      case 'lunge': {
        if (m.id === this.me.id && this.me.lungeVec) {
          this.me.vel.x = this.me.lungeVec.x * 16; this.me.vel.z = this.me.lungeVec.z * 16;
        }
        break;
      }
      case 'special': {
        if (m.kind === 'spit') this.sfx.play('growl');
        break;
      }
      case 'grapple': {
        if (m.h === this.me.id) {
          this.me.grappledBy = m.z; this.me.mashHint = 0;
          this.hud.centerMsg('GRABBED! MASH SPACE TO BREAK FREE!', 2500);
        }
        if (m.z === this.me.id) this.hud.centerMsg('YOU GOT ONE! HOLD ON!', 1500);
        break;
      }
      case 'grappleEnd': {
        if (m.h === this.me.id) {
          this.me.grappledBy = null;
          if (m.escaped) this.hud.centerMsg('BROKE FREE!', 1200);
        }
        break;
      }
      case 'knockback': {
        const d = new THREE.Vector3(m.dir[0], 0, m.dir[2]).normalize();
        this.me.vel.x += d.x * 12; this.me.vel.z += d.z * 12; this.me.vel.y += 5;
        break;
      }
      case 'aiDie': {
        const a = this.aiz.get(m.id);
        if (a) { this.deathPuff(a.mesh.position); this.scene.remove(a.mesh); this.aiz.delete(m.id); }
        break;
      }
      case 'splat': {
        this.spawnSplat(new THREE.Vector3(m.x, m.y, m.z));
        break;
      }
      case 'roundClear': this.hud.centerMsg(`ROUND ${m.rd} CLEARED! BONUS COINS AWARDED`, 3200); break;
      case 'gameOver': {
        this.hud.showEnd(m.winner, m.reason);
        document.exitPointerLock();
        break;
      }
      case 'reset': {
        this.hud.hide('end');
        this.hud.hideDeath();
        for (const [, t] of this.trapMeshes) this.scene.remove(t);
        this.trapMeshes.clear();
        for (const [, b] of this.buildMeshes) this.scene.remove(b);
        this.buildMeshes.clear(); this.buildData.clear();
        if (this.me.team === 'resistance') { this.me.coins = 600; this.hud.setCoins(600); }
        this.lockPointer();
        break;
      }
    }
  }

  updatePhaseUI() {
    const prepish = this.phase === PHASE.PREP || this.phase === PHASE.INTERMISSION;
    if (prepish) {
      this.hud.show('readywrap');
      const b = document.getElementById('readyBtn');
      b.classList.remove('done');
      b.textContent = (this.phase === PHASE.PREP ? 'READY — START EARLY' : 'READY FOR NEXT ROUND') + ' [F]';
      this.hud.el.readyCount.textContent = '';
    } else this.hud.hide('readywrap');
  }

  // ---- meshes ----------------------------------------------------------------
  addTrapMesh(tr) {
    if (this.trapMeshes.has(tr.id)) return;
    const m = makeTrap(tr.kind);
    m.position.set(tr.x, 0, tr.z);
    m.rotation.y = tr.rotY || 0;
    this.scene.add(m);
    this.trapMeshes.set(tr.id, m);
  }
  delTrapMesh(id) {
    const m = this.trapMeshes.get(id);
    if (m) { this.scene.remove(m); this.trapMeshes.delete(id); }
  }
  addBuildMesh(b) {
    if (this.buildMeshes.has(b.id)) return;
    const m = makeBuild(b.kind);
    m.position.set(b.x, b.y, b.z);
    m.rotation.y = b.rotY || 0;
    this.scene.add(m);
    this.buildMeshes.set(b.id, m);
    this.buildData.set(b.id, b);
  }
  delBuildMesh(id) {
    const m = this.buildMeshes.get(id);
    if (m) { this.scene.remove(m); this.buildMeshes.delete(id); this.buildData.delete(id); }
  }

  // ---- effects ----------------------------------------------------------------
  spawnTracer(origin, dir, range) {
    const len = Math.min(range, 60);
    const end = origin.clone().add(dir.clone().multiplyScalar(len));
    this.spawnBeam(origin, end, 0xfff2aa, 0.05);
  }
  spawnBeam(from, to, color, ttl = 0.07) {
    const g = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    this.scene.add(line);
    this.effects.push({ obj: line, until: performance.now() + ttl * 1000 });
  }
  spawnExplosion(pos, r) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.9 }));
    s.position.copy(pos);
    s.userData.grow = r;
    this.scene.add(s);
    this.effects.push({ obj: s, until: performance.now() + 300, anim: (o, f) => { o.scale.setScalar(1 + f * r * 1.6); o.material.opacity = 0.9 * (1 - f); } });
  }
  spawnSplat(pos) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), new THREE.MeshBasicMaterial({ color: 0x88cc33, transparent: true, opacity: 0.8 }));
    s.position.copy(pos);
    this.scene.add(s);
    this.effects.push({ obj: s, until: performance.now() + 350, anim: (o, f) => { o.scale.setScalar(1 + f * 2); o.material.opacity = 0.8 * (1 - f); } });
  }
  deathPuff(pos) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), new THREE.MeshBasicMaterial({ color: 0x446633, transparent: true, opacity: 0.55 }));
    s.position.copy(pos).add(new THREE.Vector3(0, 0.8, 0));
    this.scene.add(s);
    this.effects.push({ obj: s, until: performance.now() + 420, anim: (o, f) => { o.scale.setScalar(1 + f * 1.6); o.material.opacity = 0.55 * (1 - f); } });
  }
  swingArm(mesh) {
    const limbs = mesh.userData.limbs;
    if (!limbs) return;
    mesh.userData.swingT = performance.now();
  }

  // ---- snapshots ------------------------------------------------------------------
  onSnapshot(m) {
    this.phase = m.ph; this.phaseTimeLeft = m.tl; this.round = m.rd;
    this.hud.setBarricade(m.bar);
    this._aiLeft = m.qn;
    this.hud.setZLives(m.zl, m.qn);
    const seen = new Set();
    for (const row of m.pl) {
      const [id, x, y, z, yaw, pitch, hp, alive, anim, grap] = row;
      if (id === this.me.id) {
        // reconcile hp only (position is client-predicted, server soft-corrects)
        continue;
      }
      seen.add(id);
      let rp = this.players.get(id);
      if (!rp) {
        const info = this.roster.find(r => r.id === id) || { team: 'zombie', cls: 'runner', nick: '???' };
        rp = { mesh: makeCharacter(info.team, info.cls), team: info.team, cls: info.cls, prev: null, target: null, anim: 0 };
        // heroes get nametags; player zombies are indistinguishable from the horde (undetectable)
        if (info.team === 'resistance') {
          const tag = nameSprite(info.nick);
          tag.position.y = 2.25;
          rp.mesh.add(tag);
        } else if (this.me.team === 'zombie') {
          const tag = nameSprite(info.nick, '#b76fff');
          tag.position.y = 2.25;
          rp.mesh.add(tag);
        }
        this.scene.add(rp.mesh);
        this.players.set(id, rp);
      }
      rp.prev = rp.target || { x, y, z, yaw };
      rp.target = { x, y, z, yaw, t: performance.now() };
      rp.anim = anim; rp.alive = !!alive; rp.grap = grap;
      rp.mesh.visible = !!alive;
    }
    for (const [id, rp] of this.players) {
      if (!seen.has(id)) { this.scene.remove(rp.mesh); this.players.delete(id); }
    }

    const seenAi = new Set();
    for (const row of m.ai) {
      const [id, kindC, x, z, hp, st] = row;
      seenAi.add(id);
      let a = this.aiz.get(id);
      if (!a) {
        const kind = { w: 'walker', r: 'runner', b: 'brute', e: 'exploder' }[kindC] || 'walker';
        a = { mesh: makeAIZombie(kind), kind, prev: null, target: null, seed: Math.random() * 10 };
        this.scene.add(a.mesh);
        this.aiz.set(id, a);
      }
      a.prev = a.target || { x, z };
      a.target = { x, z, t: performance.now() };
      a.st = st;
    }
    for (const [id, a] of this.aiz) {
      if (!seenAi.has(id)) { this.scene.remove(a.mesh); this.aiz.delete(id); }
    }

    const seenPr = new Set();
    for (const [id, x, y, z] of m.pr) {
      seenPr.add(id);
      let p = this.projs.get(id);
      if (!p) {
        p = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshBasicMaterial({ color: 0x99dd22 }));
        this.scene.add(p);
        this.projs.set(id, p);
      }
      p.position.set(x, y, z);
    }
    for (const [id, p] of this.projs) {
      if (!seenPr.has(id)) { this.scene.remove(p); this.projs.delete(id); }
    }
  }

  // =========================================================================
  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = performance.now() / 1000;

    if (this.running) {
      this.tickMovement(dt, t);
      this.tickCamera(dt);
      this.tickRemotes(dt, t);
      this.tickHud(t);
      this.tickEffects();
      this.tickGhost();
      if (this.mouseDown && this.pointerLocked && !this.menuMode && this.me.team === 'resistance' && this.me.alive) {
        const w = WEAPONS[this.slots[this.slotIdx]];
        if (w && !w.melee && w.rof < 0.2) this.tryFire(); // full-auto
      }
      // send input
      if (t - this.lastInputSend > 1 / INPUT_RATE) {
        this.lastInputSend = t;
        this.net.send({ t: 'in', x: this.me.pos.x, y: this.me.pos.y, z: this.me.pos.z, yaw: this.me.yaw, pitch: this.me.pitch, a: this.moving ? 1 : 0 });
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  groundHeightAt(x, z) {
    let h = 0;
    // elevated floors
    for (const b of this.buildData.values()) {
      if (b.kind === 'floor' && Math.abs(x - b.x) <= 2 && Math.abs(z - b.z) <= 2) {
        const top = b.y + 0.3;
        if (top > h && top <= this.me.pos.y + 1.2) h = top;
      }
      if (b.kind === 'ramp' && Math.abs(x - b.x) <= 2 && Math.abs(z - b.z) <= 2.5) {
        const dx = x - b.x, dz = z - b.z;
        const along = dx * Math.sin(b.rotY) + dz * Math.cos(b.rotY);
        const f = clamp((along + 2.5) / 5, 0, 1);
        const top = b.y + f * 3;
        if (top > h && top <= this.me.pos.y + 1.3) h = top;
      }
    }
    // sidewalks
    if (Math.abs(x) > MAP.roadHalfW && Math.abs(x) < MAP.walkHalfW && h < 0.25) h = 0.25;
    return h;
  }

  collideSolids(pos, r = 0.5) {
    const walls = [...this.world.solids];
    for (const b of this.buildData.values()) {
      if (b.kind === 'wall') {
        const c = Math.abs(Math.cos(b.rotY)) > 0.5;
        walls.push(c
          ? { min: [b.x - 2, b.y, b.z - 0.35], max: [b.x + 2, b.y + 3, b.z + 0.35] }
          : { min: [b.x - 0.35, b.y, b.z - 2], max: [b.x + 0.35, b.y + 3, b.z + 2] });
      }
    }
    for (const s of walls) {
      if (pos.y > s.max[1] - 0.2 || pos.y + 1.7 < s.min[1]) continue;
      const cx = clamp(pos.x, s.min[0], s.max[0]);
      const cz = clamp(pos.z, s.min[2], s.max[2]);
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 0.001;
        pos.x += (dx / d) * (r - d);
        pos.z += (dz / d) * (r - d);
      }
    }
  }

  tickMovement(dt, t) {
    const me = this.me;
    if (!me.alive) return;

    // grappled: locked to zombie
    if (me.grappledBy) {
      const z = this.players.get(me.grappledBy);
      if (z && z.target) {
        me.pos.x = z.target.x + 0.7; me.pos.z = z.target.z; me.pos.y = z.target.y || 0;
      }
      return;
    }
    const held = t < me.heldUntil;
    const dancing = t < me.danceUntil;

    const base = me.team === 'resistance' ? HEROES[me.cls] : ZCLASSES[me.cls];
    let speed = this.keys.ShiftLeft || this.keys.ShiftRight ? base.sprint : base.walk;
    if (t < me.speedBoostUntil) speed *= 1.6;
    if (t < me.chargeUntil) speed = 20;
    if (this.rmb && me.team === 'resistance') speed *= 0.55;
    if (held || dancing) speed = 0;

    const f = new THREE.Vector3(Math.sin(me.yaw), 0, Math.cos(me.yaw)).multiplyScalar(-1);
    const rgt = new THREE.Vector3(-f.z, 0, f.x);
    const wish = new THREE.Vector3();
    if (this.keys.KeyW) wish.add(f);
    if (this.keys.KeyS) wish.sub(f);
    if (this.keys.KeyD) wish.add(rgt);
    if (this.keys.KeyA) wish.sub(rgt);
    this.moving = wish.lengthSq() > 0;
    if (this.moving) wish.normalize().multiplyScalar(speed);

    // horizontal velocity: lunges/charges preserve momentum, else direct control
    const lunging = me.lungeVec && (t - me.lungeT) < LUNGE_TIME;
    if (lunging) {
      me.vel.x = me.lungeVec.x * 16; me.vel.z = me.lungeVec.z * 16;
    } else if (Math.abs(me.vel.x) > speed + 1 || Math.abs(me.vel.z) > speed + 1) {
      me.vel.x *= 1 - 6 * dt; me.vel.z *= 1 - 6 * dt; // decay knockback
      me.vel.x += wish.x * 2 * dt; me.vel.z += wish.z * 2 * dt;
    } else {
      me.vel.x = wish.x; me.vel.z = wish.z;
    }

    // gravity & jump
    const groundH = this.groundHeightAt(me.pos.x, me.pos.z);
    if (me.onGround && (this.keys.Space) && !held && !dancing && !me.grappledBy) {
      me.vel.y = JUMP_V; me.onGround = false;
    }
    me.vel.y -= GRAVITY * dt;
    me.pos.x += me.vel.x * dt;
    me.pos.z += me.vel.z * dt;
    me.pos.y += me.vel.y * dt;
    if (me.pos.y <= groundH) { me.pos.y = groundH; me.vel.y = 0; me.onGround = true; }
    else if (me.pos.y > groundH + 0.05) me.onGround = false;

    me.pos.x = clamp(me.pos.x, -MAP.walkHalfW - 12, MAP.walkHalfW + 12);
    me.pos.z = clamp(me.pos.z, MAP.minZ + 1, MAP.maxZ - 1);
    this.collideSolids(me.pos);

    // my mesh follows
    if (this.myMesh) {
      this.myMesh.position.copy(me.pos);
      this.myMesh.rotation.y = me.yaw + Math.PI;
      this.animateLimbs(this.myMesh, this.moving ? (this.keys.ShiftLeft ? 2 : 1) : 0, t, dancing);
    }
  }

  tickCamera(dt) {
    const me = this.me;
    const eye = me.pos.clone().add(new THREE.Vector3(0, EYE, 0));
    const dir = this.aimDir();
    const w = WEAPONS[this.slots[this.slotIdx]] || {};
    const aiming = this.rmb && me.team === 'resistance' && !w.melee;
    const fps = aiming && w.ads === 'fps';

    let targetFov = 75;
    if (aiming) targetFov = fps ? (this.slots[this.slotIdx] === 'sniper' ? 24 : 42) : 58;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
    this.camera.updateProjectionMatrix();

    if (!me.alive) {
      // death cam: slow orbit above body
      const tt = performance.now() / 1000;
      this.camera.position.set(me.pos.x + Math.sin(tt * 0.5) * 6, me.pos.y + 7, me.pos.z + Math.cos(tt * 0.5) * 6);
      this.camera.lookAt(me.pos.x, me.pos.y + 1, me.pos.z);
      if (this.myMesh) this.myMesh.visible = false;
      return;
    }

    if (fps) {
      this.camera.position.copy(eye);
      if (this.myMesh) this.myMesh.visible = false;
    } else {
      const back = dir.clone().multiplyScalar(aiming ? -1.8 : -3.4);
      const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(0.65);
      const camPos = eye.clone().add(back).add(right).add(new THREE.Vector3(0, 0.25, 0));
      // keep camera out of walls
      if (camPos.y < 0.3) camPos.y = 0.3;
      this.camera.position.lerp(camPos, Math.min(1, dt * 18));
      if (this.myMesh) this.myMesh.visible = true;
    }
    this.camera.lookAt(eye.clone().add(dir.multiplyScalar(30)));
  }

  animateLimbs(mesh, moveLevel, t, dancing) {
    const L = mesh.userData.limbs;
    if (!L) return;
    const sw = mesh.userData.swingT && performance.now() - mesh.userData.swingT < 250;
    if (dancing) {
      const ph = t * 8;
      L.armL.rotation.x = Math.sin(ph) * 1.8 - 1.2;
      L.armR.rotation.x = Math.sin(ph + Math.PI) * 1.8 - 1.2;
      mesh.rotation.y += Math.sin(ph * 0.5) * 0.1;
      return;
    }
    const ph = t * (moveLevel === 2 ? 11 : 7);
    const amp = moveLevel ? (moveLevel === 2 ? 0.9 : 0.55) : 0;
    L.legL.rotation.x = Math.sin(ph) * amp;
    L.legR.rotation.x = Math.sin(ph + Math.PI) * amp;
    if (sw) {
      L.armR.rotation.x = -2.4 + Math.sin(t * 30) * 0.4;
    } else if (mesh.userData.zombieArms) {
      L.armL.rotation.x = -1.35; L.armR.rotation.x = -1.35;
    } else {
      L.armL.rotation.x = Math.sin(ph + Math.PI) * amp * 0.7;
      L.armR.rotation.x = Math.sin(ph) * amp * 0.7;
    }
  }

  tickRemotes(dt, t) {
    const lerpT = 1000 / 12;
    for (const rp of this.players.values()) {
      if (!rp.target) continue;
      const f = clamp((performance.now() - rp.target.t) / lerpT, 0, 1);
      const px = rp.prev ? rp.prev.x : rp.target.x;
      const py = rp.prev ? (rp.prev.y || 0) : (rp.target.y || 0);
      const pz = rp.prev ? rp.prev.z : rp.target.z;
      rp.mesh.position.set(px + (rp.target.x - px) * f, py + ((rp.target.y || 0) - py) * f, pz + (rp.target.z - pz) * f);
      let pyaw = rp.prev ? rp.prev.yaw : rp.target.yaw;
      let dy = rp.target.yaw - pyaw;
      if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
      rp.mesh.rotation.y = pyaw + dy * f + Math.PI;
      const moved = rp.prev && (Math.abs(rp.target.x - rp.prev.x) + Math.abs(rp.target.z - rp.prev.z)) > 0.03;
      this.animateLimbs(rp.mesh, moved ? 1 : 0, t + (rp.seed || 0), false);
    }
    for (const a of this.aiz.values()) {
      if (!a.target) continue;
      const f = clamp((performance.now() - a.target.t) / lerpT, 0, 1);
      const px = a.prev ? a.prev.x : a.target.x;
      const pz = a.prev ? a.prev.z : a.target.z;
      const x = px + (a.target.x - px) * f, z = pz + (a.target.z - pz) * f;
      a.mesh.position.set(x, 0, z);
      if (a.prev && (Math.abs(a.target.x - a.prev.x) + Math.abs(a.target.z - a.prev.z)) > 0.01) {
        a.mesh.rotation.y = Math.atan2(a.target.x - px, a.target.z - pz);
      }
      const dancing = (a.st & 4) !== 0;
      const held = (a.st & 2) !== 0;
      a.mesh.userData.zombieArms = true;
      this.animateLimbs(a.mesh, held ? 0 : 1, t + a.seed, dancing);
      // burn tint
      const burning = (a.st & 1) !== 0;
      if (burning !== a._burnShown) {
        a._burnShown = burning;
        a.mesh.traverse(mm => { if (mm.material && mm.material.emissive) mm.material.emissive = new THREE.Color(burning ? 0x662200 : 0x000000); });
      }
    }
    // flickering street lights
    for (const fl of this.world.flickers) {
      fl.light.intensity = fl.base * (0.55 + 0.45 * Math.abs(Math.sin(t * 9 + fl.seed) * Math.sin(t * 2.3 + fl.seed * 3)));
      fl.bulb.visible = fl.light.intensity > fl.base * 0.4;
    }
    // barricade shake when nearly broken
    if (this.world.barricade.userData.shake) {
      this.world.barricade.position.x = Math.sin(t * 40) * 0.03;
    }
  }

  tickHud(t) {
    this.hud.setTimer(this.phaseTimeLeft);
    this.phaseTimeLeft = Math.max(0, this.phaseTimeLeft - 1 / 60);
    this.hud.setPhase(this.phase, this.round);
    this.hud.tickDeath();
    const meR = this.roster.find(r => r.id === this.me.id);
    if (meR) this.hud.setScore(meR.score || 0);

    if (this.me.team === 'zombie') {
      const zc = ZCLASSES[this.me.cls];
      const lungeFrac = clamp(1 - (t - this.me.lungeT) / LUNGE_CD, 0, 1);
      const spFrac = clamp(1 - (t - this.me.specialT) / zc.specialCd, 0, 1);
      this.hud.renderCooldowns([
        { key: 'Q', label: 'LUNGE', frac: lungeFrac },
        { key: 'E', label: zc.special.toUpperCase(), frac: spFrac },
      ]);
      const nearDoor = this.me.pos.z > MAP.doorZ - 6;
      this.hud.el.interact.textContent = nearDoor ? 'CLAW THE BARRICADE!' : '';
    } else {
      this.hud.renderCooldowns([
        { key: 'Q', label: 'BUILD MENU', frac: 0 },
        { key: 'E', label: 'TRAPS MENU', frac: 0 },
      ]);
      this.hud.el.interact.textContent = this.me.grappledBy ? 'MASH SPACE!' : '';
    }
    if (performance.now() < this.reloadUntil) this.refreshWeaponHud();
  }

  tickEffects() {
    const nowMs = performance.now();
    this.effects = this.effects.filter(e => {
      if (nowMs > e.until) { this.scene.remove(e.obj); return false; }
      if (e.anim) {
        const total = e.until - (e.start || (e.start = e.until - 300));
        e.anim(e.obj, 1 - (e.until - nowMs) / 300);
      }
      return true;
    });
    // mine blinkers, flame flicker
    for (const m of this.trapMeshes.values()) {
      if (m.userData.blinker) m.userData.blinker.material.color.set((nowMs / 400 | 0) % 2 ? 0xff3333 : 0x661111);
      if (m.userData.flame && m.userData.flame.visible) {
        m.userData.flame.scale.setScalar(0.9 + Math.random() * 0.25);
      }
    }
  }

  tickGhost() {
    if (!this.ghost) return;
    const p = this.placePoint();
    if (!p) { this.ghost.visible = false; return; }
    this.ghost.visible = true;
    const g = this.menuMode === 'traps' ? MAP.gridTrap : MAP.gridBuild;
    this.ghost.position.set(Math.round(p.x / g) * g, 0, Math.round(p.z / g) * g);
    this.ghost.rotation.y = Math.round(this.me.yaw / (Math.PI / 2)) * (Math.PI / 2);
  }
}

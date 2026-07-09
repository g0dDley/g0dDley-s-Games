// HUD, menus, chat, scoreboard, overlays.
import { TRAPS, TRAP_ORDER, BUILDS, BUILD_ORDER, WEAPONS, HEROES, ZCLASSES,
         ZCLASS_ORDER, ZITEMS, ZITEM_ORDER, BARRICADE_MAX_HP, PHASE,
         ROOM_MAX, MAX_RESISTANCE } from './shared.js';

const $ = (id) => document.getElementById(id);

// 2D weapon preview illustration — recognisable silhouette per weapon category.
export function drawWeaponPreview(canvas, key) {
  const w = WEAPONS[key]; if (!canvas || !w) return;
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0a0f1a'; g.fillRect(0, 0, W, H);
  g.save();
  g.translate(W * 0.16, H * 0.58);
  const S = W / 440;                 // scale to design units
  g.scale(S, S);
  const metal = '#3a4250', dark = '#20252e', wood = '#6a4a26', accent = '#7df9ff';
  const box = (x, y, ww, hh, c) => { g.fillStyle = c; g.fillRect(x, y, ww, hh); };
  if (key === 'ar' || key === 'smg') {
    box(0, 0, 210, 26, metal); box(150, -6, 60, 20, dark); box(40, 26, 34, 46, dark); // mag
    box(196, 4, 60, 12, dark); box(-6, 2, 30, 20, wood);                             // barrel/stock
    if (key === 'smg') { box(0, 0, 130, 22, metal); box(110, 4, 40, 10, dark); }
  } else if (key === 'sniper') {
    box(-20, 6, 300, 18, metal); box(60, -14, 90, 14, dark); box(70, -20, 16, 12, dark); // scope
    box(-40, 8, 34, 22, wood);
  } else if (key === 'pistol') {
    box(60, 0, 90, 22, metal); box(70, 20, 34, 50, dark);
  } else if (key === 'icebreaker' || key === 'pump' || key === 'doublebarrel') {
    box(0, 4, 250, 22, wood); box(200, 6, 80, 8, dark); box(206, 16, 80, 8, dark);   // twin barrels
    box(30, 26, 30, 40, dark);
  } else if (key === 'crossbow') {
    box(20, 6, 200, 16, wood); box(70, -46, 12, 100, dark);                          // bow limb
    box(210, 8, 70, 8, accent);                                                      // bolt
  } else { // melee
    box(30, -50, 14, 120, wood); box(10, -60, 54, 22, metal);
  }
  g.restore();
  g.fillStyle = accent; g.font = 'bold 20px sans-serif';
  g.fillText(w.label, 14, 26);
  g.fillStyle = '#9db2cc'; g.font = '12px sans-serif';
  const stat = w.melee ? `${w.dmg} dmg melee` : `${w.dmg}${w.pellets > 1 ? '×' + w.pellets : ''} dmg · ${(1 / w.rof).toFixed(1)}/s`;
  g.fillText(stat, 14, H - 12);
}

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), menu: $('menu'), phase: $('phase'), timer: $('timer'),
      barfill: $('barfill'), zlives: $('zlives'), scoreval: $('scoreval'), wavecount: $('wavecount'),
      hpfill: $('hpfill'), hptext: $('hptext'), coins: $('coins'),
      weaponname: $('weaponname'), ammo: $('ammo'), reloadmsg: $('reloadmsg'),
      killfeed: $('killfeed'), tray: $('tray'), cds: $('cds'),
      readywrap: $('readywrap'), readyBtn: $('readyBtn'), readyCount: $('readyCount'),
      centerMsg: $('centerMsg'), micind: $('micind'), interact: $('interact'),
      hitmarker: $('hitmarker'), dmgvig: $('dmgvig'),
      scoreboard: $('scoreboard'), sbbody: $('sbbody'),
      chat: $('chat'), chatlog: $('chatlog'), chatinputwrap: $('chatinputwrap'), chatinput: $('chatinput'),
      pause: $('pause'), death: $('death'), deathBy: $('deathBy'), deathTimer: $('deathTimer'),
      end: $('end'), endTitle: $('endTitle'), endReason: $('endReason'), endNext: $('endNext'),
      connmsg: $('connmsg'), crosshair: $('crosshair'),
      zpts: $('zpts'), zptsNum: $('zptsNum'), zptsHint: $('zptsHint'),
      arEnergy: $('arEnergy'), arShield: $('arShield'), arHelmet: $('arHelmet'),
      upgrade: $('upgrade'), upPts: $('upPts'), upClassGrid: $('upClassGrid'), upItemGrid: $('upItemGrid'),
      splash: $('splash'),
      lobby: $('lobby'), lobbyGrid: $('lobbyGrid'), lobbyCount: $('lobbyCount'), lobbySub: $('lobbySub'),
      startBtn: $('startBtn'), fillBtn: $('fillBtn'), leaveBtn: $('leaveBtn'),
    };
    this._centerT = null;
    this._hitT = null;
  }

  // ---- zombie points + armor ------------------------------------------------
  showZombieUi(on) { this.el.zpts.classList.toggle('on', !!on); }

  setPoints(pts, canUpgrade) {
    this.el.zptsNum.textContent = Math.floor(pts);
    this.el.zptsHint.textContent = canUpgrade ? 'B — UPGRADE AVAILABLE ✦' : 'B — Upgrade';
    this.el.zptsHint.style.color = canUpgrade ? '#b7ff6f' : '#7d8aa0';
  }

  setArmor(a) {
    const bar = (el, hp, max) => {
      el.style.display = max > 0 ? 'block' : 'none';
      if (max > 0) el.querySelector('i').style.width = `${Math.max(0, Math.min(1, hp / max)) * 100}%`;
    };
    bar(this.el.arEnergy, a.energy, a.energyMax);
    bar(this.el.arShield, a.shield, a.shieldMax);
    bar(this.el.arHelmet, a.helmet, a.helmetMax);
  }

  show(name) { this.el[name].classList.remove('hidden'); }
  hide(name) { this.el[name].classList.add('hidden'); }

  setPhase(phase, round) {
    const names = {
      [PHASE.PREP]: 'PREPARATION — PLACE YOUR TRAPS',
      [PHASE.COMBAT]: `ROUND ${round} / 3`,
      [PHASE.INTERMISSION]: `ROUND ${round} CLEARED — REBUILD`,
      [PHASE.END]: 'MATCH OVER',
    };
    this.el.phase.textContent = names[phase] || phase.toUpperCase();
  }

  setTimer(seconds) {
    if (seconds > 9000) { this.el.timer.textContent = ''; return; }
    const s = Math.max(0, Math.ceil(seconds));
    this.el.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  setBarricade(hp) {
    this.el.barfill.style.width = `${(hp / BARRICADE_MAX_HP) * 100}%`;
  }
  setZLives(n, aiLeft) {
    this.el.zlives.textContent = `ZOMBIE LIVES: ${n}` + (aiLeft !== undefined ? `  ·  HORDE LEFT: ${aiLeft}` : '');
  }
  setScore(v) { this.el.scoreval.textContent = v; }

  setHp(hp, max) {
    this.el.hpfill.style.width = `${Math.max(0, hp / max) * 100}%`;
    this.el.hptext.textContent = `${Math.max(0, Math.round(hp))} HP`;
    this.el.dmgvig.style.opacity = hp < max * 0.35 ? 0.6 : 0;
  }
  setCoins(c) { this.el.coins.textContent = c === null ? '' : `⛁ ${c} COINS`; }

  setWeapon(label, mag, reserve, reloading) {
    this.el.weaponname.textContent = label;
    if (mag === null) { this.el.ammo.innerHTML = '—'; }
    else this.el.ammo.innerHTML = `${mag} <small>/ ${reserve}</small>`;
    this.el.reloadmsg.textContent = reloading ? 'RELOADING...' : '';
  }

  flashDamage() {
    this.el.dmgvig.style.opacity = 0.85;
    clearTimeout(this._vigT);
    this._vigT = setTimeout(() => { this.el.dmgvig.style.opacity = 0; }, 220);
  }

  hitmarker(head) {
    const hm = this.el.hitmarker;
    hm.classList.toggle('head', !!head);
    hm.style.opacity = 1;
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => { hm.style.opacity = 0; }, 140);
  }

  killfeed(killer, victim, ai) {
    const div = document.createElement('div');
    div.className = 'kf';
    div.innerHTML = `<b></b> ☠ <i></i>`;
    div.querySelector('b').textContent = killer;
    div.querySelector('i').textContent = victim + (ai ? '' : '');
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.lastChild.remove();
    setTimeout(() => div.remove(), 7000);
  }

  centerMsg(text, ms = 2600) {
    this.el.centerMsg.textContent = text;
    this.el.centerMsg.style.opacity = 1;
    clearTimeout(this._centerT);
    this._centerT = setTimeout(() => { this.el.centerMsg.style.opacity = 0; }, ms);
  }

  // ---- trays ----------------------------------------------------------------
  renderTray(mode, index, coins) {
    // mode: null | 'traps' | 'build'
    const tray = this.el.tray;
    tray.innerHTML = '';
    if (!mode) return;
    const order = mode === 'traps' ? TRAP_ORDER : BUILD_ORDER;
    const specs = mode === 'traps' ? TRAPS : BUILDS;
    order.forEach((k, i) => {
      const s = specs[k];
      const d = document.createElement('div');
      d.className = 'slot' + (i === index ? ' sel' : '') + (coins < s.cost ? ' cant' : '');
      d.innerHTML = `<div class="nm"></div><div class="price">${s.cost} ⛁</div>`;
      d.querySelector('.nm').textContent = s.label;
      tray.appendChild(d);
    });
    const hint = document.createElement('div');
    hint.className = 'slot';
    hint.innerHTML = `<div class="nm">${mode === 'traps' ? 'E' : 'Q'} CLOSE</div><div class="price">SCROLL · LMB PLACE</div>`;
    tray.appendChild(hint);
  }

  renderCooldowns(items) {
    // items: [{key:'Q', label, frac (0..1 remaining)}]
    this.el.cds.innerHTML = '';
    for (const it of items) {
      const d = document.createElement('div');
      d.className = 'cd';
      d.innerHTML = `<span></span><div class="cdkey">${it.key}<div class="fill" style="height:${Math.round(it.frac * 100)}%"></div></div>`;
      d.querySelector('span').textContent = it.label;
      this.el.cds.appendChild(d);
    }
  }

  // ---- scoreboard --------------------------------------------------------------
  renderScoreboard(roster, myId) {
    const rows = [...roster].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    this.el.sbbody.innerHTML = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      if (r.id === myId) tr.className = 'me';
      const teamCls = r.team === 'resistance' ? 'res' : 'zom';
      const teamName = r.team === 'resistance' ? 'RESISTANCE' : 'ZOMBIES';
      tr.innerHTML = `<td></td><td class="${teamCls}">${teamName}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.score || 0}</td>`;
      tr.children[0].textContent = r.nick + (r.id === myId ? ' (you)' : '');
      this.el.sbbody.appendChild(tr);
    }
  }

  // ---- chat ---------------------------------------------------------------------
  chatLine(html, cls = '') {
    const div = document.createElement('div');
    div.className = 'chatline ' + cls;
    div.innerHTML = html;
    this.el.chatlog.appendChild(div);
    while (this.el.chatlog.children.length > 10) this.el.chatlog.firstChild.remove();
    this.show('chat');
    clearTimeout(div._t);
    setTimeout(() => { div.remove(); }, 12000);
  }
  chatMsg(nick, text, team) {
    const div = document.createElement('div');
    div.className = 'chatline' + (team === 'zombie' ? ' zteam' : '');
    const n = document.createElement('span'); n.className = 'nick'; n.textContent = nick + ': ';
    const t = document.createElement('span'); t.textContent = text;
    div.append(n, t);
    this.el.chatlog.appendChild(div);
    while (this.el.chatlog.children.length > 10) this.el.chatlog.firstChild.remove();
    this.show('chat');
    setTimeout(() => { div.remove(); }, 12000);
  }
  sysMsg(text) { this.chatLine('', 'sys'); this.el.chatlog.lastChild.textContent = text; }

  // ---- death / end ----------------------------------------------------------------
  showDeath(killer, isPlayer, respawn) {
    this.show('death');
    this.el.deathBy.textContent = `Killed by: ${killer} (${isPlayer ? 'Player' : 'AI'})`;
    this._deathRespawn = respawn > 0 ? performance.now() + respawn * 1000 : null;
    if (respawn <= 0) this.el.deathTimer.textContent = 'No respawns left this round';
  }
  tickDeath() {
    if (this._deathRespawn) {
      const left = Math.max(0, (this._deathRespawn - performance.now()) / 1000);
      this.el.deathTimer.textContent = `Respawning in ${left.toFixed(1)}s`;
    }
  }
  hideDeath() { this.hide('death'); this._deathRespawn = null; }

  showEnd(winner, reason) {
    this.show('end');
    this.el.endTitle.textContent = winner === 'resistance' ? 'RESISTANCE VICTORY' : 'ZOMBIES VICTORY';
    this.el.endTitle.className = winner === 'resistance' ? 'res' : 'zom';
    this.el.endReason.textContent = reason;
    this.el.endNext.textContent = 'Next match starting shortly...';
  }

  // ---- zombie upgrade shop --------------------------------------------------
  // st = { points, cls, items:{key:true}, onBuyClass(key), onBuyItem(key) }
  renderUpgradeShop(st) {
    this.el.upPts.innerHTML = `POINTS: <b>${Math.floor(st.points)}</b>`;
    const mkCard = (grid, { nm, cost, dsc, tag, owned, affordable, onClick }) => {
      const c = document.createElement('div');
      c.className = 'upcard' + (owned ? ' owned' : (affordable ? '' : ' cant'));
      c.innerHTML = `<div class="cardhd"><span class="nm"></span><span class="cost"></span></div>
                     <div class="dsc"></div><div class="tag"></div>`;
      c.querySelector('.nm').textContent = nm;
      c.querySelector('.cost').textContent = owned ? 'OWNED' : cost + ' pts';
      c.querySelector('.dsc').textContent = dsc;
      c.querySelector('.tag').textContent = tag || '';
      if (!owned && affordable) c.onclick = onClick;
      grid.appendChild(c);
    };
    // classes (evolve)
    this.el.upClassGrid.innerHTML = '';
    for (const key of ZCLASS_ORDER) {
      if (key === 'walker') continue;
      const z = ZCLASSES[key];
      mkCard(this.el.upClassGrid, {
        nm: z.name.toUpperCase(), cost: z.cost, dsc: z.desc,
        tag: key === st.cls ? 'CURRENT FORM' : `${z.hp} HP`,
        owned: key === st.cls, affordable: st.points >= z.cost,
        onClick: () => st.onBuyClass(key),
      });
    }
    // items (gear)
    this.el.upItemGrid.innerHTML = '';
    for (const key of ZITEM_ORDER) {
      const it = ZITEMS[key];
      mkCard(this.el.upItemGrid, {
        nm: it.name.toUpperCase(), cost: it.cost, dsc: it.desc,
        tag: '', owned: !!st.items[key], affordable: st.points >= it.cost,
        onClick: () => st.onBuyItem(key),
      });
    }
  }

  // ---- pre-game lobby -------------------------------------------------------
  showLobby(mode, roster, myId) {
    this.el.lobbySub.textContent = mode === 'solo'
      ? 'Solo demo · bots have filled the lobby'
      : 'Multiplayer · slots fill live as players join';
    this.el.fillBtn.style.display = mode === 'solo' ? 'none' : '';
    this.el.startBtn.textContent = 'ENTER GAME ▶';
    this.updateLobby(roster, myId);
    this.show('lobby');
  }

  updateLobby(roster, myId) {
    const grid = this.el.lobbyGrid;
    grid.innerHTML = '';
    const res = roster.filter(r => r.team === 'resistance');
    const zom = roster.filter(r => r.team === 'zombie');
    const zSlots = ROOM_MAX - MAX_RESISTANCE;
    const mkSlot = (r, team) => {
      const d = document.createElement('div');
      const teamCls = team === 'resistance' ? 'res' : 'zom';
      if (!r) {
        d.className = `lslot empty ${teamCls}`;
        d.innerHTML = `<div class="who">— open —</div><div class="role">${team === 'resistance' ? 'RESISTANCE' : 'ZOMBIE'}</div>`;
        return d;
      }
      const isBot = String(r.id).startsWith('bot');
      const roleName = team === 'resistance'
        ? (HEROES[r.cls] ? HEROES[r.cls].name : 'Hero')
        : (ZCLASSES[r.cls] ? ZCLASSES[r.cls].name : 'Walker');
      d.className = `lslot ${teamCls}` + (r.id === myId ? ' me' : '');
      const bits = [roleName.toUpperCase()];
      if (isBot) bits.push('BOT');
      if (r.ready) bits.push('✔ READY');
      d.innerHTML = `<div class="who"></div><div class="role"></div>`;
      d.querySelector('.who').textContent = r.nick + (r.id === myId ? ' (you)' : '');
      d.querySelector('.role').innerHTML = bits.join(' · ').replace('BOT', '<span class="bot">BOT</span>');
      return d;
    };
    for (let i = 0; i < MAX_RESISTANCE; i++) grid.appendChild(mkSlot(res[i], 'resistance'));
    for (let i = 0; i < zSlots; i++) grid.appendChild(mkSlot(zom[i], 'zombie'));
    this.el.lobbyCount.textContent =
      `${roster.length} / ${ROOM_MAX} in lobby  ·  ${res.length} resistance  ·  ${zom.length} zombies`;
  }
}

// ---- splash / title screen -----------------------------------------------------
// Home page: just the title + a nickname, then PLAY SOLO or MULTIPLAYER.
export function buildSplash(onChoose) {
  const nickEl = $('splashNick'), err = $('splashError');
  const saved = localStorage.getItem('zfm_nick');
  if (saved) nickEl.value = saved;
  const go = (mode) => {
    const nick = nickEl.value.trim();
    if (nick.length < 2) { err.textContent = 'Enter a nickname (2+ characters)'; nickEl.focus(); return; }
    err.textContent = '';
    localStorage.setItem('zfm_nick', nick);
    onChoose(mode, nick);
  };
  $('btnSolo').onclick = () => go('solo');
  $('btnMulti').onclick = () => go('multi');
  nickEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') go('solo'); e.stopPropagation(); });
  setTimeout(() => nickEl.focus(), 60);
}

// ---- loadout menu --------------------------------------------------------------
// Mode + nickname arrive from the splash; here you only pick side, hero & weapon.
// Returns a controller so main.js can re-open it with a chosen mode.
export function buildMenu(onPlay, onBack) {
  const teamRow = $('teamRow'), clsRow = $('clsRow'), secRow = $('secRow');
  const clsLabel = $('clsLabel'), secLabel = $('secLabel'), modeSub = $('menuMode');
  const state = { mode: 'solo', nick: 'Player', team: 'resistance', hero: 'tommy', secondary: 'pistol' };

  function mkPick(row, key, label, sub, sel, fn) {
    const d = document.createElement('div');
    d.className = 'pick' + (sel ? ' sel' : '');
    d.innerHTML = `<div></div><small></small>`;
    d.firstChild.textContent = label;
    d.lastChild.textContent = sub || '';
    d.onclick = () => { fn(key); render(); };
    row.appendChild(d);
    return d;
  }

  const previewWrap = $('wpnPreviewWrap'), previewCanvas = $('wpnPreview'), previewName = $('wpnPreviewName');
  function showPreview(key) {
    drawWeaponPreview(previewCanvas, key);
    previewName.textContent = 'PREVIEW · ' + (WEAPONS[key] ? WEAPONS[key].label : '');
  }

  function render() {
    teamRow.innerHTML = ''; clsRow.innerHTML = ''; secRow.innerHTML = '';
    modeSub.textContent = state.mode === 'solo'
      ? 'SOLO DEMO · offline vs AI · pick your side'
      : 'MULTIPLAYER · online lobby · pick your side';
    mkPick(teamRow, 'auto', 'AUTO', 'fill a slot', state.team === 'auto', k => state.team = k);
    mkPick(teamRow, 'resistance', 'RESISTANCE', 'max 4 heroes', state.team === 'resistance', k => state.team = k);
    mkPick(teamRow, 'zombie', 'ZOMBIES', 'evolve from a Walker', state.team === 'zombie', k => state.team = k);

    const zombieMode = state.team === 'zombie';
    clsLabel.textContent = zombieMode ? 'Zombie' : 'Hero';
    secLabel.style.display = zombieMode ? 'none' : '';
    secRow.style.display = zombieMode ? 'none' : '';
    previewWrap.style.display = zombieMode ? 'none' : '';

    if (zombieMode) {
      const note = document.createElement('div');
      note.className = 'pick sel'; note.style.cursor = 'default'; note.style.minWidth = '260px';
      note.innerHTML = `<div>START AS A WALKER</div><small>Earn points by advancing &amp; killing Heroes, then press B in-game to evolve and buy gear.</small>`;
      clsRow.appendChild(note);
    } else {
      for (const [k, h] of Object.entries(HEROES)) {
        mkPick(clsRow, k, h.name.toUpperCase(), h.desc, state.hero === k, key => { state.hero = key; });
      }
      for (const s of ['pistol', 'smg', 'sniper', 'pump']) {
        mkPick(secRow, s, WEAPONS[s].label, `${WEAPONS[s].dmg} dmg`, state.secondary === s, key => { state.secondary = key; showPreview(key); });
      }
      showPreview(HEROES[state.hero].main);
    }
  }

  $('playBtn').onclick = () => {
    onPlay({
      nick: state.nick,
      team: state.team,
      cls: state.team === 'zombie' ? 'walker' : state.hero,
      secondary: state.secondary,
      solo: state.mode === 'solo',
    });
  };
  const backBtn = $('menuBack');
  if (backBtn) backBtn.onclick = () => { if (onBack) onBack(); };

  render();
  return {
    open(mode, nick) { state.mode = mode; if (nick) state.nick = nick; render(); },
  };
}

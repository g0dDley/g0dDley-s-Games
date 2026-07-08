// HUD, menus, chat, scoreboard, overlays.
import { TRAPS, TRAP_ORDER, BUILDS, BUILD_ORDER, WEAPONS, HEROES, ZCLASSES, BARRICADE_MAX_HP, PHASE } from './shared.js';

const $ = (id) => document.getElementById(id);

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
    };
    this._centerT = null;
    this._hitT = null;
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
}

// ---- main menu builder ---------------------------------------------------------
export function buildMenu(onPlay) {
  const modeRow = $('modeRow'), teamRow = $('teamRow'), clsRow = $('clsRow'), secRow = $('secRow');
  const clsLabel = $('clsLabel'), secLabel = $('secLabel');
  const state = { mode: 'solo', team: 'resistance', hero: 'tommy', zclass: 'runner', secondary: 'pistol' };

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

  function render() {
    modeRow.innerHTML = ''; teamRow.innerHTML = ''; clsRow.innerHTML = ''; secRow.innerHTML = '';
    mkPick(modeRow, 'solo', 'SOLO DEMO', 'offline · lobby of AI bots', state.mode === 'solo', k => state.mode = k);
    mkPick(modeRow, 'multi', 'MULTIPLAYER', 'online · public room', state.mode === 'multi', k => state.mode = k);
    mkPick(teamRow, 'auto', 'AUTO', 'fill a slot', state.team === 'auto', k => state.team = k);
    mkPick(teamRow, 'resistance', 'RESISTANCE', 'max 4 heroes', state.team === 'resistance', k => state.team = k);
    mkPick(teamRow, 'zombie', 'ZOMBIES', 'the horde', state.team === 'zombie', k => state.team = k);

    const zombieMode = state.team === 'zombie';
    clsLabel.textContent = zombieMode ? 'Zombie Class' : 'Hero';
    secLabel.style.display = zombieMode ? 'none' : '';
    secRow.style.display = zombieMode ? 'none' : '';

    if (zombieMode) {
      for (const [k, z] of Object.entries(ZCLASSES)) {
        mkPick(clsRow, k, z.name.toUpperCase(), z.desc, state.zclass === k, key => state.zclass = key);
      }
    } else {
      for (const [k, h] of Object.entries(HEROES)) {
        mkPick(clsRow, k, h.name.toUpperCase(), h.desc, state.hero === k, key => state.hero = key);
      }
      for (const s of ['pistol', 'smg', 'sniper', 'pump']) {
        mkPick(secRow, s, WEAPONS[s].label, `${WEAPONS[s].dmg} dmg`, state.secondary === s, key => state.secondary = key);
      }
    }
  }
  render();

  $('playBtn').onclick = () => {
    const nick = $('nickname').value.trim();
    if (nick.length < 2) { $('menuError').textContent = 'Nickname must be at least 2 characters'; return; }
    $('menuError').textContent = '';
    onPlay({ nick, team: state.team, cls: state.team === 'zombie' ? state.zclass : state.hero, secondary: state.secondary, solo: state.mode === 'solo' });
  };
  $('nickname').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('playBtn').click(); e.stopPropagation(); });
}

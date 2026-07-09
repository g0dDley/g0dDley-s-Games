// Boot flow: splash (title) -> loadout menu -> live lobby -> play.
import { Net } from './net.js';
import { HUD, buildMenu, buildSplash } from './hud.js';
import { Voice } from './voice.js';
import { Game } from './game.js';

const hud = new HUD();
const net = new Net();
const voice = new Voice(net, (on, err) => {
  if (on) hud.show('micind');
  else {
    hud.hide('micind');
    if (err) hud.centerMsg(err, 1800);
  }
});
const game = new Game(net, hud, voice);
window.ZFM = game; // debug/testing handle

let welcome = null;          // stored 'w' message; consumed when we ENTER GAME
let currentMode = 'solo';    // 'solo' | 'multi'

// ----- splash: pick a mode, then open the loadout menu -----------------------
buildSplash((mode, nick) => {
  currentMode = mode;
  hud.hide('splash');
  menu.open(mode, nick);
  hud.show('menu');
});

// ----- loadout menu: pick side/hero/weapon, then JOIN LOBBY ------------------
const menu = buildMenu(onPlay, () => {   // Back -> splash
  hud.hide('menu');
  hud.show('splash');
});

function onPlay(join) {
  currentMode = join.solo ? 'solo' : 'multi';
  game.netJoin = join;
  hud.hide('menu');
  hud.show('connmsg');
  document.getElementById('playBtn').disabled = true;
  // Solo runs the authoritative sim in this very tab — no server, fully offline.
  net.connect({ t: 'join', nick: join.nick, team: join.team, cls: join.cls,
                secondary: join.secondary, solo: !!join.solo, local: !!join.solo });
}

// ----- welcome from the (local or remote) hub: show the live lobby ----------
net.on('w', (m) => {
  hud.hide('connmsg');
  document.getElementById('playBtn').disabled = false;
  if (game.running) {
    // reconnected mid-match: server treats us as a fresh player; resync basics
    game.me.id = m.id; game.me.team = m.team;
    game.me.pos.set(m.pos[0], m.pos[1], m.pos[2]);
    game.roster = m.roster || [];
    return;
  }
  welcome = m;
  game.me.id = m.id;          // so the lobby can highlight our slot & live roster works
  game.me.team = m.team;
  game.roster = m.roster || [];
  hud.showLobby(currentMode, m.roster || [], m.id);
});

// ----- lobby controls -------------------------------------------------------
function enterGame() {
  if (!welcome) return;
  hud.hide('lobby');
  game.start(welcome);
  welcome = null;
}
document.getElementById('startBtn').onclick = () => enterGame();
document.getElementById('fillBtn').onclick = () => { net.send({ t: 'fillAI' }); enterGame(); };
document.getElementById('leaveBtn').onclick = () => {
  net.close();
  welcome = null;
  hud.hide('lobby');
  hud.show('splash');
};

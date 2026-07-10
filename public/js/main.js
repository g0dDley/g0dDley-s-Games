// Boot flow: splash (title) -> [multiplayer: lobby browser] -> loadout menu -> live lobby -> play.
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
let currentNick = 'Player';
let targetRoom = null;       // chosen lobby id (multiplayer)
let targetFresh = false;     // force a brand-new lobby

// ----- splash: pick a mode -------------------------------------------------
buildSplash((mode, nick) => {
  currentMode = mode;
  currentNick = nick;
  hud.hide('splash');
  if (mode === 'multi') openBrowser();
  else { menu.open('solo', nick); hud.show('menu'); }
});

// ----- multiplayer lobby browser -------------------------------------------
function openBrowser() {
  targetRoom = null; targetFresh = false;
  hud.show('browser');
  refreshBrowser();
}
function refreshBrowser() {
  hud.renderBrowser(null, {});   // clear while loading
  hud.el.browserList.innerHTML = '<div class="lobbycard empty"><div class="lc-title">Searching for lobbies…</div></div>';
  net.fetchLobbies((list) => hud.renderBrowser(list, { onJoin: (id) => pickLobby(id, false) }));
}
function pickLobby(roomId, fresh) {
  targetRoom = roomId; targetFresh = fresh;
  hud.hide('browser');
  menu.open('multi', currentNick);
  hud.show('menu');
}
document.getElementById('browserQuick').onclick = () => pickLobby(null, false);
document.getElementById('browserNew').onclick = () => pickLobby(null, true);
document.getElementById('browserRefresh').onclick = () => refreshBrowser();
document.getElementById('browserBack').onclick = () => { hud.hide('browser'); hud.show('splash'); };

// ----- loadout menu --------------------------------------------------------
const menu = buildMenu(onPlay, () => {   // Back -> splash or browser
  hud.hide('menu');
  if (currentMode === 'multi') openBrowser();
  else hud.show('splash');
});

function onPlay(join) {
  currentMode = join.solo ? 'solo' : 'multi';
  game.netJoin = join;
  hud.hide('menu');
  hud.show('connmsg');
  document.getElementById('playBtn').disabled = true;
  net.connect({
    t: 'join', nick: join.nick, team: join.team, cls: join.cls, secondary: join.secondary,
    solo: !!join.solo, local: !!join.solo,
    room: join.solo ? undefined : targetRoom, fresh: join.solo ? undefined : targetFresh,
  });
}

// ----- welcome from the hub: show the live lobby ---------------------------
net.on('w', (m) => {
  hud.hide('connmsg');
  document.getElementById('playBtn').disabled = false;
  if (game.running) {
    // reconnected mid-match: resync basics
    game.me.id = m.id; game.me.team = m.team;
    game.me.pos.set(m.pos[0], m.pos[1], m.pos[2]);
    game.roster = m.roster || [];
    return;
  }
  welcome = m;
  game.me.id = m.id;
  game.me.team = m.team;
  game.roster = m.roster || [];
  // A match already in combat (drop-in) — skip the lobby and spawn straight in.
  if (m.ph && m.ph !== 'prep') { enterGame(); return; }
  hud.showLobby(currentMode, m.roster || [], m.id);
});

// ----- lobby controls ------------------------------------------------------
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

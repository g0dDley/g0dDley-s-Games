// Boot: menu -> connect -> play.
import { Net } from './net.js';
import { HUD, buildMenu } from './hud.js';
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

buildMenu((join) => {
  hud.show('connmsg');
  document.getElementById('playBtn').disabled = true;
  game.netJoin = join;
  let started = false;
  net.on('w', (m) => {
    hud.hide('connmsg');
    if (!started) { started = true; game.start(m); }
    else {
      // reconnected: server treats us as a fresh player; resync basics
      game.me.id = m.id; game.me.team = m.team;
      game.me.pos.set(m.pos[0], m.pos[1], m.pos[2]);
      game.roster = m.roster || [];
    }
  });
  // Solo runs the authoritative sim in this very tab — no server, fully offline.
  net.connect({ t: 'join', nick: join.nick, team: join.team, cls: join.cls, secondary: join.secondary, solo: !!join.solo, local: !!join.solo });
});

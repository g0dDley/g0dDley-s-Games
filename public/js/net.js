// Client transport. Two backends behind one interface:
//  - WebSocket (multiplayer, "direct" socket mode)
//  - LocalHub  (offline solo demo — the authoritative sim runs in this very tab)
import { createHub } from './core.js';

export class Net {
  constructor() {
    this.handlers = {};
    this.connected = false;
    this.joinMsg = null;
    this.closedByUs = false;
    this.mode = 'ws';        // 'ws' | 'local'
    this.ws = null;
    this.localClient = null; // server-side client stub when running the local hub
  }

  on(type, fn) { this.handlers[type] = fn; }
  emit(type, msg) { if (this.handlers[type]) this.handlers[type](msg); }

  url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}${location.pathname.replace(/\/$/, '')}/ws`.replace(/([^:])\/\/ws/, '$1/ws');
  }

  connect(joinMsg) {
    this.joinMsg = joinMsg;
    this.closedByUs = false;
    if (joinMsg && joinMsg.local) this._openLocal();
    else this._openWs();
  }

  // ---- offline: run the server sim in-page ----------------------------------
  _openLocal() {
    this.mode = 'local';
    if (!Net._hub) Net._hub = createHub();       // one shared hub per tab
    // transport the *server* uses to push messages down to us
    const transport = { send: (s) => this._recv(s) };
    this.localClient = Net._hub.connect(transport);
    this.connected = true;
    // deliver asynchronously so listeners are attached before the welcome fires
    setTimeout(() => {
      this.emit('open');
      if (this.joinMsg) this.localClient.onMessage(JSON.stringify(this.joinMsg));
    }, 0);
  }

  // ---- online: websocket ----------------------------------------------------
  _openWs() {
    this.mode = 'ws';
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.emit('open');
      if (this.joinMsg) this.send(this.joinMsg);
    };
    ws.onmessage = (ev) => this._recv(ev.data);
    ws.onclose = () => {
      this.connected = false;
      this.emit('close');
      if (!this.closedByUs) setTimeout(() => this._openWs(), 1500);
    };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  }

  _recv(raw) {
    let m;
    try { m = JSON.parse(raw); } catch (_) { return; }
    this.emit(m.t, m);
  }

  send(obj) {
    if (this.mode === 'local') {
      if (this.localClient) this.localClient.onMessage(JSON.stringify(obj));
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close() {
    this.closedByUs = true;
    if (this.mode === 'local') { if (this.localClient) this.localClient.onClose(); }
    else if (this.ws) this.ws.close();
  }

  // One-shot lobby query over a throwaway socket (multiplayer browser).
  fetchLobbies(cb) {
    let done = false;
    const finish = (list) => { if (done) return; done = true; try { ws.close(); } catch (_) {} cb(list || []); };
    let ws;
    try { ws = new WebSocket(this.url()); } catch (_) { cb([]); return; }
    const to = setTimeout(() => finish([]), 3500);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'lobbies' }));
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m && m.t === 'lobbies') { clearTimeout(to); finish(m.list); }
    };
    ws.onerror = () => { clearTimeout(to); finish([]); };
  }
}

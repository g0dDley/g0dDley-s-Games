// Direct-mode WebSocket client with auto-reconnect.
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.connected = false;
    this.joinMsg = null;
    this.closedByUs = false;
  }

  on(type, fn) { this.handlers[type] = fn; }
  emit(type, msg) { if (this.handlers[type]) this.handlers[type](msg); }

  url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // Same-origin; Supabase Edge deploy serves WS on the same path root.
    return `${proto}://${location.host}${location.pathname.replace(/\/$/, '')}/ws`.replace(/([^:])\/\/ws/, '$1/ws');
  }

  connect(joinMsg) {
    this.joinMsg = joinMsg;
    this.closedByUs = false;
    this._open();
  }

  _open() {
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.emit('open');
      if (this.joinMsg) this.send(this.joinMsg);
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { return; }
      this.emit(m.t, m);
    };
    ws.onclose = () => {
      this.connected = false;
      this.emit('close');
      if (!this.closedByUs) setTimeout(() => this._open(), 1500);
    };
    ws.onerror = () => { try { ws.close(); } catch (_) {} };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() { this.closedByUs = true; if (this.ws) this.ws.close(); }
}

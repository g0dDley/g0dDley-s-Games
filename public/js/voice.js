// Push-to-talk voice chat: MediaRecorder opus chunks relayed via the game socket.
// Graceful fallback if microphone is unavailable.
export class Voice {
  constructor(net, onState) {
    this.net = net;
    this.onState = onState || (() => {});
    this.stream = null;
    this.recorder = null;
    this.talking = false;
    this.unavailable = false;
    this.seq = 0;
    this.playQueues = new Map(); // per-speaker audio elements
  }

  async start() {
    if (this.talking || this.unavailable) return;
    this.talking = true;
    try {
      if (!this.stream) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no mic api');
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      }
      if (!this.talking) return; // released while waiting for permission
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
      this.recorder.ondataavailable = async (ev) => {
        if (!ev.data || ev.data.size === 0) return;
        const buf = await ev.data.arrayBuffer();
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        this.net.send({ t: 'voice', d: btoa(bin), seq: this.seq++ });
      };
      // one self-contained blob per PTT press keeps chunks independently decodable
      this.recorder.start();
      this.onState(true);
    } catch (e) {
      this.unavailable = true;
      this.talking = false;
      this.onState(false, 'MICROPHONE UNAVAILABLE');
    }
  }

  stop() {
    if (!this.talking) return;
    this.talking = false;
    if (this.recorder && this.recorder.state !== 'inactive') {
      try { this.recorder.stop(); } catch (_) {}
    }
    this.recorder = null;
    this.onState(false);
  }

  playIncoming(msg) {
    try {
      const bin = atob(msg.d);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'audio/webm;codecs=opus' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 0.9;
      audio.onended = () => URL.revokeObjectURL(url);
      audio.play().catch(() => URL.revokeObjectURL(url));
    } catch (_) { /* ignore malformed voice data */ }
  }
}

// Two interchangeable connections: the online server, or a simulation running in this tab.

export class OnlineConnection {
  constructor() {
    this.handlers = [];
    this.closeHandlers = [];
    this.open = false;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}`);
      this.ws = ws;
      const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 15000);
      ws.onopen = () => { clearTimeout(timer); this.open = true; resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('error')); };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        const was = this.open;
        this.open = false;
        if (was) this.closeHandlers.forEach(h => h(ev.reason || 'Connection lost'));
        else reject(new Error(ev.reason || 'closed'));
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        for (const h of this.handlers) h(msg);
      };
    });
  }
  onMessage(fn) { this.handlers.push(fn); }
  onClose(fn) { this.closeHandlers.push(fn); }
  send(obj) { if (this.open) this.ws.send(JSON.stringify(obj)); }
  close() { this.open = false; this.ws && this.ws.close(); }
}

export class LocalConnection {
  constructor() {
    this.handlers = [];
    this.closeHandlers = [];
    this.open = false;
  }
  async connect() {
    const { Sim } = await import('/shared/sim.js');
    let alltime = [];
    try { alltime = JSON.parse(localStorage.getItem('fih-offline-lb') || '[]'); } catch {}
    this.sim = new Sim({
      alltime,
      onAlltimeChange: (l) => { try { localStorage.setItem('fih-offline-lb', JSON.stringify(l)); } catch {} },
    });
    // deliver asynchronously and as JSON copies so client code behaves like it does online
    this.sim.addPlayer(1, (msg) => {
      const copy = JSON.parse(JSON.stringify(msg));
      queueMicrotask(() => this.handlers.forEach(h => h(copy)));
    });
    this.open = true;
    const DT = 1 / 20;
    let last = performance.now(), acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= DT) { this.sim.tick(DT); acc -= DT; }
    }, 25);
  }
  onMessage(fn) { this.handlers.push(fn); }
  onClose(fn) { this.closeHandlers.push(fn); }
  send(obj) { if (this.open) this.sim.handleMessage(1, JSON.parse(JSON.stringify(obj))); }
  close() { this.open = false; clearInterval(this.timer); }
}

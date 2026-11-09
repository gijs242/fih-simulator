// Keyboard + mouse with pointer lock. Alt and right-click are captured so the browser doesn't steal them.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.sens = 0.0022;
    this.locked = false;
    this.pressed = { a1: false, a2: false, dash: false };
    this.held = { a1: false };
    this.onKey = null; // (code) => void for one-shot keys
    this.enabled = false;

    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.target && e.target.tagName === 'INPUT') return;
      if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight') {
        e.preventDefault();
        if (!e.repeat) this.pressed.dash = true;
      }
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (!e.repeat && this.onKey) this.onKey(e.code);
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') e.preventDefault(); // stops Firefox/Windows menu bar
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.held.a1 = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) { this.lock(); return; }
      if (e.button === 0) { this.pressed.a1 = true; this.held.a1 = true; }
      if (e.button === 2) this.pressed.a2 = true;
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.held.a1 = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sens;
      this.pitch -= e.movementY * this.sens;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      document.body.classList.toggle('locked', this.locked);
    });
  }

  lock() {
    try {
      const r = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (r && r.catch) r.catch(() => this.canvas.requestPointerLock());
    } catch { this.canvas.requestPointerLock(); }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  axis() {
    const k = this.keys;
    return {
      f: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
      r: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      u: (k.has('Space') ? 1 : 0) - (k.has('ShiftLeft') || k.has('ShiftRight') ? 1 : 0),
    };
  }

  consume() {
    const p = { ...this.pressed };
    this.pressed.a1 = this.pressed.a2 = this.pressed.dash = false;
    return p;
  }
}

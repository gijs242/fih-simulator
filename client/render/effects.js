// Particle effects (blood, bubbles, ink, shockwaves) and the food renderer.
import * as THREE from 'three';

function dotTexture(soft = 1) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(soft, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
function bubbleTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = 'rgba(220,240,240,0.9)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(32, 32, 26, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(22, 22, 6, 0, Math.PI * 2); ctx.fill();
  return new THREE.CanvasTexture(cv);
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.soft = dotTexture(0.4);
    this.bub = bubbleTexture();
    this.pool = [];
    this.active = [];
    for (let i = 0; i < 260; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.soft, transparent: true, depthWrite: false }));
      s.visible = false;
      scene.add(s);
      this.pool.push(s);
    }
    this.rings = [];
  }

  spawn(pos, o) {
    const s = this.pool.pop();
    if (!s) return;
    s.visible = true;
    s.position.set(pos[0] + (o.jitter ? (Math.random() - 0.5) * o.jitter : 0), pos[1] + (o.jitter ? (Math.random() - 0.5) * o.jitter : 0), pos[2] + (o.jitter ? (Math.random() - 0.5) * o.jitter : 0));
    s.material.map = o.bubble ? this.bub : this.soft;
    s.material.color.set(o.color);
    s.material.blending = o.add ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.material.opacity = o.alpha;
    s.material.fog = !o.noFog;
    s.material.needsUpdate = true;
    s.userData = { life: 0, dur: o.dur, s0: o.size, s1: o.size1 ?? o.size * 2.5, a: o.alpha, v: o.vel || [0, 0, 0], drag: o.drag ?? 1.5 };
    s.scale.setScalar(o.size);
    this.active.push(s);
  }

  blood(pos, size, amount = 1) {
    const n = Math.min(14, Math.round(4 + size * 2 * amount));
    for (let i = 0; i < n; i++) {
      const v = [(Math.random() - 0.5) * 3 * (1 + size * 0.3), (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3 * (1 + size * 0.3)];
      this.spawn(pos, { color: Math.random() < 0.5 ? '#5a0d08' : '#3a0805', size: 0.4 + size * 0.35, size1: 1.5 + size * 1.4, alpha: 0.8, dur: 2.5 + Math.random() * 2, vel: v, jitter: size * 0.4 });
    }
  }
  bubbles(pos, n = 6, spread = 1) {
    for (let i = 0; i < n; i++) {
      const s = 0.12 + Math.random() * 0.25;
      this.spawn(pos, { bubble: true, color: '#d8eeee', size: s, size1: s * 1.2, alpha: 0.7, dur: 1.5 + Math.random(), vel: [(Math.random() - 0.5), 2.5 + Math.random() * 2, (Math.random() - 0.5)], drag: 0.2, jitter: spread });
    }
  }
  sparkle(pos, color, n = 10, size = 1) {
    for (let i = 0; i < n; i++) {
      this.spawn(pos, { color, add: true, size: 0.3 * size, size1: 0.05, alpha: 0.9, dur: 1 + Math.random(), vel: [(Math.random() - 0.5) * 6 * size, (Math.random() - 0.5) * 6 * size, (Math.random() - 0.5) * 6 * size], drag: 2, jitter: size });
    }
  }
  ink(pos, r, dur) {
    for (let i = 0; i < 22; i++) {
      this.spawn(pos, { color: '#07040a', size: r * 0.4, size1: r * 1.6, alpha: 0.92, dur: dur * (0.7 + Math.random() * 0.4), vel: [(Math.random() - 0.5) * r * 0.6, (Math.random() - 0.5) * r * 0.4, (Math.random() - 0.5) * r * 0.6], drag: 1.2, jitter: r * 0.5 });
    }
  }
  ring(pos, radius, color, dur = 0.6) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(pos[0], pos[1], pos[2]);
    this.scene.add(m);
    this.rings.push({ m, life: 0, dur, r: radius });
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i], u = s.userData;
      u.life += dt;
      const k = u.life / u.dur;
      if (k >= 1) { s.visible = false; this.active.splice(i, 1); this.pool.push(s); continue; }
      const d = Math.exp(-u.drag * dt);
      u.v[0] *= d; u.v[1] *= d; u.v[2] *= d;
      s.position.x += u.v[0] * dt; s.position.y += u.v[1] * dt; s.position.z += u.v[2] * dt;
      s.scale.setScalar(u.s0 + (u.s1 - u.s0) * Math.sqrt(k));
      s.material.opacity = u.a * (1 - k * k);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life += dt;
      const k = r.life / r.dur;
      if (k >= 1) { this.scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); this.rings.splice(i, 1); continue; }
      r.m.scale.setScalar(r.r * (0.2 + k));
      r.m.material.opacity = 0.35 * (1 - k);
    }
  }
}

export class FoodRenderer {
  constructor(scene) {
    this.items = new Map();
    const pg = new THREE.IcosahedronGeometry(0.16, 1);
    this.plankton = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: '#9ab88a', emissive: '#4d7a40', emissiveIntensity: 0.9, roughness: 0.4, transparent: true, opacity: 0.85 }), 2000);
    const mg = new THREE.DodecahedronGeometry(0.5, 0);
    const p = mg.attributes.position;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.8 + Math.random() * 0.4), p.getY(i) * 0.7, p.getZ(i) * (0.8 + Math.random() * 0.4));
    mg.computeVertexNormals();
    this.meat = new THREE.InstancedMesh(mg, new THREE.MeshStandardMaterial({ color: '#7a2a20', emissive: '#2a0806', roughness: 0.6, flatShading: true }), 600);
    // glow marker for the food you're looking at
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,220,1)'); g.addColorStop(0.35, 'rgba(255,240,140,0.6)'); g.addColorStop(1, 'rgba(255,220,100,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(255,245,180,0.9)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(32, 32, 26, 0, Math.PI * 2); ctx.stroke();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false }));
    this.glow.visible = false;
    this.glow.renderOrder = 10;
    scene.add(this.glow);
    this.plankton.frustumCulled = false;
    this.meat.frustumCulled = false;
    scene.add(this.plankton, this.meat);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.t = 0;
  }
  set(list) { this.items.clear(); for (const f of list) this.add(f); }
  highlight(it) { this.hl = it; }
  add(f) { this.items.set(f[0], { id: f[0], type: f[1], x: f[2], y: f[3], z: f[4], ph: Math.random() * 6 }); }
  remove(id) { this.items.delete(id); }
  update(dt, cam) {
    this.t += dt;
    let np = 0, nm = 0;
    const R2 = 140 * 140;
    for (const it of this.items.values()) {
      const dx = it.x - cam.x, dz = it.z - cam.z;
      if (dx * dx + dz * dz > R2) continue;
      const bob = Math.sin(this.t * 1.5 + it.ph) * 0.3;
      if (it.type === 0) {
        if (np >= 2000) continue;
        this.v.set(it.x, it.y + bob, it.z);
        this.s.setScalar(0.9 + Math.sin(this.t * 3 + it.ph) * 0.2);
        this.e.set(this.t + it.ph, this.t * 0.7, 0); this.q.setFromEuler(this.e);
        this.m.compose(this.v, this.q, this.s);
        this.plankton.setMatrixAt(np++, this.m);
      } else {
        if (nm >= 600) continue;
        this.v.set(it.x, it.y + bob * 0.3, it.z);
        this.s.setScalar(1.4);
        this.e.set(it.ph, this.t * 0.3 + it.ph, 0); this.q.setFromEuler(this.e);
        this.m.compose(this.v, this.q, this.s);
        this.meat.setMatrixAt(nm++, this.m);
      }
    }
    this.plankton.count = np; this.meat.count = nm;
    const h = this.hl && this.items.get(this.hl.id) === this.hl ? this.hl : null;
    if (h) {
      const bob = Math.sin(this.t * 1.5 + h.ph) * (h.type === 0 ? 0.3 : 0.09);
      this.glow.position.set(h.x, h.y + bob, h.z);
      const d = this.glow.position.distanceTo(cam);
      this.glow.scale.setScalar(Math.max(1.2, d * 0.045) * (1 + Math.sin(this.t * 6) * 0.12));
      this.glow.visible = true;
    } else this.glow.visible = false;
    this.plankton.instanceMatrix.needsUpdate = true;
    this.meat.instanceMatrix.needsUpdate = true;
  }
}

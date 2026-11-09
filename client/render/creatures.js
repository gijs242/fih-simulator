// Procedural creature models, built from each animal's real anatomy.
// Every model is normalized to length 1 along +Z (nose at z=+0.5, tail at z=-0.5) and scaled by the entity size.
// Swimming motion is a vertex-shader body wave, so fins and tail flex with the body.

import * as THREE from 'three';
import { SPECIES } from '/shared/species.js';
import { fbm, valueNoise } from '/shared/world.js';

const PI = Math.PI;
const V2 = (x, y) => new THREE.Vector2(x, y);
const geoCache = new Map();
const texCache = new Map();

// ------------------------------------------------------------------ geometry helpers
function lathe(profile, n, seg, z0 = -0.5, z1 = 0.5) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(V2(Math.max(1e-4, profile(t)), z0 + t * (z1 - z0)));
  }
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(PI / 2); // lathe axis Y -> Z ; top of body is u = 0.5
  return g;
}

// t: 0 = tail end, 1 = nose
function fusiform(R, maxAt = 0.6, tailR = 0.15, noseExp = 0.6) {
  return (t) => {
    if (t < 0.12) return R * tailR * Math.sqrt(t / 0.12);
    if (t < maxAt) { const k = (t - 0.12) / (maxAt - 0.12); return R * (tailR + (1 - tailR) * Math.sin(k * PI / 2)); }
    const k = (t - maxAt) / (1 - maxAt);
    return R * Math.pow(Math.max(0, Math.cos(k * PI / 2)), noseExp);
  };
}

function shapeFrom(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}
// vertical fin: points are [z, y]
function finYZ(pts) {
  const g = new THREE.ShapeGeometry(shapeFrom(pts));
  g.rotateY(-PI / 2);
  return g;
}
// horizontal fin: points are [out(x), z]
function finXZ(pts) {
  const g = new THREE.ShapeGeometry(shapeFrom(pts));
  g.rotateX(PI / 2);
  return g;
}
function mirrorX(g) {
  const m = g.clone();
  m.scale(-1, 1, 1);
  return m;
}
// a long vertical fin strip with many segments so it can bend with the body
function ribbon(z0, z1, n, yBase, h) {
  const pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, z = z0 + (z1 - z0) * t;
    pos.push(0, yBase(t), z, 0, yBase(t) + h(t), z);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function ellipsoid(rx, ry, rz, x = 0, y = 0, z = 0, ws = 18, hs = 12) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.rotateX(PI / 2);
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return g;
}
// cylinder/cone along +Z from z=0 to z=len
function rod(r0, r1, len, seg = 6) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.rotateX(PI / 2);
  g.translate(0, 0, len / 2);
  return g;
}

// ------------------------------------------------------------------ skin textures
function hex(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function ss(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

function skinTexture(spec) {
  if (texCache.has(spec.id)) return texCache.get(spec.id);
  const m = spec.model, kind = m.kind;
  const pattern = m.pattern || ({ shark: 'shark', puffer: 'spots', lionfish: 'stripes', shrimp: 'segments', trilobite: 'segments', anomalocaris: 'segments', eel: 'mottled', turtle: 'ridges', squid: 'spots', jelly: 'none', dunkleosteus: 'plates', orthocone: 'shell', reptile: 'reptile', whale: 'whale' })[kind];
  const W = 256, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const c1 = hex(m.c1), c2 = hex(m.c2), be = hex(m.belly || m.c1);
  const seed = spec.index * 17.13;
  const algae = [64, 74, 46];
  for (let y = 0; y < H; y++) {
    const v = 1 - y / H; // 1 = nose
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const back = (1 + Math.cos(2 * PI * (u - 0.5))) / 2; // 1 on top
      const side = Math.abs(Math.sin(2 * PI * u));
      let col;
      if (pattern === 'shark' || pattern === 'reptile') {
        const edge = 0.42 + (fbm(u * 12 + seed, v * 6) - 0.5) * 0.12;
        col = back > edge ? mix(c1, c2, ss(edge, 1, back) * 0.8) : be;
      } else {
        col = mix(be, c1, ss(0.12, 0.5, back));
        col = mix(col, c2, ss(0.55, 0.97, back) * 0.85);
      }
      const n = fbm(u * 7 + seed, v * 9 + seed);
      const fine = valueNoise(u * 90 + seed, v * 90);
      switch (pattern) {
        case 'spots':
          if (back > 0.3 && valueNoise(u * 34 + seed, v * 40) > 0.76) col = mix(col, c2, 0.75);
          break;
        case 'bars': {
          const s = Math.sin(v * PI * 16 + n * 2.5);
          if (s > 0.35 && back > 0.35) col = mix(col, c2, 0.55);
          break;
        }
        case 'mottled': {
          const b = fbm(u * 11 + seed, v * 13);
          if (b > 0.56) col = mix(col, c2, Math.min(1, (b - 0.56) * 4));
          else if (b < 0.36) col = mix(col, be, 0.35);
          break;
        }
        case 'stripes': {
          const s = Math.sin(v * PI * 26 + n * 4);
          col = mix(c1, c2, s > 0.1 ? 0.85 : 0);
          if (back < 0.15) col = mix(col, be, 0.6);
          break;
        }
        case 'segments': {
          const s = (v * 13) % 1;
          if (s < 0.14) col = mix(col, c2, 0.6);
          if (Math.abs(u - 0.5) < 0.03 || Math.abs(Math.abs(u - 0.5) - 0.13) < 0.015) col = mix(col, c2, 0.35);
          break;
        }
        case 'shark': {
          // gill slits on both sides behind the head
          if (v > 0.66 && v < 0.78 && side > 0.55 && back > 0.25 && back < 0.6) {
            const s = (v * 75) % 1;
            if (s < 0.18) col = mix(col, [30, 25, 25], 0.7);
          }
          break;
        }
        case 'ridges': {
          const a = Math.cos(u * 2 * PI * 7);
          if (a > 0.9) col = mix(col, be, 0.4);
          if (valueNoise(u * 120, v * 120) > 0.86) col = mix(col, [200, 200, 190], 0.5);
          break;
        }
        case 'plates': {
          if (v > 0.5) {
            col = mix(col, c2, 0.2);
            if ((v * 9) % 1 < 0.05 || Math.abs(Math.sin(u * PI * 6)) < 0.04) col = mix(col, [20, 18, 14], 0.8);
          }
          break;
        }
        case 'shell': {
          const s = Math.sin(u * PI * 10 + v * 30 + n * 3);
          if (s > 0.55) col = mix(col, c2, 0.6);
          if ((v * 22) % 1 < 0.06) col = mix(col, [30, 24, 16], 0.6);
          break;
        }
        case 'reptile': {
          const sc = valueNoise(u * 140, v * 220);
          col = mix(col, c2, sc > 0.7 ? 0.25 : 0);
          if (back > 0.45 && fbm(u * 16 + seed, v * 20) > 0.62) col = mix(col, c2, 0.5);
          break;
        }
        case 'whale': {
          const w = Math.sin(v * 260 + fbm(u * 20, v * 20) * 8);
          col = mix(col, c2, w > 0.6 ? 0.3 : 0);
          break;
        }
      }
      // grime, algae, grain
      let k = 0.74 + 0.4 * n;
      if (fbm(u * 5 + 3 + seed, v * 5) > 0.63 && back > 0.4) col = mix(col, algae, 0.3);
      k *= 0.92 + fine * 0.16;
      const i = (y * W + x) * 4;
      img.data[i] = Math.min(255, col[0] * k);
      img.data[i + 1] = Math.min(255, col[1] * k);
      img.data[i + 2] = Math.min(255, col[2] * k);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // scars on the big ones
  if (spec.size >= 2) {
    const count = Math.min(9, Math.round(spec.size / 1.5));
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const x = ((Math.sin(seed + i * 12.9) + 1) / 2) * W, y = ((Math.cos(seed * 1.3 + i * 7.1) + 1) / 2) * H * 0.8 + H * 0.1;
      const len = 12 + (i * 37 % 30);
      const ang = (i * 1.7) % PI;
      ctx.strokeStyle = 'rgba(215,205,190,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(ang) * len * 0.5 + 4, y + Math.sin(ang) * len * 0.5, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
      if (i % 3 === 0) { // parallel rake marks
        ctx.beginPath(); ctx.moveTo(x + 4, y + 3); ctx.lineTo(x + 4 + Math.cos(ang) * len * 0.8, y + 3 + Math.sin(ang) * len * 0.8); ctx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(spec.id, tex);
  return tex;
}

// ------------------------------------------------------------------ shader patch
function patchMat(m, U) {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = 'uniform float uPhase;\nuniform float uAmp;\nuniform float uK;\nuniform float uFall;\nuniform float uAxis;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float tl = clamp(0.5 - position.z, 0.0, 1.6);
        float fall = mix(tl * tl, 0.3 + 0.7 * tl, uFall);
        float wave = sin(uPhase - position.z * uK) * uAmp * fall;
        transformed.x += wave * (1.0 - uAxis);
        transformed.y += wave * uAxis;`);
    shader.fragmentShader = 'uniform float uFlash;\nuniform float uPoison;\n' +
      shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.9, 0.08, 0.04) * uFlash + vec3(0.15, 0.55, 0.08) * uPoison;`);
  };
  m.customProgramCacheKey = () => 'fihbend';
}

// ------------------------------------------------------------------ creature
export class Creature {
  constructor(spIndex) {
    this.sp = spIndex;
    this.spec = SPECIES[spIndex];
    this.kind = this.spec.model.kind;
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.model = new THREE.Group();
    this.root.add(this.model);
    this.U = {
      uPhase: { value: Math.random() * 6 }, uAmp: { value: 0.03 }, uK: { value: 6 }, uFall: { value: 0 }, uAxis: { value: 0 },
      uFlash: { value: 0 }, uPoison: { value: 0 },
    };
    this.mats = [];
    this.lineMats = [];
    this.anims = [];
    this.ownGeos = [];
    this.time = Math.random() * 10;
    this.flash = 0;
    this.biteT = 0;
    this.jaw = null;
    this.flags = 0;
    this.inflate = 0;
    this.retract = 0;
    this.freq = 1;
    this.opacity = 1;
    const m = this.spec.model;
    this.skin = this.mat({ map: skinTexture(this.spec), bumpMap: skinTexture(this.spec), bumpScale: 1.2, roughness: 0.82, metalness: 0.05, side: THREE.DoubleSide });
    this.finMat = this.mat({ color: m.c2, roughness: 0.75, side: THREE.DoubleSide, transparent: true, opacity: 0.88 });
    this.darkMat = this.mat({ color: '#120c0a', roughness: 0.6 });
    this.toothMat = this.mat({ color: '#d8d0bc', roughness: 0.45 });
    BUILD[this.kind](this, m);
  }

  G(key, fn) {
    const k = this.spec.id + ':' + key;
    let g = geoCache.get(k);
    if (!g) { g = fn(); geoCache.set(k, g); }
    return g;
  }
  mat(o) {
    const m = new THREE.MeshStandardMaterial(o);
    m.userData.baseOpacity = m.opacity;
    m.userData.baseTransparent = m.transparent;
    patchMat(m, this.U);
    this.mats.push(m);
    return m;
  }
  add(geo, mat, parent = this.model) {
    const mesh = new THREE.Mesh(geo, mat);
    parent.add(mesh);
    return mesh;
  }
  pivot(x, y, z, parent = this.model) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }
  eyes(r, x, y, z, iris = '#a8915a') {
    const irisM = this.mat({ color: iris, roughness: 0.25, metalness: 0.2 });
    const pupilM = this.mat({ color: '#030303', roughness: 0.1 });
    for (const s of [1, -1]) {
      this.add(this.G(`eye${s}`, () => ellipsoid(r, r, r, s * x, y, z, 12, 8)), irisM);
      this.add(this.G(`pupil${s}`, () => ellipsoid(r * 0.62, r * 0.62, r * 0.62, s * (x + r * 0.5), y, z + r * 0.15, 10, 6)), pupilM);
    }
  }
  // chain of tapered segments (arms, tentacles, appendages)
  chain(parent, key, n, len, r0, r1, mat) {
    const joints = [];
    let p = parent;
    for (let i = 0; i < n; i++) {
      const j = new THREE.Group();
      if (i > 0) j.position.z = len;
      p.add(j);
      const ra = r0 + (r1 - r0) * i / n, rb = r0 + (r1 - r0) * (i + 1) / n;
      j.add(new THREE.Mesh(this.G(`${key}${i}`, () => rod(ra, rb, len * 1.08, 6)), mat));
      joints.push(j);
      p = j;
    }
    return joints;
  }
  line(points, color, opacity = 0.7) {
    const g = new THREE.BufferGeometry().setFromPoints(points);
    this.ownGeos.push(g);
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    m.userData.baseOpacity = opacity;
    this.lineMats.push(m);
    const l = new THREE.Line(g, m);
    this.model.add(l);
    return l;
  }
  // a jaw that opens when biting
  setJaw(pivot, open = 0.5) { this.jaw = { pivot, open, base: pivot.rotation.x }; }

  bite() { this.biteT = 1; }
  hit() { this.flash = 1; }

  setOpacity(a) {
    if (Math.abs(a - this.opacity) < 0.01) return;
    this.opacity = a;
    for (const m of this.mats) {
      m.opacity = m.userData.baseOpacity * a;
      const tr = a < 0.999 || m.userData.baseTransparent;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      m.depthWrite = a > 0.6 && !m.userData.noDepth;
    }
    for (const m of this.lineMats) m.opacity = m.userData.baseOpacity * a;
  }

  update(dt, speed01, flags) {
    this.time += dt;
    this.flags = flags;
    const t = this.time;
    this.U.uPhase.value += dt * (2.2 + speed01 * 9) * this.freq;
    this.flash = Math.max(0, this.flash - dt * 5);
    this.U.uFlash.value = this.flash;
    this.U.uPoison.value = (flags & 16) ? 0.35 + 0.25 * Math.sin(t * 8) : 0;
    this.inflate += (((flags & 1) ? 1 : 0) - this.inflate) * Math.min(1, dt * 8);
    this.retract += (((flags & 2) ? 1 : 0) - this.retract) * Math.min(1, dt * 8);
    if (this.biteT > 0) {
      this.biteT = Math.max(0, this.biteT - dt * 4);
      if (this.jaw) {
        const o = Math.sin((1 - this.biteT) * PI) * this.jaw.open;
        this.jaw.pivot.rotation.x = this.jaw.base + o;
      }
    }
    for (const a of this.anims) a(t, dt, speed01);
    this.model.rotation.z = (flags & 64) ? Math.sin(t * 22) * 0.2 : 0;
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    for (const m of this.lineMats) m.dispose();
    for (const g of this.ownGeos) g.dispose();
  }
}

// ------------------------------------------------------------------ builders, one per body plan
const BUILD = {};

// Ghost shrimp: curled translucent body, carapace + rostrum, segmented abdomen, horizontal tail fan,
// long antennae, walking legs and paddling swimmerets, stalked eyes.
BUILD.shrimp = (c, m) => {
  c.skin.transparent = true; c.skin.opacity = 0.72; c.skin.userData.baseOpacity = 0.72; c.skin.userData.baseTransparent = true;
  c.skin.roughness = 0.35;
  c.U.uAmp.value = 0.02; c.U.uAxis.value = 1; c.U.uK.value = 5;
  const curl = (g) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setY(i, p.getY(i) - 0.45 * z * z - 0.1 * Math.max(0, -z)); }
    g.computeVertexNormals();
    return g;
  };
  const body = c.G('body', () => {
    const prof = (t) => t < 0.6 ? 0.022 + 0.08 * Math.sin(t / 0.6 * PI / 2) : 0.102 * Math.pow(Math.cos((t - 0.6) / 0.4 * PI / 2), 0.55);
    const g = lathe(prof, 30, 14, -0.5, 0.45);
    g.scale(0.85, 1, 1);
    return curl(g);
  });
  c.add(body, c.skin);
  // gut line visible through the shell
  c.add(c.G('gut', () => curl(lathe((t) => 0.015 * Math.sin(t * PI), 16, 6, -0.42, 0.3))), c.mat({ color: '#5a3a2a', roughness: 0.6 }));
  c.add(c.G('rostrum', () => { const g = rod(0.018, 0.002, 0.16, 5); g.translate(0, -0.04, 0.42); return g; }), c.skin);
  const fan = c.G('fan', () => { const g = finXZ([[0, 0], [-0.1, -0.1], [-0.06, -0.15], [0, -0.17], [0.06, -0.15], [0.1, -0.1]]); g.rotateX(0.5); g.translate(0, -0.23, -0.46); return g; });
  c.add(fan, c.finMat);
  c.finMat.color.set('#c9b4a0'); c.finMat.opacity = 0.6; c.finMat.userData.baseOpacity = 0.6;
  // stalked eyes
  c.eyes(0.022, 0.05, 0.02, 0.4, '#1a1410');
  // legs: five walking legs per side + swimmerets under the abdomen
  const legM = c.mat({ color: '#a89482', roughness: 0.5, transparent: true, opacity: 0.8 });
  const legs = [];
  for (let i = 0; i < 9; i++) {
    for (const s of [1, -1]) {
      const z = 0.3 - i * 0.07;
      const curlY = -0.45 * z * z - 0.1 * Math.max(0, -z);
      const p = c.pivot(s * 0.03, curlY - 0.06, z);
      const leg = c.add(c.G(`leg${i < 5 ? 'w' : 's'}`, () => { const g = rod(0.006, 0.003, i < 5 ? 0.13 : 0.08, 4); g.rotateX(PI / 2 + 0.3); return g; }), legM, p);
      p.rotation.z = s * 0.35;
      legs.push({ p, i, s });
    }
  }
  // antennae
  const ant = [];
  for (const s of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const k = i / 12; pts.push(new THREE.Vector3(s * (0.03 + k * 0.25), 0.02 + Math.sin(k * PI) * 0.12, 0.45 + Math.sin(k * PI * 0.5) * 0.25 - k * k * 1.1)); }
    ant.push(c.line(pts, '#cdb9a5', 0.6));
  }
  c.anims.push((t, dt, sp) => {
    for (const l of legs) l.p.rotation.x = Math.sin(t * (6 + sp * 10) + l.i * 0.9) * (l.i < 5 ? 0.25 : 0.6);
    ant[0].rotation.y = Math.sin(t * 1.3) * 0.08; ant[1].rotation.y = -Math.sin(t * 1.1 + 1) * 0.08;
  });
};

// Bony fish: sardine, barracuda, goliath grouper, swordfish
BUILD.fish = (c, m) => {
  const v = {
    slim: { R: 0.1, wx: 0.62, hy: 1, maxAt: 0.58, nose: 0.55, tail: 'fork', z1: 0.5 },
    long: { R: 0.072, wx: 0.75, hy: 1, maxAt: 0.55, nose: 0.75, tail: 'fork', z1: 0.5 },
    fat: { R: 0.17, wx: 0.75, hy: 1.08, maxAt: 0.6, nose: 0.35, tail: 'round', z1: 0.5 },
    sword: { R: 0.085, wx: 0.8, hy: 1.08, maxAt: 0.5, nose: 0.6, tail: 'lunate', z1: 0.24 },
  }[m.shape];
  const R = v.R;
  c.U.uAmp.value = m.shape === 'fat' ? 0.03 : 0.04; c.U.uK.value = 7;
  if (m.shape === 'slim' || m.shape === 'sword') { c.skin.metalness = 0.35; c.skin.roughness = 0.55; }
  c.add(c.G('body', () => { const g = lathe(fusiform(R, v.maxAt, 0.14, v.nose), 30, 18, -0.47, v.z1); g.scale(v.wx, v.hy, 1); return g; }), c.skin);
  const top = R * v.hy;
  // tail
  const tail = c.G('tail', () => {
    const T = m.shape === 'fat' ? 0.16 : m.shape === 'sword' ? 0.2 : 0.15;
    let pts;
    if (v.tail === 'fork') pts = [[0, 0.02], [-0.6, 1], [-0.85, 1], [-0.45, 0], [-0.85, -1], [-0.6, -1], [0, -0.02]];
    else if (v.tail === 'round') pts = [[0, 0.04], [-0.5, 0.75], [-0.85, 0.6], [-1, 0], [-0.85, -0.6], [-0.5, -0.75], [0, -0.04]];
    else pts = [[0, 0.03], [-0.4, 0.7], [-0.75, 1.15], [-0.72, 1.2], [-0.35, 0.25], [-0.35, -0.25], [-0.72, -1.2], [-0.75, -1.15], [-0.4, -0.7], [0, -0.03]];
    const g = finYZ(pts.map(([z, y]) => [z * T, y * T]));
    g.translate(0, 0, -0.44);
    return g;
  });
  c.add(tail, c.finMat);
  // dorsal fins
  if (m.shape === 'slim') {
    c.add(c.G('dorsal', () => { const g = finYZ([[0.08, 0], [0.0, 0.08], [-0.05, 0.075], [-0.06, 0]]); g.translate(0, top * 0.85, 0); return g; }), c.finMat);
  } else if (m.shape === 'long') {
    c.add(c.G('dorsal1', () => { const g = finYZ([[0.06, 0], [0.0, 0.07], [-0.03, 0.06], [-0.04, 0]]); g.translate(0, top * 0.9, 0.05); return g; }), c.finMat);
    c.add(c.G('dorsal2', () => { const g = finYZ([[0.04, 0], [-0.01, 0.06], [-0.04, 0.05], [-0.05, 0]]); g.translate(0, top * 0.7, -0.25); return g; }), c.finMat);
    c.add(c.G('anal', () => { const g = finYZ([[0.04, 0], [-0.01, -0.055], [-0.04, -0.05], [-0.05, 0]]); g.translate(0, -top * 0.7, -0.25); return g; }), c.finMat);
  } else if (m.shape === 'fat') {
    // long dorsal: spiny front half, soft rounded back half
    c.add(c.G('dorsal', () => ribbon(0.2, -0.3, 26, (t) => top * (0.95 - 0.35 * t * t) - 0.01, (t) => t < 0.5 ? 0.05 + 0.02 * Math.abs(Math.sin(t * PI * 9)) : 0.09 * Math.sin((t - 0.5) / 0.5 * PI) + 0.03)), c.finMat);
    c.add(c.G('anal', () => ribbon(-0.1, -0.33, 12, (t) => -top * (0.8 - 0.4 * t), (t) => -0.08 * Math.sin(t * PI) - 0.01)), c.finMat);
  } else {
    // swordfish: tall rigid sickle dorsal
    c.add(c.G('dorsal', () => { const g = finYZ([[0.12, 0], [0.06, 0.18], [0.02, 0.2], [0.03, 0.12], [-0.02, 0.02], [-0.06, 0]]); g.translate(0, top * 0.85, 0); return g; }), c.finMat);
    c.add(c.G('bill', () => { const g = rod(0.03, 0.003, 0.38, 8); g.scale(1, 0.4, 1); g.translate(0, -0.005, 0.22); return g; }), c.skin);
  }
  // pectoral and pelvic fins
  const pec = c.G('pec', () => { const g = finXZ([[0, 0.03], [0.09, -0.04], [0.08, -0.07], [0, -0.02]]); g.rotateZ(-0.5); return g; });
  const pecs = [];
  for (const s of [1, -1]) {
    const p = c.pivot(s * R * v.wx * 0.8, -R * 0.3, 0.22);
    c.add(s > 0 ? pec : c.G('pecL', () => mirrorX(pec)), c.finMat, p);
    pecs.push({ p, s });
  }
  if (m.shape !== 'sword') {
    for (const s of [1, -1]) c.add(c.G(`pelv${s}`, () => { const g = finXZ([[0, 0.02], [0.04, -0.05], [0, -0.03]]); g.rotateZ(-1); if (s < 0) g.scale(-1, 1, 1); g.translate(s * R * 0.35, -R * v.hy * 0.85, 0.05); return g; }), c.finMat);
  }
  // eyes + jaw
  const eyeR = m.shape === 'fat' ? R * 0.16 : R * 0.24;
  c.eyes(eyeR, R * v.wx * 0.62, R * 0.25, v.z1 - (m.shape === 'fat' ? 0.15 : 0.11), m.shape === 'slim' ? '#c9c2a0' : '#9c8a5a');
  const jawP = c.pivot(0, -R * 0.35, v.z1 - (m.shape === 'fat' ? 0.2 : 0.14));
  const jawLen = m.shape === 'fat' ? 0.19 : m.shape === 'long' ? 0.16 : 0.12;
  c.add(c.G('jaw', () => { const g = ellipsoid(R * v.wx * 0.55, R * 0.18, jawLen / 2, 0, 0, jawLen / 2 + (m.shape === 'long' ? 0.01 : 0)); return g; }), c.skin, jawP);
  c.add(c.G('mouth', () => ellipsoid(R * v.wx * 0.45, R * 0.2, jawLen * 0.4, 0, R * 0.15, jawLen * 0.55)), c.darkMat, jawP);
  if (m.shape === 'long') {
    // barracuda fangs
    const teeth = new THREE.InstancedMesh(c.G('tooth', () => { const g = new THREE.ConeGeometry(0.004, 0.018, 4); return g; }), c.toothMat, 10);
    const mt = new THREE.Matrix4();
    for (let i = 0; i < 10; i++) { const s = i % 2 ? 1 : -1; mt.makeTranslation(s * R * 0.32, R * 0.12, 0.04 + Math.floor(i / 2) * 0.022); teeth.setMatrixAt(i, mt); }
    jawP.add(teeth);
  }
  c.setJaw(jawP, m.shape === 'fat' ? 0.55 : 0.4);
  c.anims.push((t, dt, sp) => { for (const f of pecs) f.p.rotation.z = f.s * Math.sin(t * 4 + f.s) * 0.25 * (1 - sp * 0.6); });
};

// Pufferfish: round body, small mouth with beak teeth, small fins, spines that stand up when it inflates
BUILD.puffer = (c, m) => {
  c.U.uAmp.value = 0.02; c.U.uK.value = 5; c.freq = 1.6;
  const R = 0.27;
  const bodyG = new THREE.Group();
  c.model.add(bodyG);
  c.add(c.G('body', () => { const g = lathe((t) => R * Math.pow(Math.sin(Math.min(1, t * 1.05) * PI), 0.62) + 0.01, 24, 20, -0.34, 0.4); g.scale(0.92, 0.9, 1); return g; }), c.skin, bodyG);
  c.add(c.G('beak', () => ellipsoid(0.05, 0.035, 0.03, 0, -0.02, 0.4)), c.toothMat, bodyG);
  c.add(c.G('tail', () => { const g = finYZ([[0, 0.03], [-0.12, 0.09], [-0.16, 0], [-0.12, -0.09], [0, -0.03]]); g.translate(0, 0, -0.33); return g; }), c.finMat);
  c.add(c.G('dorsal', () => { const g = finYZ([[0.0, 0], [-0.06, 0.08], [-0.1, 0.06], [-0.1, 0]]); g.translate(0, 0.16, -0.2); return g; }), c.finMat, bodyG);
  c.add(c.G('anal', () => { const g = finYZ([[0.0, 0], [-0.06, -0.08], [-0.1, -0.06], [-0.1, 0]]); g.translate(0, -0.16, -0.2); return g; }), c.finMat, bodyG);
  const pecs = [];
  for (const s of [1, -1]) {
    const p = c.pivot(s * 0.22, 0, 0.12, bodyG);
    c.add(c.G('pec' + s, () => { const g = finYZ([[0, 0.05], [-0.07, 0.07], [-0.09, 0], [-0.07, -0.05], [0, -0.04]]); g.rotateY(s * 0.6); return g; }), c.finMat, p);
    pecs.push(p);
  }
  c.eyes(0.045, 0.16, 0.1, 0.25, '#4f5a2a');
  // spines
  const N = 80;
  const spines = new THREE.InstancedMesh(c.G('spine', () => { const g = new THREE.ConeGeometry(0.012, 0.09, 4); g.translate(0, 0.045, 0); return g; }), c.mat({ color: '#d8d0b0', roughness: 0.5 }), N);
  const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + 0.5) / N * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    const d = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    if (d.z > 0.85 || d.z < -0.8) d.z *= 0.7;
    d.normalize();
    q.setFromUnitVectors(up, d);
    mt.compose(d.clone().multiply(new THREE.Vector3(R * 0.88, R * 0.85, R * 1.1)).add(new THREE.Vector3(0, 0, 0.03)), q, new THREE.Vector3(1, 1, 1));
    spines.setMatrixAt(i, mt);
  }
  bodyG.add(spines);
  c.anims.push((t) => {
    const k = c.inflate;
    bodyG.scale.setScalar(1 + k * 0.65);
    spines.scale.setScalar(0.82 + k * 0.28);
    pecs[0].rotation.y = Math.sin(t * 9) * 0.5; pecs[1].rotation.y = -Math.sin(t * 9 + 0.5) * 0.5;
  });
};

// Lionfish: banded body, long venomous dorsal spines, huge feathery pectoral fans
BUILD.lionfish = (c, m) => {
  c.U.uAmp.value = 0.025; c.U.uK.value = 6;
  const R = 0.15;
  c.add(c.G('body', () => { const g = lathe(fusiform(R, 0.6, 0.2, 0.45), 28, 16, -0.42, 0.42); g.scale(0.55, 1, 1); return g; }), c.skin);
  const finM = c.mat({ color: '#b07a62', roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.38, depthWrite: false });
  finM.userData.noDepth = true;
  const rayM = c.mat({ color: '#7a3424', roughness: 0.6 });
  c.add(c.G('tail', () => { const g = finYZ([[0, 0.04], [-0.12, 0.11], [-0.18, 0], [-0.12, -0.11], [0, -0.04]]); g.translate(0, 0, -0.4); return g; }), finM);
  // dorsal spines
  const N = 13;
  const sp = new THREE.InstancedMesh(c.G('dspine', () => { const g = new THREE.ConeGeometry(0.006, 1, 4); g.translate(0, 0.5, 0); return g; }), rayM, N + 24);
  const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < N; i++) {
    const z = 0.28 - i * 0.045, h = 0.28 - Math.abs(i - 3) * 0.015;
    e.set(-0.35 - i * 0.02, 0, 0); q.setFromEuler(e);
    mt.compose(new THREE.Vector3(0, R * 0.8, z), q, new THREE.Vector3(1, h, 1));
    sp.setMatrixAt(i, mt);
  }
  c.add(c.G('dmem', () => ribbon(0.28, -0.3, 14, () => R * 0.75, (t) => 0.1 - 0.05 * t)), finM);
  // pectoral fans: rays + membrane, each side
  const fans = [];
  for (const s of [1, -1]) {
    const p = c.pivot(s * R * 0.5, -R * 0.2, 0.14);
    c.add(c.G('fan' + s, () => {
      const pts = [[0, 0]];
      for (let k = 0; k <= 10; k++) { const a = -0.3 - k * 0.2; pts.push([s * Math.sin(-a) * 0.36, Math.cos(a) * 0.3 - 0.05]); }
      const g = finXZ(pts.map(([x, z]) => [x * 0.85, z * 0.85]));
      g.rotateZ(-s * 0.95);
      return g;
    }), finM, p);
    fans.push({ p, s });
  }
  for (let k = 0; k < 24; k++) {
    const s = k < 12 ? 1 : -1, i = k % 12;
    const a = -0.25 - i * 0.19;
    e.set(PI / 2 + Math.cos(a) * 0.9 - 0.2, 0, -s * (1.3 + Math.sin(-a) * 0.4)); q.setFromEuler(e);
    mt.compose(new THREE.Vector3(s * R * 0.5, -R * 0.2, 0.14), q, new THREE.Vector3(1, 0.31, 1));
    sp.setMatrixAt(N + k, mt);
  }
  c.model.add(sp);
  c.eyes(0.03, R * 0.42, R * 0.35, 0.3, '#8a3a26');
  const jawP = c.pivot(0, -R * 0.3, 0.3);
  c.add(c.G('jaw', () => ellipsoid(R * 0.3, R * 0.15, 0.06, 0, 0, 0.06)), c.skin, jawP);
  c.setJaw(jawP, 0.5);
  c.anims.push((t) => { for (const f of fans) f.p.rotation.y = f.s * Math.sin(t * 1.2) * 0.15; });
};

// Trilobite: dome-backed oval with raised axial lobe, head shield with genal spines and crescent eyes,
// segmented thorax, pygidium tail, antennae and rows of little legs underneath
BUILD.trilobite = (c, m) => {
  c.U.uAmp.value = 0; c.skin.roughness = 0.55; c.skin.metalness = 0.15;
  const ball = new THREE.Group();
  c.model.add(ball);
  c.add(c.G('thorax', () => {
    const g = ellipsoid(0.3, 0.08, 0.36, 0, 0, -0.06, 28, 14);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { if (p.getY(i) < 0) p.setY(i, p.getY(i) * 0.25); const z = p.getZ(i); p.setX(i, p.getX(i) * (1 - Math.max(0, -z - 0.1) * 1.2)); }
    g.computeVertexNormals();
    return g;
  }), c.skin, ball);
  // pleural ridges
  for (let i = 0; i < 11; i++) {
    const z = 0.16 - i * 0.045;
    const w = 0.3 * (1 - Math.max(0, -z - 0.1) * 1.2);
    c.add(c.G('rib' + i, () => { const g = new THREE.CylinderGeometry(0.012, 0.012, w * 2, 5); g.rotateZ(PI / 2); g.translate(0, 0.045 - Math.abs(z + 0.06) * 0.05, z); return g; }), c.darkMat, ball);
  }
  c.add(c.G('axial', () => ellipsoid(0.08, 0.11, 0.34, 0, 0.0, -0.05)), c.skin, ball);
  c.add(c.G('cephalon', () => {
    const g = ellipsoid(0.33, 0.1, 0.17, 0, 0, 0.3, 28, 12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setY(i, p.getY(i) * 0.2);
    g.computeVertexNormals();
    return g;
  }), c.skin, ball);
  c.add(c.G('glabella', () => ellipsoid(0.08, 0.08, 0.12, 0, 0.06, 0.33)), c.skin, ball);
  for (const s of [1, -1]) {
    c.add(c.G('genal' + s, () => { const g = rod(0.03, 0.002, 0.42, 5); g.rotateY(PI + s * 0.12); g.translate(s * 0.3, 0, 0.26); return g; }), c.skin, ball);
    c.add(c.G('ceye' + s, () => ellipsoid(0.04, 0.035, 0.06, s * 0.13, 0.09, 0.3)), c.mat({ color: '#2a241a', roughness: 0.2, metalness: 0.4 }), ball);
  }
  c.add(c.G('pyg', () => ellipsoid(0.13, 0.05, 0.08, 0, 0.01, -0.44)), c.skin, ball);
  const legM = c.mat({ color: '#7a6a55', roughness: 0.7 });
  const legs = [];
  for (let i = 0; i < 10; i++) for (const s of [1, -1]) {
    const p = c.pivot(s * 0.12, -0.03, 0.22 - i * 0.055, ball);
    c.add(c.G('leg', () => { const g = rod(0.008, 0.003, 0.14, 4); g.rotateY(PI / 2); g.rotateZ(-0.5); return g; }), legM, p);
    p.rotation.y = s > 0 ? 0 : PI;
    legs.push({ p, i, s });
  }
  const ant = [];
  for (const s of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const k = i / 10; pts.push(new THREE.Vector3(s * (0.05 + k * 0.18), -0.01 + Math.sin(k * PI) * 0.03, 0.44 + k * 0.32)); }
    ant.push(c.line(pts, '#8a7a62', 0.8));
  }
  c.anims.push((t, dt, sp) => {
    for (const l of legs) l.p.rotation.x = Math.sin(t * (5 + sp * 8) - l.i * 0.7) * 0.35;
    // roll up into a ball
    const k = c.retract;
    ball.scale.set(1, 1 + k * 1.6, 1 - k * 0.45);
    ball.rotation.x = -k * 0.3;
    ant.forEach((a, i) => { a.rotation.y = Math.sin(t * 1.5 + i) * 0.1; a.visible = k < 0.5; });
  });
};

// Anomalocaris: flattened body with eleven pairs of overlapping swimming flaps,
// two spiny grasping frontal appendages, stalked compound eyes, tail fan of three blade pairs
BUILD.anomalocaris = (c, m) => {
  c.U.uAmp.value = 0.01; c.U.uAxis.value = 1; c.U.uK.value = 5;
  c.add(c.G('body', () => { const g = lathe((t) => 0.075 * Math.pow(Math.sin(Math.min(1, t * 1.02) * PI), 0.5) + 0.012, 26, 14, -0.38, 0.3); g.scale(1.35, 0.5, 1); return g; }), c.skin);
  c.add(c.G('head', () => ellipsoid(0.1, 0.055, 0.1, 0, 0.0, 0.3)), c.skin);
  c.add(c.G('mouth', () => { const g = new THREE.TorusGeometry(0.035, 0.012, 6, 14); g.rotateX(PI / 2); g.translate(0, -0.05, 0.32); return g; }), c.mat({ color: '#d4b48c', roughness: 0.5 }));
  // stalked eyes
  const eyeM = c.mat({ color: '#141008', roughness: 0.15, metalness: 0.5 });
  for (const s of [1, -1]) {
    c.add(c.G('stalk' + s, () => { const g = rod(0.012, 0.01, 0.1, 5); g.rotateY(s * PI / 2); g.translate(s * 0.07, 0.04, 0.36); return g; }), c.skin);
    c.add(c.G('ceye' + s, () => ellipsoid(0.035, 0.03, 0.045, s * 0.18, 0.045, 0.36)), eyeM);
  }
  // swimming flaps
  const flapG = c.G('flap', () => { const g = finXZ([[0, 0.03], [0.07, 0.035], [0.13, 0.0], [0.12, -0.04], [0.04, -0.04], [0, -0.03]]); return g; });
  const flapM = c.mat({ color: m.c1, map: skinTexture(c.spec), roughness: 0.7, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  const flaps = [];
  for (let i = 0; i < 11; i++) for (const s of [1, -1]) {
    const z = 0.22 - i * 0.055;
    const w = 0.09 * Math.pow(Math.sin(Math.min(1, (z + 0.38) / 0.7 * 1.02) * PI), 0.5) + 0.01;
    const p = c.pivot(s * w, -0.01, z);
    c.add(s > 0 ? flapG : c.G('flapL', () => mirrorX(flapG)), flapM, p);
    const sc = 1 - Math.abs(i - 4) * 0.06;
    p.scale.setScalar(sc);
    flaps.push({ p, i, s });
  }
  // tail fan: three pairs of blades angled up
  for (let i = 0; i < 3; i++) for (const s of [1, -1]) {
    c.add(c.G(`tb${i}${s}`, () => { const g = finXZ([[0, 0], [0.04, -0.03], [0.06, -0.18], [0.02, -0.16]]); if (s < 0) g.scale(-1, 1, 1); g.rotateZ(s * (0.5 + i * 0.25)); g.rotateY(s * (0.15 + i * 0.25)); g.translate(0, 0.01, -0.36); return g; }), flapM);
  }
  // frontal appendages
  const spineM = c.mat({ color: '#c8a27a', roughness: 0.5 });
  const arms = [];
  for (const s of [1, -1]) {
    const base = c.pivot(s * 0.04, -0.02, 0.36);
    base.rotation.y = -s * 0.1;
    const j = c.chain(base, 'app', 9, 0.032, 0.022, 0.008, c.skin);
    j.forEach((jj, k) => { if (k > 0) c.add(c.G('aspine', () => { const g = rod(0.004, 0.001, 0.04, 3); g.rotateX(PI / 2 + 0.3); return g; }), spineM, jj); });
    arms.push({ j, s });
  }
  c.anims.push((t, dt, sp) => {
    for (const f of flaps) f.p.rotation.z = f.s * Math.sin(t * (5 + sp * 9) - f.i * 0.55) * 0.4;
    const grab = c.biteT > 0 ? Math.sin((1 - c.biteT) * PI) : 0;
    for (const a of arms) a.j.forEach((jj, k) => { jj.rotation.x = (k === 0 ? 0.4 - grab * 0.8 : 0.28 - grab * 0.2) + Math.sin(t * 2 + k) * 0.04; });
  });
};

// Moray eel: long scaleless body that undulates along its whole length, continuous dorsal/anal fin, gaping jaw
BUILD.eel = (c, m) => {
  c.U.uAmp.value = 0.055; c.U.uK.value = 15; c.U.uFall.value = 1; c.freq = 1.4;
  const R = 0.045;
  c.add(c.G('body', () => {
    const g = lathe((t) => R * (t < 0.1 ? Math.pow(t / 0.1, 0.6) : t > 0.93 ? Math.pow(Math.cos((t - 0.93) / 0.07 * PI / 2), 0.4) : 1) * (0.55 + 0.45 * t), 56, 14);
    g.scale(0.82, 1.15, 1);
    return g;
  }), c.skin);
  c.add(c.G('dorsal', () => ribbon(0.3, -0.48, 50, (t) => R * 1.12 * (0.55 + 0.45 * (0.8 - 0.78 * t)) - 0.004, (t) => (0.016 + 0.006 * Math.sin(t * PI)) * (t > 0.9 ? (1 - t) * 10 : 1))), c.finMat);
  c.add(c.G('anal', () => ribbon(0.0, -0.48, 30, (t) => -R * 1.12 * (0.55 + 0.45 * (0.5 - t * 0.48)) + 0.004, (t) => -0.012 * (t > 0.9 ? (1 - t) * 10 : 1))), c.finMat);
  c.eyes(0.009, R * 0.55, R * 0.5, 0.44, '#c7b26a');
  const jawP = c.pivot(0, -R * 0.4, 0.4);
  c.add(c.G('jaw', () => ellipsoid(R * 0.6, R * 0.25, 0.06, 0, 0, 0.05)), c.skin, jawP);
  c.add(c.G('mouth', () => ellipsoid(R * 0.5, R * 0.3, 0.05, 0, 0.012, 0.05)), c.darkMat, jawP);
  jawP.rotation.x = 0.12; // morays keep their mouths open
  c.setJaw(jawP, 0.5);
};

// Sharks: mako, great white, megalodon. Conical snout, five gill slits, tall first dorsal,
// small second dorsal and anal fin, long pectorals, lunate tail, underslung jaw with teeth.
BUILD.shark = (c, m) => {
  const v = {
    slim: { R: 0.085, wx: 0.85, nose: 0.5, maxAt: 0.55, pec: 1, dors: 0.15 },
    fat: { R: 0.115, wx: 0.88, nose: 0.42, maxAt: 0.56, pec: 1.05, dors: 0.17 },
    mega: { R: 0.125, wx: 0.9, nose: 0.34, maxAt: 0.57, pec: 1.3, dors: 0.18 },
  }[m.shape];
  const R = v.R;
  c.U.uAmp.value = 0.032; c.U.uK.value = 6; c.freq = 0.7;
  c.skin.roughness = 0.7;
  c.add(c.G('body', () => { const g = lathe(fusiform(R, v.maxAt, 0.11, v.nose), 34, 20, -0.47, 0.5); g.scale(v.wx, 1, 1); return g; }), c.skin);
  const D = v.dors;
  c.add(c.G('dorsal', () => { const g = finYZ([[0.12, 0], [0.04, D * 0.6], [0.0, D], [-0.03, D * 0.97], [-0.02, D * 0.6], [-0.05, 0.01], [-0.07, 0]]); g.translate(0, R * 0.82, 0.02); return g; }), c.skin);
  c.add(c.G('dorsal2', () => { const g = finYZ([[0.02, 0], [-0.01, 0.03], [-0.03, 0.028], [-0.035, 0]]); g.translate(0, R * 0.35, -0.3); return g; }), c.skin);
  c.add(c.G('anal', () => { const g = finYZ([[0.02, 0], [-0.01, -0.03], [-0.03, -0.028], [-0.035, 0]]); g.translate(0, -R * 0.35, -0.3); return g; }), c.skin);
  c.add(c.G('tail', () => {
    const T = 0.2;
    const pts = [[0, 0.03], [-0.45, 0.75], [-0.75, 1.25], [-0.82, 1.22], [-0.5, 0.35], [-0.42, 0], [-0.55, -0.45], [-0.72, -0.85], [-0.66, -0.88], [-0.3, -0.35], [0, -0.03]];
    const g = finYZ(pts.map(([z, y]) => [z * T, y * T]));
    g.translate(0, 0, -0.44);
    return g;
  }), c.skin);
  // caudal keel
  c.add(c.G('keel', () => { const g = ellipsoid(R * 0.6, R * 0.12, 0.05, 0, 0, -0.42); return g; }), c.skin);
  const pec = c.G('pec', () => { const P = v.pec; const g = finXZ([[0, 0.06 * P], [0.1 * P, -0.02 * P], [0.24 * P, -0.13 * P], [0.2 * P, -0.15 * P], [0.04 * P, -0.08 * P], [0, -0.04 * P]]); g.rotateZ(-0.3); return g; });
  const pecs = [];
  for (const s of [1, -1]) {
    const p = c.pivot(s * R * v.wx * 0.75, -R * 0.55, 0.2);
    c.add(s > 0 ? pec : c.G('pecL', () => mirrorX(pec)), c.skin, p);
    pecs.push({ p, s });
    c.add(c.G('pelv' + s, () => { const g = finXZ([[0, 0.02], [0.05, -0.04], [0.03, -0.05], [0, -0.03]]); if (s < 0) g.scale(-1, 1, 1); g.rotateZ(-s * 0.4); g.translate(s * R * 0.4, -R * 0.75, -0.16); return g; }), c.skin);
  }
  // black eyes
  const eyeM = c.mat({ color: '#050505', roughness: 0.05, metalness: 0.3 });
  for (const s of [1, -1]) c.add(c.G('eye' + s, () => ellipsoid(R * 0.11, R * 0.11, R * 0.12, s * R * v.wx * 0.55, R * 0.18, 0.38, 10, 8)), eyeM);
  // jaw with rows of serrated teeth
  const jawP = c.pivot(0, -R * 0.62, 0.3);
  c.add(c.G('jaw', () => ellipsoid(R * v.wx * 0.62, R * 0.2, 0.08, 0, 0, 0.06)), c.skin, jawP);
  c.add(c.G('mouthIn', () => ellipsoid(R * v.wx * 0.55, R * 0.25, 0.07, 0, 0.03, 0.08)), c.mat({ color: '#3a1512', roughness: 0.7 }), jawP);
  const NT = 18;
  const teeth = new THREE.InstancedMesh(c.G('tooth', () => new THREE.ConeGeometry(R * 0.06, R * 0.22, 3)), c.toothMat, NT * 2);
  const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < NT; i++) {
    const a = (i / (NT - 1) - 0.5) * PI * 0.9;
    const x = Math.sin(a) * R * v.wx * 0.55, z = 0.1 + Math.cos(a) * 0.05;
    e.set(0, 0, 0); q.setFromEuler(e);
    mt.compose(new THREE.Vector3(x, R * 0.2, z), q, new THREE.Vector3(1, 1, 1));
    teeth.setMatrixAt(i, mt); // lower teeth pointing up
    e.set(PI, 0, 0); q.setFromEuler(e);
    mt.compose(new THREE.Vector3(x * 1.05, -R * 0.35 + R * 0.62 - R * 0.05, z + 0.02), q, new THREE.Vector3(1, 1.2, 1));
    teeth.setMatrixAt(NT + i, mt); // upper teeth in the head pointing down
  }
  jawP.add(teeth);
  c.setJaw(jawP, 0.6);
  c.anims.push((t, dt, sp) => { for (const f of pecs) f.p.rotation.z = f.s * Math.sin(t * 1.2 + f.s) * 0.06; });
};

// Leatherback: teardrop leathery carapace with seven ridges, pale plastron, long front flippers, small rear flippers
BUILD.turtle = (c, m) => {
  c.U.uAmp.value = 0;
  c.add(c.G('shell', () => {
    const g = new THREE.SphereGeometry(1, 36, 18);
    g.rotateX(PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(x, y);
      const ridge = 1 + 0.05 * Math.pow(Math.max(0, Math.cos(a * 7)), 10) * (y > 0 ? 1 : 0);
      x *= ridge; y *= ridge;
      const taper = z < 0 ? 1 + z * 0.75 : 1;
      if (y < 0) y *= 0.45;
      p.setXYZ(i, x * 0.3 * taper, y * 0.14 * (z < 0 ? 1 + z * 0.3 : 1), z * 0.38 - 0.04);
    }
    g.computeVertexNormals();
    return g;
  }), c.skin);
  c.add(c.G('plastron', () => ellipsoid(0.25, 0.04, 0.3, 0, -0.04, -0.04)), c.mat({ color: m.belly, roughness: 0.8 }));
  const head = c.pivot(0, 0, 0.3);
  c.add(c.G('neck', () => rod(0.07, 0.065, 0.1, 10)), c.skin, head);
  c.add(c.G('head', () => ellipsoid(0.075, 0.065, 0.09, 0, 0.0, 0.13)), c.skin, head);
  c.add(c.G('beak', () => ellipsoid(0.05, 0.012, 0.04, 0, -0.025, 0.2)), c.darkMat, head);
  for (const s of [1, -1]) c.add(c.G('eye' + s, () => ellipsoid(0.014, 0.014, 0.014, s * 0.055, 0.02, 0.17)), c.darkMat, head);
  const flipM = c.mat({ color: m.c1, map: skinTexture(c.spec), roughness: 0.85, side: THREE.DoubleSide });
  const flips = [];
  for (const s of [1, -1]) {
    const p = c.pivot(s * 0.22, -0.02, 0.17);
    c.add(c.G('ff' + s, () => { const g = finXZ([[0, 0.05], [0.13, 0.03], [0.3, -0.06], [0.37, -0.13], [0.33, -0.14], [0.15, -0.07], [0, -0.05]]); if (s < 0) g.scale(-1, 1, 1); return g; }), flipM, p);
    flips.push({ p, s, front: true });
    const r = c.pivot(s * 0.13, -0.03, -0.3);
    c.add(c.G('rf' + s, () => { const g = finXZ([[0, 0.03], [0.1, 0], [0.12, -0.08], [0.04, -0.07], [0, -0.03]]); if (s < 0) g.scale(-1, 1, 1); return g; }), flipM, r);
    flips.push({ p: r, s, front: false });
  }
  c.add(c.G('tailc', () => { const g = rod(0.03, 0.002, 0.08, 6); g.rotateY(PI); g.translate(0, -0.01, -0.36); return g; }), c.skin);
  c.anims.push((t, dt, sp) => {
    const k = 1 - c.retract * 0.6;
    for (const f of flips) {
      if (f.front) { f.p.rotation.z = f.s * Math.sin(t * (1.4 + sp * 1.6)) * 0.55; f.p.rotation.y = f.s * Math.cos(t * (1.4 + sp * 1.6)) * 0.2; }
      else f.p.rotation.y = f.s * Math.sin(t * 1.4) * 0.2;
      f.p.scale.setScalar(k);
    }
    head.scale.setScalar(k);
    head.position.z = 0.3 - c.retract * 0.1;
  });
};

// Giant squid: torpedo mantle with terminal fins, huge eyes, eight arms and two long feeding tentacles with clubs
BUILD.squid = (c, m) => {
  c.U.uAmp.value = 0;
  c.add(c.G('mantle', () => lathe((t) => 0.075 * Math.pow(Math.sin(Math.min(1, t * 1.15) * PI / 2), 0.75) * (t > 0.9 ? 1 - (t - 0.9) * 1.5 : 1) + 0.002, 30, 18, -0.5, 0.06)), c.skin);
  const finM = c.mat({ color: m.c1, map: skinTexture(c.spec), roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const fins = [];
  for (const s of [1, -1]) {
    const p = c.pivot(s * 0.02, 0, -0.42);
    c.add(c.G('fin' + s, () => { const g = finXZ([[0, 0.06], [0.09, -0.02], [0, -0.09]]); if (s < 0) g.scale(-1, 1, 1); return g; }), finM, p);
    fins.push({ p, s });
  }
  c.add(c.G('head', () => ellipsoid(0.058, 0.052, 0.07, 0, 0, 0.1)), c.skin);
  c.eyes(0.032, 0.045, 0.01, 0.1, '#c9b07a');
  const armM = c.mat({ color: m.belly, map: skinTexture(c.spec), roughness: 0.6 });
  const arms = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * PI * 2;
    const base = c.pivot(Math.cos(a) * 0.035, Math.sin(a) * 0.035, 0.15);
    base.rotation.set(-Math.sin(a) * 0.25, Math.cos(a) * 0.25, 0);
    arms.push({ j: c.chain(base, 'arm', 6, 0.048, 0.013, 0.003, armM), ph: i * 0.8 });
  }
  for (const s of [1, -1]) {
    const base = c.pivot(s * 0.015, -0.01, 0.15);
    const j = c.chain(base, 'tent', 10, 0.055, 0.007, 0.004, armM);
    c.add(c.G('club', () => ellipsoid(0.014, 0.009, 0.04, 0, 0, 0.05)), armM, j[j.length - 1]);
    arms.push({ j, ph: s * 2, tent: true });
  }
  c.anims.push((t, dt, sp) => {
    const reach = c.biteT > 0 ? Math.sin((1 - c.biteT) * PI) : 0;
    for (const a of arms) a.j.forEach((jj, k) => {
      jj.rotation.x = Math.sin(t * 1.8 + a.ph + k * 0.7) * (0.16 - sp * 0.1) * (1 - reach);
      jj.rotation.y = Math.cos(t * 1.4 + a.ph * 1.3 + k * 0.6) * (0.16 - sp * 0.1) * (1 - reach);
    });
    for (const f of fins) f.p.rotation.z = f.s * Math.sin(t * 3) * 0.25;
    c.model.scale.set(1 - Math.sin(t * 3) * 0.02 * sp, 1 - Math.sin(t * 3) * 0.02 * sp, 1);
  });
};

// Box jellyfish: cube-shaped translucent bell with glowing gonads, four pedalia each trailing tentacles
BUILD.jelly = (c, m) => {
  c.U.uAmp.value = 0;
  const bellM = c.mat({ color: m.c1, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.32, side: THREE.DoubleSide, emissive: m.c2, emissiveIntensity: 0.35 });
  bellM.userData.noDepth = true; bellM.depthWrite = false;
  const bell = new THREE.Group();
  bell.position.z = 0.1;
  c.model.add(bell);
  c.add(c.G('bell', () => { const g = new THREE.SphereGeometry(0.2, 4, 10, PI / 4, PI * 2, 0, PI / 2); g.rotateX(PI / 2); g.scale(1, 1, 1.5); return g; }), bellM, bell);
  const glow = c.mat({ color: '#e0c89a', emissive: '#d08a40', emissiveIntensity: 0.6, transparent: true, opacity: 0.35, depthWrite: false });
  glow.userData.noDepth = true;
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * PI * 2 + PI / 4;
    c.add(c.G('gon' + i, () => ellipsoid(0.018, 0.018, 0.07, Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0.12)), glow, bell);
  }
  // pedalia at the four corners + tentacles
  const tents = [];
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * PI * 2 + PI / 4;
    const cx = Math.cos(a) * 0.19, cy = Math.sin(a) * 0.19;
    c.add(c.G('ped' + i, () => ellipsoid(0.02, 0.02, 0.06, cx, cy, 0.07)), bellM, bell);
    for (let k = 0; k < 4; k++) {
      const pts = [];
      for (let j = 0; j < 22; j++) pts.push(new THREE.Vector3(cx, cy, 0.1 - j * 0.07));
      const l = c.line(pts, '#b6dde4', 0.45);
      tents.push({ l, cx: cx + (k - 1.5) * 0.008, cy: cy + (k - 1.5) * 0.008, ph: i * 1.7 + k * 0.6 });
    }
  }
  c.anims.push((t, dt, sp) => {
    const pulse = Math.sin(t * 3.2);
    bell.scale.set(1 + pulse * 0.1, 1 + pulse * 0.1, 1 - pulse * 0.08);
    const drift = 0.03 * (1 - sp * 0.7);
    for (const tt of tents) {
      const p = tt.l.geometry.attributes.position;
      for (let j = 0; j < p.count; j++) {
        const k = j / p.count;
        p.setXYZ(j, tt.cx * (1 + k * 0.4) + Math.sin(t * 1.6 + tt.ph + j * 0.35) * drift * j * 0.4, tt.cy * (1 + k * 0.4) + Math.cos(t * 1.3 + tt.ph + j * 0.3) * drift * j * 0.4, 0.1 - j * 0.07);
      }
      p.needsUpdate = true;
    }
  });
};

// Dunkleosteus: armored head and thorax plates with seams, bony shearing jaw blades, scaleless shark-like
// rear body and heterocercal tail
BUILD.dunkleosteus = (c, m) => {
  const R = 0.12;
  c.U.uAmp.value = 0.03; c.U.uK.value = 6; c.freq = 0.8;
  c.add(c.G('body', () => { const g = lathe(fusiform(R, 0.62, 0.1, 0.6), 30, 18, -0.47, 0.42); g.scale(0.85, 1, 1); return g; }), c.skin);
  const armorM = c.mat({ color: '#d8ccb0', map: skinTexture(c.spec), bumpMap: skinTexture(c.spec), bumpScale: 2, roughness: 0.5, metalness: 0, side: THREE.DoubleSide });
  c.add(c.G('armor', () => {
    const g = lathe((t) => R * 1.1 * Math.pow(Math.sin(Math.min(1, 0.5 + t * 0.5) * PI), 0.45) + 0.005, 20, 20, 0.02, 0.5);
    g.scale(0.92, 1.0, 1);
    return g;
  }), armorM);
  for (const z of [0.18, 0.32]) c.add(c.G('seam' + z, () => { const g = new THREE.TorusGeometry(R * 1.04 * (z > 0.3 ? 0.88 : 1), 0.005, 6, 28); g.scale(0.92, 1, 1); g.translate(0, 0, z); return g; }), c.darkMat);
  for (const s of [1, -1]) c.add(c.G('orb' + s, () => { const g = new THREE.TorusGeometry(0.025, 0.008, 6, 14); g.rotateY(PI / 2); g.translate(s * R * 0.78, R * 0.4, 0.38); return g; }), armorM);
  for (const s of [1, -1]) c.add(c.G('eye' + s, () => ellipsoid(0.022, 0.022, 0.022, s * R * 0.78, R * 0.4, 0.38)), c.mat({ color: '#b08a30', roughness: 0.2 }));
  // upper fang plates
  const bladeM = c.mat({ color: '#cfc4a8', roughness: 0.35, metalness: 0.15 });
  for (const s of [1, -1]) c.add(c.G('ufang' + s, () => { const g = new THREE.ConeGeometry(0.018, 0.07, 4); g.rotateX(PI); g.translate(s * 0.025, -R * 0.35, 0.47); return g; }), bladeM);
  const jawP = c.pivot(0, -R * 0.55, 0.3);
  c.add(c.G('jaw', () => { const g = new THREE.BoxGeometry(R * 1.1, 0.03, 0.2); g.translate(0, 0, 0.09); return g; }), armorM, jawP);
  for (const s of [1, -1]) c.add(c.G('lfang' + s, () => { const g = new THREE.ConeGeometry(0.016, 0.06, 4); g.translate(s * 0.022, 0.04, 0.18); return g; }), bladeM, jawP);
  c.add(c.G('mouthIn', () => ellipsoid(R * 0.5, R * 0.3, 0.1, 0, 0.04, 0.1)), c.mat({ color: '#2a1410' }), jawP);
  c.setJaw(jawP, 0.75);
  c.add(c.G('tail', () => { const T = 0.18; const g = finYZ([[0, 0.03], [-0.5, 0.8], [-0.85, 1.3], [-0.85, 1.2], [-0.5, 0.2], [-0.55, -0.4], [-0.6, -0.55], [-0.25, -0.2], [0, -0.03]].map(([z, y]) => [z * T, y * T])); g.translate(0, 0, -0.44); return g; }), c.skin);
  c.add(c.G('dorsal', () => { const g = finYZ([[0.06, 0], [0.0, 0.1], [-0.04, 0.09], [-0.05, 0]]); g.translate(0, R * 0.85, -0.05); return g; }), c.skin);
  const pecs = [];
  for (const s of [1, -1]) {
    const p = c.pivot(s * R * 0.85, -R * 0.5, 0.1);
    c.add(c.G('pec' + s, () => { const g = finXZ([[0, 0.04], [0.12, -0.04], [0.1, -0.08], [0, -0.03]]); if (s < 0) g.scale(-1, 1, 1); g.rotateZ(-s * 0.3); return g; }), c.skin, p);
    pecs.push({ p, s });
  }
  c.anims.push((t) => { for (const f of pecs) f.p.rotation.z = f.s * Math.sin(t * 1.5) * 0.1; });
};

// Cameroceras: very long straight conical shell with growth rings, soft head with eyes and a hood,
// a crown of tentacles at the front and a siphon underneath
BUILD.orthocone = (c, m) => {
  c.U.uAmp.value = 0;
  c.skin.roughness = 0.5; c.skin.metalness = 0.1;
  c.add(c.G('shell', () => lathe((t) => 0.078 * Math.pow(t, 0.85) * (1 + ((t * 26) % 1 < 0.12 ? 0.04 : 0)) + 0.003, 80, 18, -0.5, 0.18)), c.skin);
  c.add(c.G('lip', () => { const g = new THREE.TorusGeometry(0.078, 0.008, 6, 20); g.translate(0, 0, 0.18); return g; }), c.skin);
  const softM = c.mat({ color: '#8a5a48', roughness: 0.6 });
  c.add(c.G('head', () => ellipsoid(0.068, 0.062, 0.07, 0, 0, 0.22)), softM);
  c.add(c.G('hood', () => ellipsoid(0.072, 0.03, 0.06, 0, 0.045, 0.21)), c.mat({ color: '#4a3020', roughness: 0.7 }));
  c.eyes(0.02, 0.058, 0.02, 0.23, '#3a3020');
  c.add(c.G('siphon', () => { const g = rod(0.015, 0.012, 0.06, 8); g.rotateY(PI); g.translate(0, -0.055, 0.2); return g; }), softM);
  const arms = [];
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * PI * 2;
    const base = c.pivot(Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0.27);
    base.rotation.set(-Math.sin(a) * 0.45, Math.cos(a) * 0.45, 0);
    arms.push({ j: c.chain(base, 'ten', 5, 0.045, 0.008, 0.002, softM), ph: i * 0.9 });
  }
  c.anims.push((t, dt, sp) => {
    const reach = c.biteT > 0 ? Math.sin((1 - c.biteT) * PI) : 0;
    for (const a of arms) a.j.forEach((jj, k) => {
      jj.rotation.x = Math.sin(t * 1.5 + a.ph + k * 0.8) * 0.2 * (1 - reach);
      jj.rotation.y = Math.cos(t * 1.2 + a.ph + k * 0.6) * 0.2 * (1 - reach);
    });
    c.model.rotation.x = Math.sin(t * 0.7) * 0.03;
  });
};

// Marine reptiles. Mosasaurus: long body, elongated toothy skull, four paddles, downturned crescent tail fluke.
// Liopleurodon (pliosaur): teardrop body, big long skull, short neck and tail, four huge wing-like flippers.
BUILD.reptile = (c, m) => {
  const mosa = m.variant === 'mosasaur';
  c.U.uAmp.value = mosa ? 0.04 : 0.012; c.U.uK.value = mosa ? 7 : 5; c.freq = mosa ? 0.8 : 0.6;
  if (mosa) {
    c.add(c.G('body', () => { const g = lathe((t) => 0.075 * (t < 0.5 ? 0.12 + 0.88 * Math.pow(t / 0.5, 1.3) : t < 0.82 ? 1 : 1 - (t - 0.82) * 1.6), 44, 18, -0.48, 0.2); g.scale(0.85, 1.05, 1); return g; }), c.skin);
    c.add(c.G('fluke', () => { const T = 0.13; const g = finYZ([[0.1, 0.0], [-0.3, 0.2], [-0.55, 0.35], [-0.5, 0.0], [-0.75, -0.9], [-0.9, -1.0], [-0.2, -0.15], [0.1, -0.05]].map(([z, y]) => [z * T, y * T])); g.translate(0, -0.01, -0.44); return g; }), c.skin);
  } else {
    c.add(c.G('body', () => { const g = lathe((t) => t < 0.6 ? 0.12 * Math.pow(Math.sin(t / 0.6 * PI / 2), 0.7) + 0.004 : 0.124 - (t - 0.6) / 0.4 * 0.05, 30, 20, -0.5, 0.18); g.scale(0.95, 0.78, 1); return g; }), c.skin);
    c.add(c.G('tfin', () => { const g = finYZ([[0, 0.02], [-0.06, 0.04], [-0.08, 0], [-0.06, -0.03], [0, -0.01]]); g.translate(0, 0, -0.46); return g; }), c.skin);
  }
  // skull and lower jaw
  const sk = mosa ? { rx: 0.05, ry: 0.04, len: 0.16, z: 0.32 } : { rx: 0.085, ry: 0.062, len: 0.17, z: 0.27 };
  c.add(c.G('neck', () => { const g = new THREE.CylinderGeometry(sk.rx * 0.95, mosa ? 0.06 : 0.075, 0.1, 16, 1, true); g.rotateX(PI / 2); g.scale(1, mosa ? 1 : 0.8, 1); g.translate(0, 0, mosa ? 0.21 : 0.22); return g; }), c.skin);
  c.add(c.G('skull', () => {
    const g = ellipsoid(sk.rx, sk.ry, sk.len, 0, 0.01, sk.z + sk.len * 0.35, 20, 12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i); const k = Math.max(0, (z - sk.z) / (sk.len * 1.2)); p.setX(i, p.getX(i) * (1 - k * 0.55)); p.setY(i, p.getY(i) * (1 - k * 0.4)); }
    g.computeVertexNormals();
    return g;
  }), c.skin);
  const jawP = c.pivot(0, -sk.ry * 0.55, sk.z - sk.len * 0.25);
  c.add(c.G('jaw', () => {
    const g = ellipsoid(sk.rx * 0.85, sk.ry * 0.35, sk.len * 0.9, 0, 0, sk.len * 0.85, 16, 8);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i); const k = Math.max(0, z / (sk.len * 1.7)); p.setX(i, p.getX(i) * (1 - k * 0.5)); }
    g.computeVertexNormals();
    return g;
  }), c.skin, jawP);
  c.add(c.G('mouthIn', () => ellipsoid(sk.rx * 0.7, sk.ry * 0.35, sk.len * 0.8, 0, sk.ry * 0.2, sk.len * 0.85)), c.mat({ color: '#3a1814' }), jawP);
  // conical teeth along both jaws
  const NT = 14;
  const teeth = new THREE.InstancedMesh(c.G('tooth', () => new THREE.ConeGeometry(0.006, mosa ? 0.022 : 0.03, 4)), c.toothMat, NT * 4);
  const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  let n = 0;
  for (let i = 0; i < NT; i++) for (const s of [1, -1]) {
    const z = sk.len * 0.2 + i / NT * sk.len * 1.3;
    const w = sk.rx * 0.75 * (1 - z / (sk.len * 1.7) * 0.5);
    e.set(0, 0, 0); q.setFromEuler(e); mt.compose(new THREE.Vector3(s * w, sk.ry * 0.25, z), q, new THREE.Vector3(1, 1, 1)); teeth.setMatrixAt(n++, mt);
  }
  jawP.add(teeth);
  const upper = new THREE.InstancedMesh(c.G('tooth', () => null), c.toothMat, NT * 2);
  let u = 0;
  for (let i = 0; i < NT; i++) for (const s of [1, -1]) {
    const z = sk.z - sk.len * 0.1 + i / NT * sk.len * 1.25;
    const k = Math.max(0, (z - sk.z) / (sk.len * 1.2));
    e.set(PI, 0, 0); q.setFromEuler(e); mt.compose(new THREE.Vector3(s * sk.rx * 0.8 * (1 - k * 0.55), -sk.ry * 0.45, z), q, new THREE.Vector3(1, 1, 1)); upper.setMatrixAt(u++, mt);
  }
  c.model.add(upper);
  c.setJaw(jawP, 0.6);
  c.eyes(sk.rx * 0.22, sk.rx * 0.75, sk.ry * 0.55, sk.z, '#b89a40');
  // four flippers
  const flips = [];
  const fl = mosa
    ? [[0.11, 0.07, 0.15], [-0.12, 0.055, 0.11]]
    : [[0.08, 0.1, 0.32], [-0.2, 0.09, 0.3]];
  fl.forEach(([z, x, L], fi) => {
    for (const s of [1, -1]) {
      const p = c.pivot(s * x, -0.03, z);
      c.add(c.G(`fl${fi}${s}`, () => { const g = finXZ([[0, 0.04], [L * 0.4, 0.02], [L, -L * 0.35], [L * 0.95, -L * 0.45], [L * 0.4, -L * 0.25], [0, -0.03]]); if (s < 0) g.scale(-1, 1, 1); return g; }), c.skin, p);
      flips.push({ p, s, fi });
    }
  });
  c.anims.push((t, dt, sp) => {
    const f = mosa ? 1.2 : 1.4 + sp * 1.8;
    for (const fp of flips) {
      const ph = fp.fi === 0 ? 0 : PI * 0.6;
      fp.p.rotation.z = fp.s * Math.sin(t * f + ph) * (mosa ? 0.15 : 0.5);
      fp.p.rotation.y = fp.s * Math.cos(t * f + ph) * (mosa ? 0.1 : 0.25);
    }
  });
};

// Livyatan: sperm-whale-like body with a shorter, broad head, huge interlocking teeth in both jaws,
// small pectoral flippers, a low dorsal hump and horizontal flukes that beat up and down
BUILD.whale = (c, m) => {
  c.U.uAmp.value = 0.03; c.U.uAxis.value = 1; c.U.uK.value = 5; c.freq = 0.55;
  c.skin.roughness = 0.75;
  const R = 0.12;
  c.add(c.G('body', () => {
    const g = lathe((t) => R * (t < 0.35 ? 0.18 + 0.82 * Math.pow(t / 0.35, 1.1) : t < 0.88 ? 1 : Math.pow(Math.cos((t - 0.88) / 0.12 * PI / 2), 0.3)), 40, 22, -0.44, 0.46);
    g.scale(0.88, 1.0, 1);
    return g;
  }), c.skin);
  c.add(c.G('flukes', () => { const g = finXZ([[0, 0.04], [0.08, 0.0], [0.17, -0.06], [0.16, -0.08], [0.06, -0.06], [0.02, -0.04], [-0.02, -0.04], [-0.06, -0.06], [-0.16, -0.08], [-0.17, -0.06], [-0.08, 0], [0, 0.04]]); g.translate(0, 0, -0.44); return g; }), c.skin);
  c.add(c.G('hump', () => { const g = finYZ([[0.05, 0], [-0.03, 0.035], [-0.08, 0.02], [-0.1, 0]]); g.translate(0, R * 0.85, -0.12); return g; }), c.skin);
  const pecs = [];
  for (const s of [1, -1]) {
    const p = c.pivot(s * R * 0.8, -R * 0.55, 0.22);
    c.add(c.G('pec' + s, () => { const g = finXZ([[0, 0.03], [0.07, -0.01], [0.09, -0.05], [0.03, -0.04], [0, -0.03]]); if (s < 0) g.scale(-1, 1, 1); g.rotateZ(-s * 0.4); return g; }), c.skin, p);
    pecs.push({ p, s });
  }
  const jawP = c.pivot(0, -R * 0.7, 0.2);
  c.add(c.G('jaw', () => { const g = ellipsoid(R * 0.5, R * 0.14, 0.15, 0, 0, 0.13); return g; }), c.skin, jawP);
  c.add(c.G('mouthIn', () => ellipsoid(R * 0.45, R * 0.16, 0.14, 0, 0.03, 0.14)), c.mat({ color: '#d8c8c0', roughness: 0.6 }), jawP);
  const NT = 11;
  const teeth = new THREE.InstancedMesh(c.G('tooth', () => new THREE.ConeGeometry(0.009, 0.045, 5)), c.toothMat, NT * 2);
  const upper = new THREE.InstancedMesh(c.G('tooth', () => null), c.toothMat, NT * 2);
  const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  let n = 0;
  for (let i = 0; i < NT; i++) for (const s of [1, -1]) {
    const z = 0.03 + i * 0.019;
    e.set(0.15, 0, 0); q.setFromEuler(e); mt.compose(new THREE.Vector3(s * R * 0.36 * (1 - i / NT * 0.4), R * 0.12, z), q, new THREE.Vector3(1, 1, 1)); teeth.setMatrixAt(n, mt);
    e.set(PI - 0.15, 0, 0); q.setFromEuler(e); mt.compose(new THREE.Vector3(s * R * 0.4 * (1 - i / NT * 0.35), -R * 0.6, 0.2 + z), q, new THREE.Vector3(1, 1, 1)); upper.setMatrixAt(n, mt);
    n++;
  }
  jawP.add(teeth);
  c.model.add(upper);
  c.setJaw(jawP, 0.55);
  c.eyes(0.012, R * 0.86, -R * 0.35, 0.32, '#2a2018');
  c.anims.push((t) => { for (const f of pecs) f.p.rotation.z = f.s * Math.sin(t * 0.9) * 0.15; });
};

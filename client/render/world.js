// Ocean environment: terrain, rocks, kelp, coral rubble, light shafts, marine snow, vents, and depth-based fog/light.
import * as THREE from 'three';
import { WORLD, floorHeight, fbm, valueNoise } from '/shared/world.js';

const PI = Math.PI;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const FOG_SHALLOW = new THREE.Color('#2c4a42');
const FOG_MID = new THREE.Color('#0f2328');
const FOG_DEEP = new THREE.Color('#02080a');

export class OceanWorld {
  constructor(scene) {
    this.scene = scene;
    this.time = { value: 0 };
    this.fog = new THREE.FogExp2(FOG_SHALLOW.clone(), 0.02);
    scene.fog = this.fog;
    scene.background = this.fog.color;

    this.hemi = new THREE.HemisphereLight('#9cc8b8', '#1a1a10', 1.4);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#d8f0d8', 1.6);
    this.sun.position.set(0.3, 1, -0.2);
    scene.add(this.sun);
    this.camLight = new THREE.PointLight('#a8c8c0', 0, 45, 1.2);
    scene.add(this.camLight);

    this.buildTerrain();
    this.buildRocks();
    this.buildKelp();
    this.buildCoral();
    this.buildShafts();
    this.buildSurface();
    this.buildSnow();
    this.buildVents();
  }

  // caustics + depth-darkening injected into standard materials
  causticPatch(mat) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.time;
      sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wpc = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        wpc = instanceMatrix * wpc;
        #endif
        vWPos = (modelMatrix * wpc).xyz;`);
      sh.fragmentShader = 'uniform float uTime;\nvarying vec3 vWPos;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec2 cp = vWPos.xz * 0.16;
        float c1 = sin(cp.x * 2.1 + uTime * 0.9 + sin(cp.y * 1.7 + uTime * 0.6) * 1.6);
        float c2 = sin(cp.y * 2.3 - uTime * 0.7 + sin(cp.x * 1.3 - uTime * 0.5) * 1.8);
        float caus = pow(max(0.0, 1.0 - abs(c1 + c2) * 0.75), 6.0);
        float depthK = clamp(1.0 + vWPos.y / 70.0, 0.0, 1.0);
        totalEmissiveRadiance += vec3(0.55, 0.75, 0.6) * caus * depthK * 0.14;`);
    };
    mat.customProgramCacheKey = () => 'caustic';
  }

  buildTerrain() {
    const size = WORLD.half * 2 + 200, seg = 220;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-PI / 2);
    const p = g.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const sand = new THREE.Color('#7d7558'), silt = new THREE.Color('#3b3a2c'), dark = new THREE.Color('#141612'), algae = new THREE.Color('#3f4a2c'), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const h = floorHeight(x, z);
      p.setY(i, h);
      const d = -h;
      c.copy(sand).lerp(silt, Math.min(1, d / 90)).lerp(dark, Math.max(0, Math.min(1, (d - 90) / 110)));
      const n = fbm(x * 0.03, z * 0.03);
      if (n > 0.55 && d < 70) c.lerp(algae, (n - 0.55) * 2.5);
      c.multiplyScalar(0.75 + fbm(x * 0.2, z * 0.2, 2) * 0.5);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    // detail texture for grit
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const ctx = cv.getContext('2d'); const img = ctx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const v = 150 + (valueNoise(x * 0.25, y * 0.25) - 0.5) * 120 + (Math.random() - 0.5) * 50 + (fbm(x * 0.05, y * 0.05) - 0.5) * 80;
      const i = (y * 256 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(90, 90);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, bumpMap: tex, bumpScale: 2, roughness: 0.95 });
    this.causticPatch(mat);
    this.terrain = new THREE.Mesh(g, mat);
    this.scene.add(this.terrain);
  }

  buildRocks() {
    const r = rng(7);
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const k = 0.7 + fbm(v.x * 1.7 + 5, v.z * 1.7 + v.y * 1.3, 3) * 0.6;
      v.multiplyScalar(k);
      p.setXYZ(i, v.x, v.y * 0.75, v.z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: '#4d4a40', roughness: 0.95, flatShading: true });
    this.causticPatch(mat);
    const N = 900;
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const x = (r() * 2 - 1) * (WORLD.half + 60), z = (r() * 2 - 1) * (WORLD.half + 60);
      const h = floorHeight(x, z);
      const big = r() < 0.08;
      const s = big ? 6 + r() * 14 : 0.6 + r() * 3.5;
      e.set(r() * PI, r() * PI, r() * PI); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, h + s * 0.25, z), q, new THREE.Vector3(s, s * (0.5 + r() * 0.8), s * (0.7 + r() * 0.6)));
      mesh.setMatrixAt(i, m);
      col.setHSL(0.12 + r() * 0.1, 0.12 + r() * 0.1, 0.2 + r() * 0.15);
      if (-h < 60 && r() < 0.4) col.lerp(new THREE.Color('#3e4a2a'), 0.5);
      mesh.setColorAt(i, col);
    }
    this.scene.add(mesh);
  }

  buildKelp() {
    const r = rng(11);
    // a tall ribbon with many segments so it can sway
    const segs = 14;
    const geo = new THREE.PlaneGeometry(1, 1, 1, segs);
    geo.translate(0, 0.5, 0);
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 512;
    const ctx = cv.getContext('2d');
    for (let y = 0; y < 512; y += 2) {
      const k = y / 512;
      const w = 30 * (0.35 + 0.65 * Math.sin(Math.min(1, (1 - k) * 1.2) * Math.PI * 0.9)) * (0.85 + 0.15 * Math.sin(y * 0.13));
      const g = ctx.createLinearGradient(32 - w, 0, 32 + w, 0);
      g.addColorStop(0, 'rgb(70,78,30)'); g.addColorStop(0.5, 'rgb(150,140,60)'); g.addColorStop(1, 'rgb(70,78,30)');
      ctx.fillStyle = g;
      ctx.fillRect(32 - w, y, w * 2, 2);
    }
    ctx.fillStyle = 'rgba(60,50,20,0.8)'; ctx.fillRect(30, 0, 4, 512);
    for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(30,30,10,${Math.random() * 0.4})`; ctx.fillRect(Math.random() * 64, Math.random() * 512, 2, 4); }
    const ktex = new THREE.CanvasTexture(cv);
    ktex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: ktex, roughness: 0.75, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.time;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.07;
        float h = position.y;
        transformed.x += sin(uTime * 0.8 + ph + h * 2.5) * 0.25 * h * h;
        transformed.z += cos(uTime * 0.6 + ph + h * 2.0) * 0.2 * h * h;
        transformed.x *= 1.0 + 0.4 * sin(h * 12.0 + ph);`);
    };
    mat.customProgramCacheKey = () => 'kelp';
    const N = 1400;
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    let n = 0;
    for (let tries = 0; tries < 20000 && n < N; tries++) {
      const x = (r() * 2 - 1) * WORLD.half, z = -WORLD.half + r() * (WORLD.half * 1.1);
      const h = floorHeight(x, z);
      if (-h > 75) continue;
      if (fbm(x * 0.02 + 9, z * 0.02) < 0.5) continue; // kelp grows in patches
      const height = Math.min(-h - 2, 8 + r() * 30);
      e.set(0, r() * PI, 0); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, h - 0.5, z), q, new THREE.Vector3(1.2 + r() * 1.2, height, 1));
      mesh.setMatrixAt(n, m);
      col.setHSL(0.15 + r() * 0.06, 0.3, 0.45 + r() * 0.2);
      mesh.setColorAt(n, col);
      n++;
    }
    mesh.count = n;
    this.scene.add(mesh);
  }

  buildCoral() {
    // dead, silted coral and sponges: muted branching lumps in the shallows, tube sponges deeper
    const r = rng(23);
    const geo = new THREE.CylinderGeometry(0.15, 0.4, 1, 6, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: '#7a6a58', roughness: 0.9 });
    this.causticPatch(mat);
    const N = 1600;
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    let n = 0;
    for (let tries = 0; tries < 20000 && n < N; tries++) {
      const cx = (r() * 2 - 1) * WORLD.half, cz = (r() * 2 - 1) * WORLD.half;
      const h0 = floorHeight(cx, cz);
      const deep = -h0 > 80;
      const clump = 3 + Math.floor(r() * 7);
      for (let k = 0; k < clump && n < N; k++) {
        const x = cx + (r() - 0.5) * 6, z = cz + (r() - 0.5) * 6;
        const h = floorHeight(x, z);
        e.set((r() - 0.5) * 0.8, r() * PI, (r() - 0.5) * 0.8); q.setFromEuler(e);
        const s = deep ? 0.6 + r() * 1.2 : 0.4 + r();
        m.compose(new THREE.Vector3(x, h - 0.2, z), q, new THREE.Vector3(s, s * (deep ? 3 + r() * 4 : 1 + r() * 2.5), s));
        mesh.setMatrixAt(n, m);
        if (deep) col.setHSL(0.05 + r() * 0.08, 0.25, 0.25 + r() * 0.15);
        else col.setHSL(r() < 0.5 ? 0.02 + r() * 0.06 : 0.1 + r() * 0.05, 0.2 + r() * 0.15, 0.3 + r() * 0.15);
        mesh.setColorAt(n, col);
        n++;
      }
    }
    mesh.count = n;
    this.scene.add(mesh);
  }

  buildShafts() {
    const r = rng(31);
    const geo = new THREE.CylinderGeometry(3, 9, 90, 12, 1, true);
    geo.translate(0, -45, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, uFade: { value: 1 } },
      vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uTime; uniform float uFade; varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ float edge = pow(abs(dot(vN, vV)), 2.0); float a = (1.0 + vY/90.0) * edge * 0.10 * uFade; gl_FragColor = vec4(0.75, 0.95, 0.85, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.shaftMat = mat;
    this.shafts = [];
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Mesh(geo, mat);
      s.position.set((r() * 2 - 1) * WORLD.half, 0, -WORLD.half + r() * 300);
      s.rotation.set((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3 + 0.15);
      s.scale.set(0.6 + r(), 0.8 + r() * 0.6, 0.6 + r());
      s.userData.ph = r() * 10;
      this.scene.add(s);
      this.shafts.push(s);
    }
  }

  buildSurface() {
    const geo = new THREE.PlaneGeometry(WORLD.half * 2 + 400, WORLD.half * 2 + 400, 80, 80);
    geo.rotateX(PI / 2); // facing down
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, fogColor: { value: this.fog.color }, fogDensity: { value: 0 } },
      vertexShader: `uniform float uTime; varying vec3 vW; varying float vDepth;
        void main(){ vec3 p = position; p.y += sin(p.x*0.08+uTime)*0.4 + cos(p.z*0.07+uTime*0.8)*0.4; vec4 w = modelMatrix*vec4(p,1.0); vW = w.xyz; vec4 mv = viewMatrix*w; vDepth = -mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uTime; uniform vec3 fogColor; uniform float fogDensity; varying vec3 vW; varying float vDepth;
        void main(){ vec2 p = vW.xz*0.05; float r = sin(p.x*3.0+uTime*0.7+sin(p.y*2.0+uTime))*sin(p.y*3.3-uTime*0.5+sin(p.x*1.7));
          vec3 col = mix(vec3(0.35,0.55,0.48), vec3(0.85,0.95,0.85), smoothstep(0.3,1.0,r));
          float f = 1.0 - exp(-fogDensity*fogDensity*vDepth*vDepth*0.35);
          gl_FragColor = vec4(mix(col, fogColor, f), 1.0); }`,
      side: THREE.DoubleSide,
    });
    this.surfaceMat = mat;
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 0.2;
    this.scene.add(m);
  }

  buildSnow() {
    const N = 4000;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 120; pos[i * 3 + 1] = (Math.random() - 0.5) * 80; pos[i * 3 + 2] = (Math.random() - 0.5) * 120; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const ctx = cv.getContext('2d');
    const grd = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(cv);
    this.snowMat = new THREE.PointsMaterial({ size: 0.22, map: tex, color: '#c8d8c8', transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true });
    this.snow = new THREE.Points(g, this.snowMat);
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
    // bioluminescent motes for the deep
    const M = 600;
    const p2 = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) { p2[i * 3] = (Math.random() - 0.5) * 160; p2[i * 3 + 1] = (Math.random() - 0.5) * 100; p2[i * 3 + 2] = (Math.random() - 0.5) * 160; }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(p2, 3));
    this.bioMat = new THREE.PointsMaterial({ size: 0.5, map: tex, color: '#4ad0d8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.bio = new THREE.Points(g2, this.bioMat);
    this.bio.frustumCulled = false;
    this.scene.add(this.bio);
  }

  buildVents() {
    // hydrothermal vents in the trench, glowing orange with rising particles
    const r = rng(41);
    this.vents = [];
    const chimneyMat = new THREE.MeshStandardMaterial({ color: '#2a2420', roughness: 1, emissive: '#ff5a10', emissiveIntensity: 0.0 });
    const glowMat = new THREE.MeshBasicMaterial({ color: '#ff7a30', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const x = (r() - 0.5) * 220, z = 170 + r() * 150;
      const h = floorHeight(x, z);
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(1.2 + r(), 3 + r() * 2, 10 + r() * 14, 9, 4), chimneyMat);
      ch.geometry.translate(0, ch.geometry.parameters.height / 2, 0);
      ch.position.set(x, h - 1, z);
      this.scene.add(ch);
      const top = h - 1 + ch.geometry.parameters.height;
      const glow = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), glowMat);
      glow.position.set(x, top, z);
      this.scene.add(glow);
      const light = new THREE.PointLight('#ff6a20', 30, 45, 1.6);
      light.position.set(x, top + 2, z);
      this.scene.add(light);
      this.vents.push({ x, y: top, z, light });
    }
    const N = 700;
    const pos = new Float32Array(N * 3);
    this.ventParts = [];
    for (let i = 0; i < N; i++) this.ventParts.push({ v: i % this.vents.length, t: Math.random() * 6, dx: (Math.random() - 0.5), dz: (Math.random() - 0.5) });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.ventPoints = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.6, color: '#55504a', transparent: true, opacity: 0.6, depthWrite: false }));
    this.ventPoints.frustumCulled = false;
    this.scene.add(this.ventPoints);
  }

  update(dt, camPos, extraDark = 0, focus = null, focusSize = 1) {
    this.time.value += dt;
    const depth = Math.max(0, -camPos.y);
    const k1 = Math.min(1, depth / 60), k2 = Math.max(0, Math.min(1, (depth - 60) / 110));
    this.fog.color.copy(FOG_SHALLOW).lerp(FOG_MID, k1).lerp(FOG_DEEP, k2);
    const viewDist = focus ? camPos.distanceTo(focus) : 4;
    const vis = Math.min(1, Math.max(0.33, 8 / (viewDist + 4)));
    this.fog.density = (0.016 + k1 * 0.006 + k2 * 0.008) * vis + extraDark * 0.25;
    this.hemi.intensity = 1.5 * (1 - k1 * 0.6) * (1 - k2 * 0.8) + 0.25;
    this.sun.intensity = 1.8 * (1 - k1 * 0.75) * (1 - k2);
    this.camLight.intensity = (30 + k2 * 320) * (1 + focusSize * 0.25);
    this.camLight.distance = 45 + k2 * 30 + focusSize * 5;
    if (focus) this.camLight.position.lerpVectors(camPos, focus, 0.6).y += focusSize;
    else this.camLight.position.copy(camPos);
    this.shaftMat.uniforms.uFade.value = Math.max(0, 1 - depth / 55);
    this.surfaceMat.uniforms.fogDensity.value = this.fog.density;
    this.snowMat.opacity = 0.45 + k2 * 0.15;
    this.bioMat.opacity = k2 * 0.8;
    // keep particles in a box around the camera
    this.wrapPoints(this.snow, camPos, 120, 80, dt * -0.25);
    this.wrapPoints(this.bio, camPos, 160, 100, Math.sin(this.time.value) * dt * 0.2);
    // vent smoke
    const vp = this.ventPoints.geometry.attributes.position;
    for (let i = 0; i < this.ventParts.length; i++) {
      const p = this.ventParts[i];
      p.t += dt;
      if (p.t > 6) { p.t = 0; p.dx = Math.random() - 0.5; p.dz = Math.random() - 0.5; }
      const v = this.vents[p.v];
      vp.setXYZ(i, v.x + p.dx * (1 + p.t * 1.5), v.y + p.t * 4, v.z + p.dz * (1 + p.t * 1.5));
    }
    vp.needsUpdate = true;
    for (const v of this.vents) v.light.intensity = 26 + Math.sin(this.time.value * 3 + v.x) * 6;
  }

  wrapPoints(points, c, w, h, dy) {
    const p = points.geometry.attributes.position;
    const a = p.array;
    for (let i = 0; i < a.length; i += 3) {
      a[i + 1] += dy;
      let x = a[i] - c.x, y = a[i + 1] - c.y, z = a[i + 2] - c.z;
      if (x > w / 2) a[i] -= w; else if (x < -w / 2) a[i] += w;
      if (y > h / 2) a[i + 1] -= h; else if (y < -h / 2) a[i + 1] += h;
      if (z > w / 2) a[i + 2] -= w; else if (z < -w / 2) a[i + 2] += w;
    }
    p.needsUpdate = true;
  }
}

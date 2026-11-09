import * as THREE from 'three';
import { OceanWorld } from './render/world.js';
import { Creature } from './render/creatures.js';
import { Effects, FoodRenderer } from './render/effects.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { OnlineConnection, LocalConnection } from './net.js';
import { SPECIES, stats, TIER_NAMES } from '/shared/species.js';
import { forwardVec, clampToWorld, floorHeight, WORLD } from '/shared/world.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ------------------------------------------------------------------ renderer
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 700);
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const world = new OceanWorld(scene);
const fx = new Effects(scene);
const food = new FoodRenderer(scene);
const input = new Input(canvas);
const audio = new Audio();
const hud = new Hud();

if (params.has('gallery')) { gallery(); }
else { game(); }

// ------------------------------------------------------------------ game
function game() {
  let conn = null;
  let myId = null;
  let me = null;               // latest server state about me
  let mine = null;             // my creature model
  const ents = new Map();      // id -> remote entity
  const local = { pos: new THREE.Vector3(0, -10, -250), vel: new THREE.Vector3(), stunUntil: 0, dashT: 0, boostT: 0, bodyYaw: 0, bodyPitch: 0, faceT: 0, faceYaw: 0, facePitch: 0 };
  const cds = { bite: 0, a2: 0, dash: 0, dashMax: 2.5 };
  let sendTimer = 0;
  let clock = 0;
  let alive = false;
  let lastAlltime = [];
  const camPos = new THREE.Vector3(0, -10, -260);

  $('name').value = (() => { try { return localStorage.getItem('fih-name') || ''; } catch { return ''; } })();

  function setStatus(t) { $('netstatus').textContent = t; }

  async function connectOnline() {
    const c = new OnlineConnection();
    wire(c);
    try {
      setStatus('Connecting to server…');
      await c.connect();
      conn = c;
      setStatus('Connected · online multiplayer');
      $('play').disabled = false;
    } catch (e) {
      setStatus('Server unreachable, retrying… (or play offline)');
      $('play').disabled = true;
      if (!conn) setTimeout(() => { if (!conn) connectOnline(); }, 3000);
    }
  }

  function wire(c) {
    c.onMessage((m) => { if (c === conn || !conn) onMsg(m); });
    c.onClose((reason) => {
      if (c !== conn) return;
      conn = null;
      toMenu(`Disconnected: ${reason}`);
      setTimeout(connectOnline, 1500);
    });
  }

  function start(asOffline) {
    audio.start();
    const name = $('name').value.trim() || 'fih';
    try { localStorage.setItem('fih-name', name); } catch {}
    conn.send({ t: 'join', name });
    $('menu').classList.add('hidden');
    $('death').classList.add('hidden');
    hud.show(true);
    input.enabled = true;
    input.lock();
  }

  $('play').addEventListener('click', () => { if (conn) start(false); });
  $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter' && conn) start(false); });
  $('offline').addEventListener('click', async () => {
    if (conn) conn.close();
    const c = new LocalConnection();
    conn = c;
    wire(c);
    await c.connect();
    start(true);
  });
  $('respawn').addEventListener('click', () => {
    if (!conn) return;
    conn.send({ t: 'respawn' });
    $('death').classList.add('hidden');
    hud.show(true);
    input.enabled = true;
    input.lock();
  });
  $('tomenu').addEventListener('click', () => {
    if (conn instanceof LocalConnection) { conn.close(); conn = null; connectOnline(); }
    else if (conn) { conn.close(); conn = null; connectOnline(); }
    toMenu('');
  });

  function toMenu(msg) {
    alive = false;
    myId = null;
    input.enabled = false;
    input.unlock();
    hud.show(false);
    $('death').classList.add('hidden');
    $('menu').classList.remove('hidden');
    for (const e of ents.values()) removeEnt(e);
    ents.clear();
    if (mine) { scene.remove(mine.root); mine.dispose(); mine = null; }
    if (msg) setStatus(msg);
  }

  input.onKey = (code) => {
    if (code === 'KeyM') $('mute').textContent = audio.toggleMute() ? 'M: sound off' : 'M: sound on';
    if (code === 'Tab' && alive) togglePicker();
    if (me && me.choices && /^Digit[1-4]$/.test(code)) {
      const i = Number(code.slice(5)) - 1;
      if (me.choices[i]) choose(me.choices[i]);
    }
  };
  hud.onChoose = (id) => choose(id);

  // ---------------------------------------------------------------- side menu: pick any fish
  function buildPicker() {
    const list = $('picklist');
    list.innerHTML = '';
    for (let tier = 0; tier < TIER_NAMES.length; tier++) {
      const h = document.createElement('h4');
      h.textContent = TIER_NAMES[tier];
      list.appendChild(h);
      for (const s of SPECIES) {
        if (s.tier !== tier || s.ambient) continue;
        const b = document.createElement('button');
        b.className = 'pick';
        b.dataset.sp = s.id;
        b.innerHTML = `<b></b><small></small>`;
        b.firstChild.textContent = s.name;
        b.lastChild.textContent = `${s.role} · ${s.era}`;
        b.addEventListener('click', () => {
          if (!conn || !alive) return;
          conn.send({ t: 'pick', sp: s.id });
          togglePicker(false);
          input.lock();
        });
        list.appendChild(b);
      }
    }
  }
  buildPicker();
  function togglePicker(force) {
    const el = $('picker');
    const open = force ?? el.classList.contains('hidden');
    el.classList.toggle('hidden', !open);
    if (open) {
      input.unlock();
      for (const b of el.querySelectorAll('.pick')) b.classList.toggle('current', !!me && SPECIES[me.sp].id === b.dataset.sp);
    }
  }
  $('pickbtn').addEventListener('click', () => togglePicker());
  function choose(id) { if (conn) conn.send({ t: 'evo', sp: id }); }

  // ---------------------------------------------------------------- messages
  function onMsg(m) {
    switch (m.t) {
      case 'welcome':
        food.set(m.food);
        lastAlltime = m.alltime || [];
        hud.alltime(lastAlltime);
        break;
      case 'alltime': lastAlltime = m.list; hud.alltime(m.list); break;
      case 'spawn':
        myId = m.id;
        alive = true;
        local.pos.set(m.pos[0], m.pos[1], m.pos[2]);
        local.vel.set(0, 0, 0);
        input.yaw = m.yaw; input.pitch = 0;
        local.bodyYaw = m.yaw; local.bodyPitch = 0; local.faceT = 0;
        camPos.copy(local.pos).add(new THREE.Vector3(0, 1, -4));
        break;
      case 'fix': local.pos.set(m.pos[0], m.pos[1], m.pos[2]); break;
      case 'kb':
        local.vel.add(new THREE.Vector3(m.v[0], m.v[1], m.v[2]));
        if (m.stun) local.stunUntil = clock + m.stun;
        break;
      case 'ate':
        audio.eat(m.type === 1);
        if (mine) fx.bubbles(local.pos.toArray(), 2, 0.3);
        break;
      case 'feed': hud.feed(m.msg); break;
      case 'dead': onDead(m); break;
      case 's': onSnap(m); break;
    }
  }

  function onDead(m) {
    alive = false;
    audio.death();
    input.unlock();
    input.enabled = false;
    if (mine) { fx.blood(local.pos.toArray(), mine.spec.size, 2); scene.remove(mine.root); mine.dispose(); mine = null; }
    myId = null;
    me = null;
    hud.show(false);
    const k = m.killer;
    $('deathby').textContent = k ? `You were eaten by ${k.name ? k.name + ' the ' : 'a '}${k.species} (Lv ${k.level})` : 'You succumbed to your wounds.';
    $('deathstats').innerHTML = `<div><b>${m.score}</b>Score</div><div><b>${m.level}</b>Level</div><div><b>${m.kills}</b>Kills</div><div><b>${m.species}</b>Final form</div>`;
    $('death').classList.remove('hidden');
  }

  function removeEnt(e) {
    scene.remove(e.c.root);
    e.c.dispose();
  }

  // server clock tracking for buffered interpolation of other creatures
  const net = { offset: null, delay: 0.12 };
  function onSnap(m) {
    const recv = performance.now() / 1000;
    const off = recv - m.time;
    if (net.offset === null || off < net.offset) net.offset = off;
    else net.offset += (off - net.offset) * 0.002; // follow slow clock drift
    // how late this packet arrived compared to the best case: grow the buffer fast, shrink it slowly
    const late = off - net.offset;
    net.delay = Math.min(0.6, Math.max(0.1, late + 0.06 > net.delay ? late + 0.06 : net.delay * 0.995));
    if (m.fa) for (const f of m.fa) food.add(f);
    if (m.fr) for (const id of m.fr) food.remove(id);
    if (m.lb) hud.live(m.lb, myId);
    if (m.me) {
      const prevLevel = me ? me.level : m.me.level;
      me = m.me;
      if (!mine || mine.sp !== me.sp) {
        if (mine) { scene.remove(mine.root); mine.dispose(); }
        mine = new Creature(me.sp);
        scene.add(mine.root);
      }
      if (me.level > prevLevel) hud.feed(`Level ${me.level}!`);
    }
    const seen = new Set();
    for (const row of m.e) {
      const [id, sp, lvl, x, y, z, yaw, pitch, hp, flags, name] = row;
      if (id === myId) { if (mine) mine.flags = flags; continue; }
      seen.add(id);
      let e = ents.get(id);
      if (e && e.sp !== sp) { removeEnt(e); ents.delete(id); e = null; }
      if (!e) {
        e = { id, sp, c: new Creature(sp), pos: new THREE.Vector3(x, y, z), buf: [], yaw, pitch, lastHit: -99, speed: 0 };
        e.c.root.position.copy(e.pos);
        scene.add(e.c.root);
        ents.set(id, e);
        e.st = stats(sp, lvl); e.size = e.st.size;
      }
      e.buf.push({ t: m.time, x, y, z, yaw, pitch });
      if (e.buf.length > 30) e.buf.shift();
      if (e.level !== lvl) { e.st = stats(sp, lvl); e.size = e.st.size; }
      e.level = lvl; e.hp = hp; e.flags = flags; e.name = name || null;
    }
    for (const [id, e] of ents) if (!seen.has(id)) { removeEnt(e); ents.delete(id); }
    if (m.ev) for (const ev of m.ev) onEvent(ev);
  }

  function entPos(id) {
    if (id === myId) return local.pos;
    const e = ents.get(id);
    return e ? e.pos : null;
  }
  function volAt(pos) {
    const d = Math.hypot(pos[0] - local.pos.x, pos[1] - local.pos.y, pos[2] - local.pos.z);
    return Math.max(0, 1 - d / 70);
  }
  function creatureOf(id) { return id === myId ? mine : ents.get(id)?.c; }

  function onEvent(ev) {
    switch (ev.k) {
      case 'bite': {
        const c = creatureOf(ev.id);
        if (c && ev.id !== myId) {
          c.attack('bite');
          const e = ents.get(ev.id);
          if (e) fx.chomp(e.c.root, e.size);
        }
        if (ev.id !== myId) audio.bite(volAt(ev.pos) * 0.8, c ? c.spec.size : 1);
        break;
      }
      case 'hit': {
        const c = creatureOf(ev.id);
        if (c) c.hit();
        const e = ents.get(ev.id); if (e) e.lastHit = clock;
        fx.blood(ev.pos, ev.s, Math.min(2, ev.d / 30 + 0.4));
        if (ev.id === myId) { hud.hurt(); audio.hurt(); }
        else audio.hit(volAt(ev.pos), ev.s);
        if (ev.by === myId) { const e2 = ents.get(ev.id); if (e2) e2.lastHit = clock; }
        break;
      }
      case 'die': {
        fx.blood(ev.pos, ev.s, ev.sw ? 0.6 : 2.5);
        if (ev.by === myId && ev.id !== myId) {
          const e = ents.get(ev.id);
          if (e) hud.feed(`${ev.sw ? 'Swallowed' : 'Killed'} ${e.name || SPECIES[e.sp].name}`);
          audio.hit(1, ev.s * 1.5);
        }
        const e = ents.get(ev.id);
        if (e) { removeEnt(e); ents.delete(ev.id); }
        break;
      }
      case 'gone': { const e = ents.get(ev.id); if (e) { removeEnt(e); ents.delete(ev.id); } break; }
      case 'lvl':
        if (ev.id === myId) { audio.levelUp(); fx.sparkle(ev.pos, '#bfe8a0', 16, mine ? mine.spec.size * 0.6 + 0.5 : 1); }
        break;
      case 'evo':
        fx.sparkle(ev.pos, '#f0e0a0', 40, 3);
        fx.ring(ev.pos, 8, '#f0e8c0', 1);
        if (ev.id === myId) { audio.evolve(); hud.feed('You evolved!'); }
        break;
      case 'a2': {
        const v = volAt(ev.pos);
        if (ev.id !== myId) audio.ability(ev.type, v);
        const c = creatureOf(ev.id);
        const size = c ? c.spec.size : 1;
        if (ev.type === 'pulse') fx.ring(ev.pos, size * 2.4 + 3, '#70e070', 0.7);
        if (ev.type === 'sonar') fx.ring(ev.pos, size * 3, '#c0e8ff', 0.8);
        if (ev.type === 'spikes' || ev.type === 'shell') fx.ring(ev.pos, size * 1.4, '#e0d8a0', 0.4);
        if (c && ev.id !== myId) {
          c.attack(ev.type);
          const e = ents.get(ev.id);
          if (e && (ev.type === 'slash' || ev.type === 'grab' || ev.type === 'venom')) fx.chomp(e.c.root, e.size * 1.2);
        }
        if (['lunge', 'ram', 'snap', 'ink'].includes(ev.type)) fx.bubbles(ev.pos, 10, size * 0.5);
        break;
      }
      case 'ink': fx.ink(ev.pos, ev.r, ev.dur); break;
    }
  }

  // ---------------------------------------------------------------- local control
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), desired = new THREE.Vector3();

  function faceAim(t) { local.faceYaw = input.yaw; local.facePitch = input.pitch; local.faceT = t; }

  function controlMe(dt) {
    if (!alive || !me || !mine) return;
    const sp = SPECIES[me.sp];
    const f = forwardVec(input.yaw, input.pitch);
    fwd.set(f[0], f[1], f[2]);
    right.set(-Math.cos(input.yaw), 0, Math.sin(input.yaw));
    const stunned = clock < local.stunUntil;
    const ax = input.axis();
    const press = input.consume();
    cds.bite = Math.max(0, cds.bite - dt); cds.a2 = Math.max(0, cds.a2 - dt); cds.dash = Math.max(0, cds.dash - dt);
    local.dashT = Math.max(0, local.dashT - dt);
    local.boostT = Math.max(0, local.boostT - dt);
    const speed = me.speed * (local.dashT > 0 ? 2.2 : 1) * (local.boostT > 0 ? 1.6 : 1);
    desired.set(0, 0, 0);
    if (!stunned) {
      desired.addScaledVector(fwd, ax.f).addScaledVector(right, ax.r).addScaledVector(up, ax.u);
      if (desired.lengthSq() > 1) desired.normalize();
      desired.multiplyScalar(speed);
    }
    const accel = desired.lengthSq() > 0 ? 3.2 : 1.6;
    local.vel.lerp(desired, Math.min(1, dt * accel));
    if (!stunned) {
      if (press.dash && cds.dash <= 0) {
        cds.dash = cds.dashMax;
        local.dashT = 0.45;
        local.vel.addScaledVector(desired.lengthSq() > 0 ? desired.clone().normalize() : fwd, me.speed * 1.4);
        audio.dash();
        fx.bubbles(local.pos.toArray(), 8, me.size * 0.4);
      }
      if ((press.a1 || input.held.a1) && cds.bite <= 0) {
        cds.bite = sp.biteCd;
        faceAim(0.35);
        mine.attack('bite');
        fx.chomp(mine.root, me.size);
        audio.bite(1, me.size);
        conn.send({ t: 'a', n: 1, yaw: input.yaw, pitch: input.pitch });
      }
      if (press.a2 && cds.a2 <= 0) {
        const type = sp.a2.type;
        cds.a2 = sp.a2.cd;
        audio.ability(type, 1);
        if (type === 'snap') {
          // tail flip: shoot backwards relative to where the body points, without turning around
          const bf = forwardVec(local.bodyYaw, local.bodyPitch);
          local.vel.set(-bf[0], -bf[1], -bf[2]).multiplyScalar(me.speed * 3.2);
          local.faceYaw = local.bodyYaw; local.facePitch = local.bodyPitch; local.faceT = 0.6;
          conn.send({ t: 'a', n: 2, yaw: local.bodyYaw, pitch: local.bodyPitch });
        } else {
          faceAim(0.5);
          conn.send({ t: 'a', n: 2, yaw: input.yaw, pitch: input.pitch });
          switch (type) {
            case 'lunge': local.vel.copy(fwd).multiplyScalar(me.speed * 2.6); break;
            case 'ram': local.vel.copy(fwd).multiplyScalar(me.speed * 2.4); break;
            case 'ink': local.vel.addScaledVector(fwd, me.speed * 1.5); local.boostT = 2; break;
          }
          if (type === 'venom' || type === 'grab' || type === 'slash') fx.chomp(mine.root, me.size * (type === 'slash' ? 1.3 : 1.1));
        }
        mine.attack(type);
        fx.bubbles(local.pos.toArray(), 6, me.size * 0.4);
      }
    }
    local.pos.addScaledVector(local.vel, dt);
    const arr = clampToWorld(local.pos.toArray(), me.size * 0.3);
    local.pos.set(arr[0], arr[1], arr[2]);
    // body heading: follow the swim direction; briefly snap to the aim when attacking
    const v = local.vel, vs = v.length();
    let ty = local.bodyYaw, tp = local.bodyPitch, rate = 5;
    if (local.faceT > 0) { local.faceT -= dt; ty = local.faceYaw; tp = local.facePitch; rate = 24; }
    else if (vs > me.speed * 0.12) { ty = Math.atan2(v.x, v.z); tp = Math.max(-1.3, Math.min(1.3, Math.atan2(v.y, Math.hypot(v.x, v.z)))); }
    else tp *= 0.98; // level out when idle
    const tk = 1 - Math.exp(-dt * rate);
    const turn = angleDiff(ty, local.bodyYaw) * tk;
    local.bodyYaw += turn;
    local.bodyPitch += (tp - local.bodyPitch) * tk;
    mine.root.position.copy(local.pos);
    mine.root.rotation.y = local.bodyYaw;
    mine.root.rotation.x = -local.bodyPitch;
    mine.roll = (mine.roll || 0) + ((Math.max(-0.6, Math.min(0.6, -turn / Math.max(dt, 1e-3) * 0.25))) - (mine.roll || 0)) * Math.min(1, dt * 4);
    mine.root.rotation.z = mine.roll;
    mine.root.scale.setScalar(me.size);
    mine.update(dt, Math.min(1.5, local.vel.length() / me.speed), mine.flags || 0);
    mine.setOpacity((mine.flags & 4) ? 0.35 : 1);
    // send
    sendTimer -= dt;
    if (sendTimer <= 0) {
      sendTimer = 0.05;
      conn.send({ t: 'in', p: [r2(local.pos.x), r2(local.pos.y), r2(local.pos.z)], yaw: r3(local.bodyYaw), pitch: r3(local.bodyPitch) });
    }
  }

  // ---------------------------------------------------------------- remote entities
  const tmp = new THREE.Vector3();
  function sampleBuf(e, rt) {
    const b = e.buf;
    if (!b.length) return null;
    // drop samples we no longer need
    while (b.length > 2 && b[1].t <= rt) b.shift();
    const a = b[0];
    if (b.length === 1 || rt <= a.t) return { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: a.pitch };
    const c = b[1];
    const span = c.t - a.t || 0.05;
    let k = (rt - a.t) / span;
    k = Math.min(k, 1.5); // brief extrapolation if the next update is late
    return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, yaw: a.yaw + angleDiff(c.yaw, a.yaw) * Math.min(k, 1), pitch: a.pitch + (c.pitch - a.pitch) * Math.min(k, 1) };
  }
  function updateEnts(dt) {
    const rt = net.offset === null ? 0 : performance.now() / 1000 - net.offset - net.delay;
    const k = 1 - Math.exp(-dt * 25);
    for (const e of ents.values()) {
      const smp = sampleBuf(e, rt);
      if (!smp) continue;
      tmp.copy(e.pos);
      e.pos.lerp(tmp.set(smp.x, smp.y, smp.z), k);
      const moved = Math.hypot(smp.x - (e.px ?? smp.x), smp.y - (e.py ?? smp.y), smp.z - (e.pz ?? smp.z)) / Math.max(dt, 1e-3);
      e.px = smp.x; e.py = smp.y; e.pz = smp.z;
      e.speed += (moved - e.speed) * Math.min(1, dt * 4);
      const turn = angleDiff(smp.yaw, e.yaw);
      e.yaw += turn * k;
      e.pitch += (smp.pitch - e.pitch) * k;
      e.roll = (e.roll || 0) + (Math.max(-0.5, Math.min(0.5, -turn / Math.max(dt, 1e-3) * 0.15)) - (e.roll || 0)) * Math.min(1, dt * 4);
      e.c.root.position.copy(e.pos);
      e.c.root.rotation.set(-e.pitch, e.yaw, e.roll);
      e.c.root.scale.setScalar(e.size);
      e.c.update(dt, Math.min(1.5, e.speed / e.st.speed), e.flags);
      e.c.setOpacity((e.flags & 4) ? 0.08 : 1);
    }
  }

  // ---------------------------------------------------------------- camera
  const lookAt = new THREE.Vector3(), camTarget = new THREE.Vector3();
  function updateCamera(dt) {
    const size = me ? me.size : 1;
    const f = forwardVec(input.yaw, input.pitch * 0.85);
    const dist = 2.2 + size * 1.25;
    const center = alive ? local.pos : camPos;
    camTarget.set(center.x - f[0] * dist, center.y - f[1] * dist + size * 0.5 + 0.5, center.z - f[2] * dist);
    const fl = floorHeight(camTarget.x, camTarget.z) + 0.8;
    if (camTarget.y < fl) camTarget.y = fl;
    if (camTarget.y > -0.4) camTarget.y = -0.4;
    if (alive) camPos.lerp(camTarget, 1 - Math.exp(-dt * 12));
    else { camPos.x += Math.sin(clock * 0.05) * dt * 3; }
    camera.position.copy(camPos);
    lookAt.set(center.x + f[0] * size * 1.5, center.y + f[1] * size * 1.5 + size * 0.2, center.z + f[2] * size * 1.5);
    if (alive) camera.lookAt(lookAt);
    else camera.lookAt(camPos.x + 10, camPos.y - 2, camPos.z + 30);
    camera.far = 300 + size * 4 + (me ? Math.max(0, -local.pos.y) : 0);
    camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- aiming: highlight food you look at, red crosshair when a bite would land
  const aimDir = new THREE.Vector3(), toV = new THREE.Vector3();
  function aimAssist() {
    if (!alive || !me) { food.highlight(null); $('crosshair').classList.remove('target'); return; }
    camera.getWorldDirection(aimDir);
    // food: smallest angle from the view direction, within swimming range
    const maxD = 25 + me.size * 4 + local.pos.distanceTo(camera.position);
    let best = null, bestScore = 0;
    for (const it of food.items.values()) {
      toV.set(it.x - camera.position.x, it.y - camera.position.y, it.z - camera.position.z);
      const d = toV.length();
      if (d > maxD || d < 0.5) continue;
      const ang = Math.acos(Math.min(1, toV.dot(aimDir) / d));
      // how far off the crosshair still counts: wider for close food, a few degrees for far food
      const tol = Math.min(0.25, Math.max(0.05, (1.5 + me.size * 0.15) / d));
      if (ang > tol) continue;
      const score = 1 - ang / tol;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    food.highlight(best);
    // creatures in bite range (same rule as the server)
    const f = forwardVec(input.yaw, input.pitch);
    let inRange = false;
    for (const e of ents.values()) {
      const reach = me.size * 0.7 + e.size * 0.5 + 1.2;
      toV.set(e.pos.x - local.pos.x, e.pos.y - local.pos.y, e.pos.z - local.pos.z);
      const d = toV.length();
      if (d > reach) continue;
      const c = d < 0.01 ? 1 : (toV.x * f[0] + toV.y * f[1] + toV.z * f[2]) / d;
      if (c > 0.34 || d < e.size * 0.5 + me.size * 0.3) { inRange = true; break; }
    }
    $('crosshair').classList.toggle('target', inRange);
  }

  // ---------------------------------------------------------------- labels
  const proj = new THREE.Vector3();
  function updateLabels() {
    const items = [];
    if (alive && me) {
      for (const e of ents.values()) {
        if (e.flags & 4) continue;
        const d = e.pos.distanceTo(local.pos);
        const recent = clock - e.lastHit < 4;
        if (!(e.name && d < 90) && !(recent && d < 60) && !(d < 10 + me.size * 3)) continue;
        proj.copy(e.pos); proj.y += e.size * 0.45 + 0.4;
        proj.project(camera);
        if (proj.z > 1 || Math.abs(proj.x) > 1.1 || Math.abs(proj.y) > 1.1) continue;
        const ratio = e.size / me.size;
        const cls = ratio > 1.2 ? 'threat' : ratio < 0.3 ? 'prey' : ratio < 0.85 ? 'prey' : 'even';
        const label = `${e.name ? e.name + ' · ' : ''}${SPECIES[e.sp].name} ${e.level}${ratio < 0.3 ? ' (swallow)' : ''}`;
        items.push({ x: (proj.x + 1) / 2 * window.innerWidth, y: (1 - proj.y) / 2 * window.innerHeight, text: label, cls, hp: e.hp });
        if (items.length > 24) break;
      }
    }
    hud.labels(items);
  }

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    if (conn) controlMe(dt);
    updateEnts(dt);
    updateCamera(dt);
    const inInk = !!(me && me.ink);
    world.update(dt, camera.position, inInk ? 0.3 : 0, alive ? local.pos : null, me ? me.size : 1);
    hud.ink(inInk && alive);
    fx.update(dt);
    food.update(dt, camera.position);
    aimAssist();
    if (alive && me) {
      hud.update(me, -local.pos.y, cds);
      audio.setDepth(-local.pos.y);
    }
    updateLabels();
    renderer.render(scene, camera);
    window.__stats = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  }
  requestAnimationFrame(frame);

  $('play').disabled = true;
  connectOnline();
  // test hook
  window.__fih = { get me() { return me; }, get alive() { return alive; }, get ents() { return ents.size; }, get players() { return [...ents.values()].filter((e) => e.name).map((e) => e.name); }, local, input, get conn() { return conn; }, get myId() { return myId; }, get hl() { return food.glow.visible ? food.hl : null; }, food, get mine() { return mine; } };
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------------ model gallery (for checking art): /?gallery or /?gallery=megalodon
function gallery() {
  $('menu').classList.add('hidden');
  
  const only = params.get('gallery');
  const list = only ? SPECIES.filter((s) => s.id === only) : SPECIES;
  const cols = Math.ceil(Math.sqrt(list.length * 1.6));
  const items = list.map((s, i) => {
    const c = new Creature(s.index);
    const x = (i % cols - (cols - 1) / 2) * 6, y = -40 - Math.floor(i / cols) * 4.2;
    c.root.position.set(x, y, 0);
    c.root.scale.setScalar(only ? 8 : 4.5);
    c.root.rotation.y = params.has('side') ? Math.PI / 2 : Math.PI / 2 + 0.5;
    scene.add(c.root);
    const lab = document.createElement('div');
    lab.className = 'label even';
    lab.textContent = s.name;
    $('labels').appendChild(lab);
    return { c, lab };
  });
  const rows = Math.ceil(list.length / cols);
  const cy = -40 - (rows - 1) * 2.1;
  camera.position.set(0, cy + (only ? 2.5 : 3), -(only ? 10 : Math.max(16, cols * 4)));
  camera.lookAt(0, cy, 0);
  world.update(0.016, camera.position);
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    world.update(dt, camera.position);
    scene.fog.density = 0.006;
    world.hemi.intensity = 1.6; world.sun.intensity = 1.6;
    for (const it of items) {
      it.c.update(dt, 0.4, 0);
      const p = it.c.root.position.clone(); p.y -= 1.6;
      p.project(camera);
      it.lab.style.left = `${(p.x + 1) / 2 * window.innerWidth}px`;
      it.lab.style.top = `${(1 - p.y) / 2 * window.innerHeight + 30}px`;
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
  window.__galleryReady = true;
}

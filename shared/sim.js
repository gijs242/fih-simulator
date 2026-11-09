// Authoritative game simulation. Runs on the Node server, and in the browser for offline solo play.
// Players own their movement (validated here); everything else (combat, XP, bots, food) is decided here.

import { WORLD, floorHeight, forwardVec, clampToWorld, randomPointInZone, zoneForDepth } from './world.js';

const AMBIENT_PER_PLAYER = 14;
import { SPECIES, SPECIES_INDEX, EVOLVE_LEVELS, MAX_LEVEL, xpNeeded, stats as baseStats, xpValue, BOT_TABLE, PLAYER_DAMAGE, PLAYER_SPEED } from './species.js';

// players get a damage and speed bonus over bots
function stats(spIndex, level, isPlayer = false) {
  const st = baseStats(spIndex, level);
  if (isPlayer) { st.bite *= PLAYER_DAMAGE; st.speed *= PLAYER_SPEED; }
  return st;
}

const FOOD_TARGET = { shallow: 480, mid: 190, deep: 90 };
const FOOD_REFILL = { shallow: 8, mid: 3, deep: 2 };
const CELL = 12;
const cellKey = (cx, cz) => (cx + 1000) * 4096 + (cz + 1000);
const FOOD_XP = { shallow: 1, mid: 2, deep: 3 };
const MEAT_LIFETIME = 45;

// status flag bits sent to clients
export const FLAG = { spikes: 1, shell: 2, stealth: 4, lunge: 8, poison: 16, player: 32, stun: 64, ink: 128 };

function dist2(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

function cleanName(n) {
  n = Array.from(String(n || '')).filter(ch => {
    const c = ch.codePointAt(0);
    return c >= 32 && !(c >= 0x7f && c <= 0x9f) && !(c >= 0x200b && c <= 0x200f) && !(c >= 0x2028 && c <= 0x202e) && !(c >= 0x2066 && c <= 0x2069) && ch !== '<' && ch !== '>';
  }).join('').trim();
  if (!n) n = 'fih';
  return n.slice(0, 16);
}

export class Sim {
  constructor(opts = {}) {
    this.time = 0;
    this.nextId = 1;
    this.entities = new Map();   // id -> entity (players + bots)
    this.players = new Map();    // clientId -> { id, clientId, name, send, entity, ... }
    this.food = new Map();       // id -> food
    this.grid = new Map();       // cell -> Set(food), for fast proximity lookups
    this.plankton = { shallow: 0, mid: 0, deep: 0 };
    this.meat = new Set();
    this.upkeepTimer = 0;
    this.foodAdded = [];
    this.foodRemoved = [];
    this.clouds = [];            // ink clouds
    this.events = [];            // broadcast events this tick (positional)
    this.alltime = opts.alltime || [];
    this.onAlltimeChange = opts.onAlltimeChange || (() => {});
    this.lbTimer = 0;
    this.botRespawns = [];
    this.botSlots = [];
    for (const zone of Object.keys(BOT_TABLE)) {
      for (const [sp, count, lo, hi] of BOT_TABLE[zone]) {
        for (let i = 0; i < count; i++) this.botSlots.push({ zone, sp, lo, hi });
      }
    }
    for (const slot of this.botSlots) this.spawnBot(slot);
    for (const z of Object.keys(FOOD_TARGET)) {
      for (let i = 0; i < FOOD_TARGET[z]; i++) this.spawnPlankton(z);
    }
    this.foodAdded.length = 0; // initial food is sent on welcome
  }

  // ---------------------------------------------------------------- entities
  makeEntity(spIndex, level, pos, isPlayer) {
    const st = stats(spIndex, level, isPlayer);
    const e = {
      id: this.nextId++, sp: spIndex, level, isPlayer,
      pos, vel: [0, 0, 0], yaw: Math.random() * Math.PI * 2, pitch: 0,
      hp: st.maxHp, st, alive: true,
      biteReady: 0, a2Ready: 0,
      fx: {}, lastHurt: -99, lastAttacker: null,
    };
    this.entities.set(e.id, e);
    return e;
  }

  refreshStats(e) {
    const ratio = e.hp / e.st.maxHp;
    e.st = stats(e.sp, e.level, e.isPlayer);
    e.hp = Math.min(e.st.maxHp, Math.max(1, ratio * e.st.maxHp));
  }

  spawnBot(slot) {
    const id = Array.isArray(slot.sp) ? slot.sp[Math.floor(Math.random() * slot.sp.length)] : slot.sp;
    const sp = SPECIES_INDEX[id];
    const level = slot.lo + Math.floor(Math.random() * (slot.hi - slot.lo + 1));
    const pos = randomPointInZone(slot.zone);
    const e = this.makeEntity(sp, level, pos, false);
    e.bot = { slot, zone: slot.zone, mode: 'wander', target: null, wp: randomPointInZone(slot.zone), think: 0, hunger: Math.random(), chaseTime: 0 };
    clampToWorld(e.pos, e.st.size * 0.3);
    return e;
  }

  spawnPlankton(zone) {
    const p = randomPointInZone(zone);
    const f = { id: this.nextId++, type: 0, pos: p, xp: FOOD_XP[zone], zone, born: this.time };
    this.addFood(f);
    this.plankton[zone]++;
  }

  spawnMeat(pos, xp) {
    const p = [pos[0] + (Math.random() - 0.5) * 2, pos[1] + (Math.random() - 0.5) * 2, pos[2] + (Math.random() - 0.5) * 2];
    clampToWorld(p, 0.3);
    const f = { id: this.nextId++, type: 1, pos: p, xp, born: this.time };
    this.addFood(f);
    this.meat.add(f);
  }

  addFood(f) {
    this.food.set(f.id, f);
    this.foodAdded.push(f);
    f.cell = cellKey(Math.floor(f.pos[0] / CELL), Math.floor(f.pos[2] / CELL));
    let set = this.grid.get(f.cell);
    if (!set) { set = new Set(); this.grid.set(f.cell, set); }
    set.add(f);
  }

  removeFood(f) {
    if (!this.food.delete(f.id)) return;
    this.foodRemoved.push(f.id);
    const set = this.grid.get(f.cell);
    if (set) set.delete(f);
    if (f.type === 0) this.plankton[f.zone]--;
    else this.meat.delete(f);
  }

  // calls fn(food, distSquared) for food within r of pos; stops early if fn returns true
  foodNear(pos, r, fn) {
    const r2 = r * r;
    const x0 = Math.floor((pos[0] - r) / CELL), x1 = Math.floor((pos[0] + r) / CELL);
    const z0 = Math.floor((pos[2] - r) / CELL), z1 = Math.floor((pos[2] + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const set = this.grid.get(cellKey(cx, cz));
        if (!set) continue;
        for (const f of set) {
          const d = dist2(f.pos, pos);
          if (d < r2 && fn(f, d)) return;
        }
      }
    }
  }

  // ---------------------------------------------------------------- players
  addPlayer(clientId, send) {
    const p = { clientId, send, name: 'fih', entity: null, lastIn: 0, score: 0, best: 0, kills: 0, joined: false };
    this.players.set(clientId, p);
    send({
      t: 'welcome',
      food: [...this.food.values()].map(foodTuple),
      alltime: this.alltime,
    });
    return p;
  }

  removePlayer(clientId) {
    const p = this.players.get(clientId);
    if (!p) return;
    if (p.entity && p.entity.alive) {
      this.recordScore(p);
      this.entities.delete(p.entity.id);
      this.events.push({ k: 'gone', id: p.entity.id });
    }
    this.players.delete(clientId);
  }

  spawnPlayer(p) {
    const x = (Math.random() * 2 - 1) * 250, z = -300 + Math.random() * 100;
    const pos = [x, -6 - Math.random() * 8, z];
    clampToWorld(pos, 0.3);
    const e = this.makeEntity(0, 1, pos, true);
    e.player = p;
    e.xp = 0;
    e.choices = null;
    e.yaw = 0;
    e.spawnShield = this.time + 8;
    p.entity = e;
    p.score = 0;
    p.kills = 0;
    p.picked = false;
    p.lastIn = this.time;
    p.send({ t: 'spawn', id: e.id, pos: e.pos, yaw: e.yaw });
  }

  handleMessage(clientId, msg) {
    const p = this.players.get(clientId);
    if (!p || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'join':
        if (p.joined) return;
        p.joined = true;
        p.name = cleanName(msg.name);
        this.spawnPlayer(p);
        break;
      case 'respawn':
        if (p.joined && (!p.entity || !p.entity.alive)) this.spawnPlayer(p);
        break;
      case 'in': this.handleInput(p, msg); break;
      case 'ping': if (Number.isFinite(msg.c)) p.send({ t: 'pong', c: msg.c }); break;
      case 'a': this.handleAttack(p, msg); break;
      case 'evo': this.handleEvolve(p, msg); break;
      case 'pick': this.handlePick(p, msg); break;
    }
  }

  handleInput(p, msg) {
    const e = p.entity;
    if (!e || !e.alive) return;
    const pos = msg.p;
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(Number.isFinite)) return;
    const dt = Math.min(1, Math.max(0.02, this.time - p.lastIn));
    p.lastIn = this.time;
    // allow dash / lunge / knockback bursts, but nothing like teleporting
    const maxStep = e.st.speed * 3.2 * dt + 2;
    const dx = pos[0] - e.pos[0], dy = pos[1] - e.pos[1], dz = pos[2] - e.pos[2];
    const d = Math.hypot(dx, dy, dz);
    let np;
    if (d > maxStep) {
      const k = maxStep / d;
      np = [e.pos[0] + dx * k, e.pos[1] + dy * k, e.pos[2] + dz * k];
      if (d > maxStep * 3) p.send({ t: 'fix', pos: np });
    } else np = [pos[0], pos[1], pos[2]];
    clampToWorld(np, e.st.size * 0.3);
    e.vel = [(np[0] - e.pos[0]) / dt, (np[1] - e.pos[1]) / dt, (np[2] - e.pos[2]) / dt];
    e.pos = np;
    if (Number.isFinite(msg.yaw)) e.yaw = msg.yaw;
    if (Number.isFinite(msg.pitch)) e.pitch = Math.max(-1.5, Math.min(1.5, msg.pitch));
  }

  handleAttack(p, msg) {
    const e = p.entity;
    if (!e || !e.alive) return;
    if (Number.isFinite(msg.yaw)) e.yaw = msg.yaw;
    if (Number.isFinite(msg.pitch)) e.pitch = Math.max(-1.5, Math.min(1.5, msg.pitch));
    // lag compensation: judge this attack against where targets were on the attacker's screen
    e.rewind = Number.isFinite(msg.rw) ? Math.max(0, Math.min(0.5, msg.rw)) : 0;
    if (msg.n === 1) this.bite(e);
    else if (msg.n === 2) this.ability(e);
  }

  // side menu: become any creature (at the start of its tier); these runs are kept off the all-time board
  handlePick(p, msg) {
    const e = p.entity;
    if (!e || !e.alive) return;
    const idx = SPECIES_INDEX[msg.sp];
    if (idx === undefined || SPECIES[idx].ambient) return;
    const sp = SPECIES[idx];
    e.sp = idx;
    e.level = sp.minLevel;
    e.xp = 0;
    e.choices = null;
    e.st = stats(idx, e.level, true);
    e.hp = e.st.maxHp;
    e.a2Ready = 0;
    e.fx = {};
    e.spawnShield = this.time + 3;
    p.picked = true;
    const zone = sp.tier <= 1 ? 'shallow' : sp.tier === 2 ? 'mid' : 'deep';
    if (zoneForDepth(-e.pos[1]).id !== zone) {
      e.pos = clampToWorld(randomPointInZone(zone), e.st.size * 0.3);
      p.send({ t: 'fix', pos: e.pos });
    }
    for (const id of [...p.ambient || []]) this.despawn(id);
    this.events.push({ k: 'evo', id: e.id, pos: e.pos.slice() });
    this.checkEvolution(e);
  }

  despawn(id) {
    const e = this.entities.get(id);
    if (!e) return;
    e.alive = false;
    this.entities.delete(id);
    if (e.bot && e.bot.owner) { const o = this.players.get(e.bot.owner); if (o && o.ambient) o.ambient.delete(id); }
  }

  // keep a few schools of edible, harmless fish around every player
  upkeepAmbient() {
    for (const e of [...this.entities.values()]) {
      if (!e.bot || !e.bot.owner) continue;
      const o = this.players.get(e.bot.owner);
      const me = o && o.entity && o.entity.alive ? o.entity : null;
      if (!me || dist2(me.pos, e.pos) > (150 + me.st.size * 4) ** 2) this.despawn(e.id);
    }
    for (const p of this.players.values()) {
      const me = p.entity && p.entity.alive ? p.entity : null;
      if (!me) continue;
      p.ambient = p.ambient || new Set();
      for (const id of p.ambient) if (!this.entities.has(id)) p.ambient.delete(id);
      // half as many prey schools in the abyss
      const target = zoneForDepth(-me.pos[1]).id === 'deep' ? AMBIENT_PER_PLAYER / 2 : AMBIENT_PER_PLAYER;
      if (p.ambient.size >= target) continue;
      // prey sized to be worth eating: the biggest few creatures well under your size
      const cands = SPECIES.filter((s) => stats(s.index, s.minLevel).size <= me.st.size * 0.8).sort((a, b) => b.size - a.size).slice(0, 4);
      const sp = cands.length ? cands[Math.floor(Math.random() * cands.length)] : SPECIES[SPECIES_INDEX.krill];
      const count = 3 + Math.floor(Math.random() * 3);
      const ang = Math.random() * Math.PI * 2, dist = 40 + me.st.size * 2.5 + Math.random() * 30;
      const home = clampToWorld([me.pos[0] + Math.sin(ang) * dist, me.pos[1] + (Math.random() - 0.5) * 12, me.pos[2] + Math.cos(ang) * dist], 1);
      for (let i = 0; i < count && p.ambient.size < target; i++) {
        const pos = clampToWorld([home[0] + (Math.random() - 0.5) * 6, home[1] + (Math.random() - 0.5) * 3, home[2] + (Math.random() - 0.5) * 6], 1);
        const level = sp.minLevel + Math.floor(Math.random() * 2);
        const b = this.makeEntity(sp.index, level, pos, false);
        b.bot = { passive: true, owner: p.clientId, home, zone: zoneForDepth(-pos[1]).id, mode: 'wander', target: null, wp: home, think: Math.random() * 0.5, hunger: 0, chaseTime: 0 };
        p.ambient.add(b.id);
      }
    }
  }

  handleEvolve(p, msg) {
    const e = p.entity;
    if (!e || !e.alive || !e.choices) return;
    if (!e.choices.includes(msg.sp)) return;
    e.sp = SPECIES_INDEX[msg.sp];
    e.choices = null;
    this.refreshStats(e);
    e.hp = e.st.maxHp;
    e.a2Ready = 0;
    this.events.push({ k: 'evo', id: e.id, pos: e.pos.slice() });
    this.checkEvolution(e);
  }

  // ---------------------------------------------------------------- combat
  stunned(e) { return e.fx.stun && e.fx.stun > this.time; }

  // where an entity was `ago` seconds in the past (from its recent position history)
  posAt(o, ago) {
    const h = o.hist;
    if (!ago || !h || !h.length) return o.pos;
    const t = this.time - ago;
    for (let i = h.length - 1; i > 0; i--) {
      const b = h[i], a = h[i - 1];
      if (a.t <= t) {
        const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
        return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k];
      }
    }
    const f = h[0];
    return [f.x, f.y, f.z];
  }

  findTargets(e, reachMul, coneDeg, multi) {
    const fwd = forwardVec(e.yaw, e.pitch);
    const rw = e.isPlayer ? e.rewind || 0 : 0;
    const cosLim = Math.cos(coneDeg * Math.PI / 180);
    const hits = [];
    for (const o of this.entities.values()) {
      if (o === e || !o.alive) continue;
      const reach = (e.st.size * 0.7 + o.st.size * 0.5 + 1.2) * reachMul;
      const op = rw ? this.posAt(o, rw) : o.pos;
      const dx = op[0] - e.pos[0], dy = op[1] - e.pos[1], dz = op[2] - e.pos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > reach) continue;
      const c = d < 0.01 ? 1 : (dx * fwd[0] + dy * fwd[1] + dz * fwd[2]) / d;
      // things right on top of you count even if slightly off-angle
      if (c < cosLim && d > o.st.size * 0.5 + e.st.size * 0.3) continue;
      hits.push({ o, d });
    }
    hits.sort((a, b) => a.d - b.d);
    return multi ? hits.map(h => h.o) : hits.slice(0, 1).map(h => h.o);
  }

  bite(e, mul = 1, reachMul = 1, opts = {}) {
    if (!opts.free) {
      if (this.time < e.biteReady || this.stunned(e)) return false;
      if (e.fx.shell > this.time) return false;
      e.biteReady = this.time + e.st.biteCd;
      this.events.push({ k: 'bite', id: e.id, pos: e.pos.slice() });
    }
    const targets = this.findTargets(e, reachMul, opts.cone || 70, !!opts.multi);
    if (!targets.length) return false;
    let m = mul;
    if (e.fx.stealth > this.time) { m *= 2.5; e.fx.stealth = 0; }
    for (const t of targets) {
      // tiny prey gets swallowed whole
      if (t.st.size < e.st.size * 0.3 && !opts.multi) {
        this.kill(t, e, true);
        continue;
      }
      this.damage(t, e.st.bite * m, e);
      if (opts.poison) this.poison(t, opts.poison.dps, opts.poison.dur, e);
      else if (SPECIES[e.sp].venomous) this.poison(t, e.st.bite * 0.3, 4, e);
      if (opts.knock && t.alive) this.knock(t, e, opts.knock, opts.stun || 0);
    }
    return true;
  }

  damage(t, amount, by) {
    if (!t.alive) return;
    if (t.spawnShield && t.spawnShield > this.time) return;
    let dmg = amount * (1 - t.st.armor);
    if (t.fx.spikes > this.time) {
      dmg *= 0.4;
      if (by && by.alive && by !== t) this.damage(by, amount * 0.3, null);
    }
    if (t.fx.shell > this.time) dmg *= 0.2;
    t.hp -= dmg;
    t.lastHurt = this.time;
    if (by) t.lastAttacker = by.id;
    this.events.push({ k: 'hit', id: t.id, by: by ? by.id : 0, d: Math.round(dmg), pos: t.pos.slice(), s: r2(t.st.size) });
    if (t.bot && t.bot.passive && by && by.alive) { t.bot.mode = 'flee'; t.bot.target = by.id; }
    else if (t.bot && by && by.alive) {
      // fight back or flee
      if (by.st.size < t.st.size * 1.3) { t.bot.mode = 'chase'; t.bot.target = by.id; t.bot.chaseTime = 0; }
      else { t.bot.mode = 'flee'; t.bot.target = by.id; }
    }
    if (t.hp <= 0) this.kill(t, by, false);
  }

  poison(t, dps, dur, by) {
    if (!t.alive) return;
    t.fx.poison = { until: this.time + dur, dps, by: by ? by.id : null };
  }

  knock(t, by, strength, stun) {
    const dir = [t.pos[0] - by.pos[0], t.pos[1] - by.pos[1], t.pos[2] - by.pos[2]];
    const l = Math.hypot(...dir) || 1;
    const sizeRatio = strength < 0 ? 1 : Math.min(2.5, Math.max(0.3, by.st.size / t.st.size));
    const v = dir.map(c => c / l * strength * sizeRatio);
    if (stun) t.fx.stun = this.time + stun;
    if (t.isPlayer) t.player.send({ t: 'kb', v, stun });
    else { t.vel = v; }
  }

  ability(e) {
    if (this.time < e.a2Ready || this.stunned(e)) return;
    const sp = SPECIES[e.sp];
    const a = sp.a2;
    e.a2Ready = this.time + a.cd;
    this.events.push({ k: 'a2', id: e.id, type: a.type, pos: e.pos.slice() });
    const fwd = forwardVec(e.yaw, e.pitch);
    switch (a.type) {
      case 'snap':
        if (!e.isPlayer) e.vel = fwd.map(c => -c * e.st.speed * 3);
        break;
      case 'lunge':
        e.fx.lunge = this.time + 0.5; e.fx.lungeMul = a.mul || 1.8; e.fx.lungeKnock = 0; e.fx.lungeHit = false;
        if (!e.isPlayer) e.vel = fwd.map(c => c * e.st.speed * 2.4);
        break;
      case 'ram':
        e.fx.lunge = this.time + 0.55; e.fx.lungeMul = 1.2; e.fx.lungeKnock = 14; e.fx.lungeHit = false;
        if (!e.isPlayer) e.vel = fwd.map(c => c * e.st.speed * 2.4);
        break;
      case 'spikes':
        e.fx.spikes = this.time + 2.5;
        break;
      case 'shell':
        e.fx.shell = this.time + 3;
        break;
      case 'venom':
        this.bite(e, 0.6, 1.7, { free: true, poison: { dps: e.st.bite * 0.5, dur: 5 } });
        break;
      case 'ambush':
        e.fx.stealth = this.time + 5;
        break;
      case 'slash':
        this.bite(e, 1.3, 1.45, { free: true, multi: true, cone: 65, poison: { dps: e.st.bite * 0.3, dur: 3 } });
        break;
      case 'ink': {
        const c = { pos: e.pos.slice(), r: 10 + e.st.size, until: this.time + 6, owner: e.id };
        this.clouds.push(c);
        this.events.push({ k: 'ink', pos: c.pos, r: c.r, dur: 6 });
        if (!e.isPlayer) e.vel = fwd.map(v => v * e.st.speed * 2.2);
        break;
      }
      case 'grab':
        // pull toward us (negative knockback) and stun
        this.bite(e, 1.0, 1.9, { free: true, knock: -7, stun: 1.2 });
        break;
      case 'sonar':
        this.bite(e, 0.5, 3.2, { free: true, multi: true, cone: 35, knock: 10, stun: 1.6 });
        break;
      case 'pulse': {
        const R = e.st.size * 2.4 + 3;
        for (const o of this.entities.values()) {
          if (o === e || !o.alive) continue;
          if (dist2(o.pos, e.pos) < R * R) { this.damage(o, e.st.bite * 0.4, e); this.poison(o, e.st.bite * 0.5, 4, e); }
        }
        break;
      }
    }
  }

  kill(t, by, swallowed) {
    if (!t.alive) return;
    t.alive = false;
    this.entities.delete(t.id);
    const value = xpValue(t.st.size);
    if (swallowed && by) {
      this.giveXp(by, value);
    } else {
      if (by && by.alive) this.giveXp(by, Math.round(value * 0.35));
      const chunks = Math.max(1, Math.min(8, Math.round(t.st.size * 1.6)));
      const per = Math.max(1, Math.round(value * 0.65 / chunks));
      for (let i = 0; i < chunks; i++) this.spawnMeat(t.pos, per);
    }
    if (by && by.isPlayer) by.player.kills++;
    this.events.push({ k: 'die', id: t.id, by: by ? by.id : 0, pos: t.pos.slice(), s: r2(t.st.size), sw: swallowed ? 1 : 0 });
    if (t.isPlayer) {
      const p = t.player;
      this.recordScore(p);
      const killer = by ? {
        name: by.isPlayer ? by.player.name : null,
        species: SPECIES[by.sp].name, level: by.level,
      } : null;
      p.send({ t: 'dead', score: p.score, level: t.level, species: SPECIES[t.sp].name, kills: p.kills, killer });
      if (by && by.isPlayer) by.player.send({ t: 'feed', msg: `You ate ${p.name}` });
    } else if (t.bot && t.bot.slot) {
      this.botRespawns.push({ at: this.time + 4 + Math.random() * 8, slot: t.bot.slot });
    }
  }

  giveXp(e, amount) {
    if (!e.alive) return;
    if (e.isPlayer) {
      e.player.score += amount;
      if (e.level >= MAX_LEVEL) return;
      e.xp += amount;
      let leveled = false;
      while (e.level < MAX_LEVEL && e.xp >= xpNeeded(e.level)) {
        e.xp -= xpNeeded(e.level);
        e.level++;
        leveled = true;
      }
      if (e.level >= MAX_LEVEL) e.xp = 0;
      if (leveled) {
        const before = e.st.maxHp;
        this.refreshStats(e);
        e.hp = Math.min(e.st.maxHp, e.hp + (e.st.maxHp - before) + e.st.maxHp * 0.25);
        this.events.push({ k: 'lvl', id: e.id, pos: e.pos.slice() });
        this.checkEvolution(e);
      }
    } else {
      // bots heal when they feed
      e.hp = Math.min(e.st.maxHp, e.hp + amount * 3);
    }
  }

  checkEvolution(e) {
    if (e.choices) return;
    const sp = SPECIES[e.sp];
    if (!sp.next.length) return;
    const need = EVOLVE_LEVELS[sp.tier + 1];
    if (e.level >= need) e.choices = sp.next.slice();
  }

  recordScore(p) {
    if (!p.entity) return;
    const e = p.entity;
    const entry = { name: p.name, score: p.score, species: SPECIES[e.sp].name, level: e.level, at: Date.now() };
    if (entry.score <= 0 || p.picked) return;
    const list = this.alltime.slice();
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const top = list.slice(0, 20);
    if (top.includes(entry)) {
      this.alltime = top;
      this.onAlltimeChange(this.alltime);
      for (const q of this.players.values()) q.send({ t: 'alltime', list: this.alltime });
    }
  }

  // ---------------------------------------------------------------- bots
  botThink(e) {
    const b = e.bot;
    const per = 22 + e.st.size * 5;
    let threat = null, threatD = Infinity, prey = null, preyD = Infinity;
    const inInk = this.inInk(e.pos);
    if (!inInk) {
      for (const o of this.entities.values()) {
        if (o === e || !o.alive) continue;
        if (o.fx.stealth > this.time) continue;
        if (o.spawnShield && o.spawnShield > this.time) continue;
        const d = Math.sqrt(dist2(o.pos, e.pos));
        if (d > per) continue;
        if (this.inInk(o.pos)) continue;
        if (o.st.size > e.st.size * 1.25 && d < threatD) { threat = o; threatD = d; }
        else if (o.st.size < e.st.size * 0.85 && o.st.size > e.st.size * 0.12 && d < preyD) {
          // players are slightly juicier
          const dd = o.isPlayer ? d * 0.8 : d;
          if (dd < preyD) { prey = o; preyD = dd; }
        }
      }
    }
    if (threat && threatD < per * 0.75 && SPECIES[e.sp].tier < 3) {
      b.mode = 'flee'; b.target = threat.id;
      if (Math.random() < 0.3) this.ability(e);
      return;
    }
    if (b.mode === 'chase' && this.entities.has(b.target) && b.chaseTime < 7) return;
    b.hunger = Math.min(1, b.hunger + 0.05);
    if (prey && b.hunger > 0.45 && !b.passive) { b.mode = 'chase'; b.target = prey.id; b.chaseTime = 0; return; }
    // look for food nearby
    let food = null, foodD = Infinity;
    if (e.st.size < 4) {
      this.foodNear(e.pos, 8 + e.st.size * 4, (f, d) => { if (d < foodD) { food = f; foodD = d; } });
    }
    if (food) { b.mode = 'food'; b.target = food.id; return; }
    b.mode = 'wander'; b.target = null;
    if (dist2(e.pos, b.wp) < 25 || Math.random() < 0.05) {
      if (b.home) b.wp = clampToWorld([b.home[0] + (Math.random() - 0.5) * 40, b.home[1] + (Math.random() - 0.5) * 10, b.home[2] + (Math.random() - 0.5) * 40], e.st.size * 0.3);
      else b.wp = randomPointInZone(b.zone);
    }
  }

  updateBot(e, dt) {
    const b = e.bot;
    b.think -= dt;
    if (b.think <= 0) { b.think = 0.35 + Math.random() * 0.3; this.botThink(e); }
    let goal = null, speedK = 0.45;
    if (b.mode === 'flee') {
      const t = this.entities.get(b.target);
      if (!t || dist2(t.pos, e.pos) > (40 + t.st.size * 4) ** 2) { b.mode = 'wander'; }
      else {
        const away = [e.pos[0] - t.pos[0], e.pos[1] - t.pos[1], e.pos[2] - t.pos[2]];
        const l = Math.hypot(...away) || 1;
        goal = [e.pos[0] + away[0] / l * 20, e.pos[1] + away[1] / l * 8, e.pos[2] + away[2] / l * 20];
        speedK = 0.95;
      }
    } else if (b.mode === 'chase') {
      const t = this.entities.get(b.target);
      b.chaseTime += dt;
      if (!t || !t.alive || b.chaseTime > 7 || (t.fx.stealth > this.time)) { b.mode = 'wander'; b.hunger = 0; }
      else {
        goal = t.pos; speedK = 0.88;
        const d = Math.sqrt(dist2(t.pos, e.pos));
        if (d < e.st.size * 0.7 + t.st.size * 0.5 + 1.2) {
          if (this.bite(e)) { if (!t.alive) b.hunger = 0; }
        } else if (d < e.st.size * 3 + 6 && Math.random() < dt * 0.6) this.ability(e);
      }
    } else if (b.mode === 'food') {
      const f = this.food.get(b.target);
      if (!f) b.mode = 'wander'; else { goal = f.pos; speedK = 0.6; }
    }
    if (!goal) goal = b.wp;
    // keep in zone depth band
    const stunned = this.stunned(e);
    const dir = [goal[0] - e.pos[0], goal[1] - e.pos[1], goal[2] - e.pos[2]];
    const l = Math.hypot(...dir) || 1;
    const sp = stunned ? 0 : e.st.speed * speedK;
    const desired = dir.map(c => c / l * sp);
    const k = Math.min(1, dt * (stunned ? 1.5 : 2.5));
    for (let i = 0; i < 3; i++) e.vel[i] += (desired[i] - e.vel[i]) * k;
    // avoid floor
    const fl = floorHeight(e.pos[0], e.pos[2]);
    if (e.pos[1] - fl < e.st.size + 2) e.vel[1] += dt * 8;
    for (let i = 0; i < 3; i++) e.pos[i] += e.vel[i] * dt;
    clampToWorld(e.pos, e.st.size * 0.3);
    const hv = Math.hypot(e.vel[0], e.vel[2]);
    if (hv > 0.3) {
      const targetYaw = Math.atan2(e.vel[0], e.vel[2]);
      let dy = targetYaw - e.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      e.yaw += dy * Math.min(1, dt * 5);
      const targetPitch = Math.atan2(e.vel[1], hv) * 0.8;
      e.pitch += (targetPitch - e.pitch) * Math.min(1, dt * 4);
    }
  }

  inInk(pos) {
    for (const c of this.clouds) if (dist2(pos, c.pos) < c.r * c.r) return true;
    return false;
  }

  // ---------------------------------------------------------------- tick
  tick(dt, send = true) {
    this.time += dt;
    this.lbTimer -= dt;
    const now = this.time;

    for (const e of this.entities.values()) {
      if (!e.alive) continue;
      if (e.bot) this.updateBot(e, dt);
      // ~1s of position history for lag-compensated hits
      if (!e.hist) e.hist = [];
      e.hist.push({ t: now, x: e.pos[0], y: e.pos[1], z: e.pos[2] });
      if (e.hist.length > 22) e.hist.shift();
      // lunge / ram contact
      if (e.fx.lunge > now && !e.fx.lungeHit) {
        if (this.bite(e, e.fx.lungeMul, 1.15, { free: true, knock: e.fx.lungeKnock, stun: e.fx.lungeKnock ? 1.0 : 0 })) {
          e.fx.lungeHit = true;
          this.events.push({ k: 'bite', id: e.id, pos: e.pos.slice() });
        }
      }
      // poison
      const po = e.fx.poison;
      if (po) {
        if (po.until < now) e.fx.poison = null;
        else {
          e.hp -= po.dps * dt * (1 - e.st.armor * 0.5);
          e.lastHurt = now;
          if (e.hp <= 0) { this.kill(e, this.entities.get(po.by) || null, false); continue; }
        }
      }
      // puffer spikes aura
      if (e.fx.spikes > now) {
        for (const o of this.entities.values()) {
          if (o === e || !o.alive) continue;
          const R = e.st.size * 1.4 + o.st.size * 0.4;
          if (dist2(o.pos, e.pos) < R * R) {
            o.hp -= e.st.bite * 0.9 * dt;
            o.lastHurt = now;
            if (o.hp <= 0) this.kill(o, e, false);
          }
        }
      }
      // regen
      const regen = e.fx.shell > now ? 0.06 : (now - e.lastHurt > 5 ? 0.02 : 0);
      if (regen) e.hp = Math.min(e.st.maxHp, e.hp + e.st.maxHp * regen * dt);
      // eating food
      const mouth = e.st.size * 0.5 + 0.7;
      const fwd = forwardVec(e.yaw, e.pitch);
      const mp = [e.pos[0] + fwd[0] * e.st.size * 0.4, e.pos[1] + fwd[1] * e.st.size * 0.4, e.pos[2] + fwd[2] * e.st.size * 0.4];
      const eaten = [];
      this.foodNear(mp, mouth, (f) => { eaten.push(f); });
      for (const f of eaten) {
        this.removeFood(f);
        this.giveXp(e, f.xp);
        if (e.isPlayer) e.player.send({ t: 'ate', type: f.type, xp: f.xp });
        if (!e.alive) break;
      }
    }

    // world upkeep
    this.clouds = this.clouds.filter(c => c.until > now);
    this.upkeepTimer -= dt;
    if (this.upkeepTimer <= 0) {
      this.upkeepTimer = 1;
      this.upkeepAmbient();
      for (const f of [...this.meat]) if (now - f.born > MEAT_LIFETIME) this.removeFood(f);
    }
    for (const z of Object.keys(this.plankton)) {
      const missing = FOOD_TARGET[z] - this.plankton[z];
      // trickle back in
      for (let i = 0; i < Math.min(missing, FOOD_REFILL[z]); i++) this.spawnPlankton(z);
    }
    this.botRespawns = this.botRespawns.filter(r => {
      if (r.at > now) return true;
      this.spawnBot(r.slot);
      return false;
    });

    if (send) this.broadcast();
  }

  broadcast() {
    const now = this.time;
    const fa = this.foodAdded.map(foodTuple);
    const fr = this.foodRemoved;
    let lb = null;
    if (this.lbTimer <= 0) {
      this.lbTimer = 1;
      lb = [...this.players.values()]
        .filter(p => p.entity && p.entity.alive)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(p => [p.name, p.score, SPECIES[p.entity.sp].id, p.entity.level, p.entity.id]);
    }
    const all = [...this.entities.values()];
    const VR2 = WORLD.viewRadius * WORLD.viewRadius;
    for (const p of this.players.values()) {
      if (!p.joined) continue;
      const me = p.entity && p.entity.alive ? p.entity : null;
      const center = me ? me.pos : (p.lastPos || [0, -20, -250]);
      if (me) p.lastPos = me.pos.slice();
      const ents = [];
      for (const e of all) {
        if (e !== me && dist2(e.pos, center) > VR2) continue;
        let flags = 0;
        if (e.fx.spikes > now) flags |= FLAG.spikes;
        if (e.fx.shell > now) flags |= FLAG.shell;
        if (e.fx.stealth > now) flags |= FLAG.stealth;
        if (e.fx.lunge > now) flags |= FLAG.lunge;
        if (e.fx.poison) flags |= FLAG.poison;
        if (e.isPlayer) flags |= FLAG.player;
        if (e.fx.stun > now) flags |= FLAG.stun;
        const row = [e.id, e.sp, e.level, r2(e.pos[0]), r2(e.pos[1]), r2(e.pos[2]), r3(e.yaw), r3(e.pitch), Math.max(0, Math.round(e.hp / e.st.maxHp * 100)), flags];
        if (e.isPlayer) row.push(e.player.name);
        ents.push(row);
      }
      const evs = this.events.filter(ev => !ev.pos || dist2(ev.pos, center) < VR2);
      const msg = { t: 's', time: r2(now), e: ents };
      if (fa.length) msg.fa = fa;
      if (fr.length) msg.fr = fr;
      if (evs.length) msg.ev = evs;
      if (lb) msg.lb = lb;
      if (me) {
        msg.me = {
          id: me.id, hp: Math.round(me.hp), maxHp: me.st.maxHp, xp: me.xp, xpNext: me.level >= MAX_LEVEL ? 0 : xpNeeded(me.level),
          level: me.level, sp: me.sp, score: p.score, size: r3(me.st.size), speed: r2(me.st.speed),
          bcd: r2(Math.max(0, me.biteReady - now)), acd: r2(Math.max(0, me.a2Ready - now)),
          choices: me.choices, stun: me.fx.stun > now ? 1 : 0, ink: this.inInk(me.pos) ? 1 : 0,
        };
      }
      p.send(msg);
    }
    this.foodAdded = [];
    this.foodRemoved = [];
    this.events = [];
  }
}

function foodTuple(f) {
  return [f.id, f.type, r2(f.pos[0]), r2(f.pos[1]), r2(f.pos[2])];
}

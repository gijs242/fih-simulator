// World geometry shared by server, offline sim and client renderer.
// Coordinates: y is up, the sea surface is y = 0, the seafloor is negative.
// North (negative z) is the shallow reef; south (positive z) drops into the abyss.

export const WORLD = {
  half: 350,          // world spans -half..half on x and z
  surface: 0,
  tickRate: 20,
  viewRadius: 170,    // entities farther than this are not sent to a client
};

export const ZONES = [
  { id: 'shallow', name: 'Sunlit Shallows', minDepth: 0, maxDepth: 50 },
  { id: 'mid', name: 'Twilight Slope', minDepth: 50, maxDepth: 130 },
  { id: 'deep', name: 'The Abyss', minDepth: 130, maxDepth: 9999 },
];

export function zoneForDepth(depth) {
  for (const z of ZONES) if (depth < z.maxDepth) return z;
  return ZONES[ZONES.length - 1];
}

function hash2(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smooth(t) { return t * t * (3 - 2 * t); }

export function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
}

export function fbm(x, z, oct = 4) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += valueNoise(x * f, z * f) * amp;
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm; // 0..1
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Height of the seafloor (negative number) at x,z.
export function floorHeight(x, z) {
  const slope = smoothstep(-200, 130, z);
  let h = -20 - slope * 145;
  // trench in the south
  const trench = smoothstep(130, 300, z) * Math.exp(-((x / 170) ** 2));
  h -= trench * 85;
  const t = Math.min(1, -h / 200);
  h += (fbm(x * 0.011 + 31.7, z * 0.011 - 12.3) - 0.5) * (14 + 26 * t);
  h += (fbm(x * 0.06, z * 0.06, 2) - 0.5) * 3.5;
  // raise edges so the world feels enclosed
  const edge = Math.max(Math.abs(x), Math.abs(z));
  h += smoothstep(WORLD.half - 40, WORLD.half, edge) * 30;
  return Math.min(h, -6);
}

// Forward vector for yaw/pitch (model forward is +Z).
export function forwardVec(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
}

export function clampToWorld(p, radius) {
  const lim = WORLD.half - 2;
  if (p[0] < -lim) p[0] = -lim; if (p[0] > lim) p[0] = lim;
  if (p[2] < -lim) p[2] = -lim; if (p[2] > lim) p[2] = lim;
  const fl = floorHeight(p[0], p[2]) + radius + 0.2;
  if (p[1] < fl) p[1] = fl;
  const top = WORLD.surface - Math.max(0.6, radius * 0.6);
  if (p[1] > top) p[1] = top;
  return p;
}

// Random point inside a zone, with x/z bands chosen so the floor is deep enough.
export function randomPointInZone(zoneId, rnd = Math.random) {
  for (let i = 0; i < 40; i++) {
    let x = (rnd() * 2 - 1) * (WORLD.half - 30), z;
    if (zoneId === 'shallow') z = -330 + rnd() * 230;
    else if (zoneId === 'mid') z = -140 + rnd() * 260;
    else z = 110 + rnd() * 210;
    const fl = floorHeight(x, z);
    const zone = ZONES.find(zz => zz.id === zoneId);
    const minY = Math.max(fl + 3, -zone.maxDepth);
    const maxY = Math.min(-3, -zone.minDepth);
    if (minY >= maxY) continue;
    const y = minY + rnd() * (maxY - minY);
    return [x, y, z];
  }
  return [0, -10, -250];
}

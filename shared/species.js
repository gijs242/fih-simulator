// Creature definitions and the evolution tree. Every creature is a real animal, living or extinct.
// size ~ body length in game meters; it drives hitbox, reach, what you can swallow and XP value.

export const EVOLVE_LEVELS = [1, 4, 9, 15, 21];
export const MAX_LEVEL = 30;
export const TIER_NAMES = ['Hatchling', 'Juvenile', 'Hunter', 'Predator', 'Prehistoric Apex'];

export const SPECIES = [
  {
    id: 'shrimp', name: 'Ghost Shrimp', tier: 0, role: 'Hatchling', era: 'Modern',
    size: 0.5, hp: 22, speed: 7.5, bite: 5, biteCd: 0.5, armor: 0,
    a2: { type: 'snap', cd: 3, name: 'Tail Flip', desc: 'Flick backwards to escape danger.' },
    next: ['sardine', 'puffer', 'lionfish', 'trilobite'],
    desc: 'Tiny, translucent and edible. Eat plankton and survive.',
    model: { kind: 'shrimp', c1: '#b8a594', c2: '#6e5547' },
  },
  // ---- tier 1
  {
    id: 'sardine', name: 'Sardine', tier: 1, role: 'Speed', era: 'Modern',
    size: 1.0, hp: 48, speed: 11.5, bite: 9, biteCd: 0.5, armor: 0,
    a2: { type: 'lunge', cd: 4, mul: 1.8, name: 'Lunge', desc: 'Burst forward; your next bite hits for 1.8x.' },
    next: ['barracuda'],
    desc: 'Fast and slippery. Leads to barracuda and sharks.',
    model: { kind: 'fish', c1: '#7f8f96', c2: '#2f3d45', belly: '#c9cfcc', shape: 'slim', pattern: 'spots' },
  },
  {
    id: 'puffer', name: 'Pufferfish', tier: 1, role: 'Armor', era: 'Modern',
    size: 0.9, hp: 85, speed: 7.5, bite: 8, biteCd: 0.6, armor: 0.1,
    a2: { type: 'spikes', cd: 8, name: 'Inflate', desc: 'Puff up: take 60% less damage, spike anything nearby.' },
    next: ['grouper'],
    desc: 'Slow, tough and prickly. Leads to grouper and turtles.',
    model: { kind: 'puffer', c1: '#8a7d55', c2: '#3b3424', belly: '#cfc6a6' },
  },
  {
    id: 'lionfish', name: 'Lionfish', tier: 1, role: 'Venom', era: 'Modern',
    size: 1.0, hp: 55, speed: 8.5, bite: 7, biteCd: 0.55, armor: 0,
    a2: { type: 'venom', cd: 4, name: 'Venom Sting', desc: 'Long-reach sting that poisons over 5 seconds.' },
    next: ['moray'],
    desc: 'Beautiful and nasty. Leads to eels, squid and jellies.',
    model: { kind: 'lionfish', c1: '#8f4a36', c2: '#e6d3c0', belly: '#d9c2ad' },
  },
  {
    id: 'trilobite', name: 'Trilobite', tier: 1, role: 'Ancient', era: 'Cambrian–Permian',
    size: 0.8, hp: 75, speed: 8, bite: 8, biteCd: 0.6, armor: 0.2,
    a2: { type: 'shell', cd: 8, name: 'Roll Up', desc: 'Curl into an armored ball: 80% less damage and regenerate.' },
    next: ['anomalocaris'],
    desc: 'An armored arthropod from 500 million years ago.',
    model: { kind: 'trilobite', c1: '#6d6253', c2: '#2e2820', belly: '#9c8f7a' },
  },
  // ---- tier 2
  {
    id: 'barracuda', name: 'Barracuda', tier: 2, role: 'Speed', era: 'Modern',
    size: 2.6, hp: 150, speed: 14, bite: 24, biteCd: 0.6, armor: 0,
    a2: { type: 'lunge', cd: 4, mul: 1.8, name: 'Lunge', desc: 'Burst forward; your next bite hits for 1.8x.' },
    next: ['mako', 'swordfish'],
    desc: 'A torpedo with teeth.',
    model: { kind: 'fish', c1: '#6f7c78', c2: '#26302f', belly: '#bfc4bb', shape: 'long', pattern: 'bars' },
  },
  {
    id: 'grouper', name: 'Goliath Grouper', tier: 2, role: 'Armor', era: 'Modern',
    size: 2.4, hp: 290, speed: 9, bite: 22, biteCd: 0.7, armor: 0.15,
    a2: { type: 'ram', cd: 6, name: 'Headbutt', desc: 'Charge forward, knocking back and stunning what you hit.' },
    next: ['greatwhite', 'turtle'],
    desc: 'A heavy, mottled brute of the reef.',
    model: { kind: 'fish', c1: '#6b5a44', c2: '#2b231b', belly: '#a89880', shape: 'fat', pattern: 'mottled' },
  },
  {
    id: 'moray', name: 'Moray Eel', tier: 2, role: 'Venom', era: 'Modern',
    size: 3.0, hp: 180, speed: 10.5, bite: 26, biteCd: 0.6, armor: 0,
    a2: { type: 'ambush', cd: 10, name: 'Ambush', desc: 'Fade into the murk for 5s. Next bite deals 2.5x.' },
    next: ['squid', 'boxjelly'],
    desc: 'Lurks in the dark. Strikes from nowhere.',
    model: { kind: 'eel', c1: '#4d5a2e', c2: '#1e2412', belly: '#8a8f55' },
  },
  {
    id: 'anomalocaris', name: 'Anomalocaris', tier: 2, role: 'Ancient', era: 'Cambrian',
    size: 2.2, hp: 190, speed: 12, bite: 25, biteCd: 0.55, armor: 0.1,
    a2: { type: 'grab', cd: 6, name: 'Grasping Claws', desc: 'Long-reach grab that pulls prey in and stuns it.' },
    next: ['dunkleosteus', 'cameroceras'],
    desc: 'The first apex predator on Earth.',
    model: { kind: 'anomalocaris', c1: '#8a5a3e', c2: '#3a2216', belly: '#b08a6a' },
  },
  // ---- tier 3
  {
    id: 'mako', name: 'Mako Shark', tier: 3, role: 'Speed', era: 'Modern',
    size: 6, hp: 560, speed: 17.5, bite: 62, biteCd: 0.6, armor: 0.05,
    a2: { type: 'lunge', cd: 3.5, mul: 1.8, name: 'Lunge', desc: 'Burst forward; your next bite hits for 1.8x.' },
    next: ['megalodon', 'livyatan'],
    desc: 'The fastest shark in the sea.',
    model: { kind: 'shark', c1: '#3d4f63', c2: '#1a222b', belly: '#c3c8c9', shape: 'slim' },
  },
  {
    id: 'swordfish', name: 'Swordfish', tier: 3, role: 'Speed', era: 'Modern',
    size: 5.5, hp: 450, speed: 19, bite: 48, biteCd: 0.55, armor: 0,
    a2: { type: 'slash', cd: 4, name: 'Bill Slash', desc: 'Wide slash that hits everything in front and makes it bleed.' },
    next: ['megalodon', 'mosasaurus'],
    desc: 'A living blade.',
    model: { kind: 'fish', c1: '#3b4a5c', c2: '#151c25', belly: '#b9bec2', shape: 'sword', pattern: 'none' },
  },
  {
    id: 'greatwhite', name: 'Great White', tier: 3, role: 'Armor', era: 'Modern',
    size: 9, hp: 1150, speed: 12.5, bite: 100, biteCd: 0.8, armor: 0.1,
    a2: { type: 'ram', cd: 6, name: 'Ram', desc: 'Charge forward, knocking back and stunning what you hit.' },
    next: ['megalodon', 'mosasaurus'],
    desc: 'Scarred. Hungry. Not done growing.',
    model: { kind: 'shark', c1: '#59616a', c2: '#272b30', belly: '#d6d6d0', shape: 'fat' },
  },
  {
    id: 'turtle', name: 'Leatherback Turtle', tier: 3, role: 'Armor', era: 'Modern',
    size: 5, hp: 1000, speed: 10, bite: 58, biteCd: 0.75, armor: 0.3,
    a2: { type: 'shell', cd: 9, name: 'Shell Up', desc: 'Take 80% less damage and regenerate for 3s.' },
    next: ['mosasaurus', 'liopleurodon'],
    desc: 'An ancient, armored tank.',
    model: { kind: 'turtle', c1: '#3e3f37', c2: '#1c1d18', belly: '#8d8a78' },
  },
  {
    id: 'squid', name: 'Giant Squid', tier: 3, role: 'Venom', era: 'Modern',
    size: 10, hp: 820, speed: 13.5, bite: 75, biteCd: 0.65, armor: 0,
    a2: { type: 'ink', cd: 10, name: 'Ink Cloud', desc: 'Blind everything around you and jet away.' },
    next: ['livyatan', 'liopleurodon'],
    desc: 'A nightmare of the deep.',
    model: { kind: 'squid', c1: '#7a3b33', c2: '#2c1310', belly: '#b07a6c' },
  },
  {
    id: 'boxjelly', name: 'Box Jellyfish', tier: 3, role: 'Venom', era: 'Modern',
    size: 4.5, hp: 420, speed: 9, bite: 40, biteCd: 0.5, armor: 0, venomous: true,
    a2: { type: 'pulse', cd: 7, name: 'Venom Pulse', desc: 'Poison everything around you. Your stings always poison.' },
    next: ['liopleurodon', 'livyatan'],
    desc: 'Barely visible, utterly lethal.',
    model: { kind: 'jelly', c1: '#9fc7cf', c2: '#4d7f8a' },
  },
  {
    id: 'dunkleosteus', name: 'Dunkleosteus', tier: 3, role: 'Ancient', era: 'Devonian',
    size: 7, hp: 950, speed: 11.5, bite: 120, biteCd: 0.9, armor: 0.25,
    a2: { type: 'lunge', cd: 5, mul: 2.4, name: 'Guillotine Bite', desc: 'Lunge with self-sharpening bone jaws for 2.4x damage.' },
    next: ['liopleurodon', 'megalodon'],
    desc: 'An armored placoderm with jaws like shears.',
    model: { kind: 'dunkleosteus', c1: '#5a5548', c2: '#22201a', belly: '#9a937e' },
  },
  {
    id: 'cameroceras', name: 'Cameroceras', tier: 3, role: 'Ancient', era: 'Ordovician',
    size: 8, hp: 780, speed: 12, bite: 72, biteCd: 0.6, armor: 0.2,
    a2: { type: 'grab', cd: 6, name: 'Tentacle Snare', desc: 'Long-reach grab that pulls prey in and stuns it.' },
    next: ['livyatan', 'mosasaurus'],
    desc: 'A giant cone-shelled cephalopod.',
    model: { kind: 'orthocone', c1: '#8c7a5c', c2: '#3a2d1e', belly: '#c2b090' },
  },
  // ---- tier 4: prehistoric apex
  {
    id: 'megalodon', name: 'Megalodon', tier: 4, role: 'Apex', era: 'Miocene–Pliocene',
    size: 15, hp: 2600, speed: 16, bite: 220, biteCd: 0.75, armor: 0.1,
    a2: { type: 'lunge', cd: 4, mul: 2.0, name: 'Megabite', desc: 'Lunge with the strongest bite in history for 2x damage.' },
    next: [],
    desc: 'The largest shark that ever lived.',
    model: { kind: 'shark', c1: '#4f565c', c2: '#1f2327', belly: '#cfcfc8', shape: 'mega' },
  },
  {
    id: 'mosasaurus', name: 'Mosasaurus', tier: 4, role: 'Apex', era: 'Late Cretaceous',
    size: 14, hp: 2500, speed: 15, bite: 190, biteCd: 0.7, armor: 0.2,
    a2: { type: 'grab', cd: 5, name: 'Death Roll', desc: 'Seize, drag in and stun anything in reach.' },
    next: [],
    desc: 'A sea lizard the size of a bus.',
    model: { kind: 'reptile', c1: '#4a5248', c2: '#1d221d', belly: '#a8a690', variant: 'mosasaur' },
  },
  {
    id: 'liopleurodon', name: 'Liopleurodon', tier: 4, role: 'Apex', era: 'Middle Jurassic',
    size: 15, hp: 2300, speed: 15.5, bite: 230, biteCd: 0.8, armor: 0.2,
    a2: { type: 'ram', cd: 5, name: 'Flipper Charge', desc: 'Four-flipper burst that knocks back and stuns.' },
    next: [],
    desc: 'A short-necked pliosaur with a crushing skull.',
    model: { kind: 'reptile', c1: '#4b4d52', c2: '#1b1c20', belly: '#b3ada0', variant: 'pliosaur' },
  },
  {
    id: 'livyatan', name: 'Livyatan', tier: 4, role: 'Apex', era: 'Miocene',
    size: 15, hp: 3000, speed: 14, bite: 200, biteCd: 0.85, armor: 0.15,
    a2: { type: 'sonar', cd: 7, name: 'Sonic Blast', desc: 'Echolocation shockwave: stuns and pushes back everything ahead.' },
    next: [],
    desc: 'A raptorial sperm whale with foot-long teeth.',
    model: { kind: 'whale', c1: '#3e3c3a', c2: '#1a1918', belly: '#7d7a74' },
  },
  // ---- harmless ambient prey (not playable through evolution; schools of these swim around every player)
  {
    id: 'krill', name: 'Antarctic Krill', tier: 0, role: 'Prey', era: 'Modern', ambient: true,
    size: 0.25, hp: 6, speed: 6, bite: 1, biteCd: 1, armor: 0,
    a2: { type: 'snap', cd: 3, name: 'Tail Flip', desc: 'Flick backwards to escape danger.' },
    next: [],
    desc: 'The most abundant animal on Earth. Snack-sized.',
    model: { kind: 'shrimp', c1: '#c4704e', c2: '#7a3420' },
  },
  {
    id: 'anchovy', name: 'Anchovy', tier: 1, role: 'Prey', era: 'Modern', ambient: true,
    size: 0.6, hp: 14, speed: 9, bite: 2, biteCd: 1, armor: 0,
    a2: { type: 'snap', cd: 3, name: 'Dart', desc: 'Dart away.' },
    next: [],
    desc: 'Small schooling baitfish.',
    model: { kind: 'fish', c1: '#8a9a92', c2: '#34463f', belly: '#d2d6ce', shape: 'slim', pattern: 'none' },
  },
];

export const SPECIES_INDEX = {};
SPECIES.forEach((s, i) => { SPECIES_INDEX[s.id] = i; s.index = i; s.minLevel = EVOLVE_LEVELS[s.tier]; });

export function xpNeeded(level) {
  return Math.round(6 * Math.pow(1.25, level - 1));
}

// Every creature is drawn and collides at this multiple of its listed size.
export const SIZE_SCALE = 2.5;
// Bigger bodies need more speed so they don't feel sluggish relative to their length.
export const SPEED_SCALE = 1.5;
// Human players hit harder and swim faster than bots of the same species.
export const PLAYER_DAMAGE = 1.5;
export const PLAYER_SPEED = 1.25;

export function stats(spIndex, level) {
  const s = SPECIES[spIndex];
  const over = Math.max(0, level - s.minLevel);
  return {
    size: s.size * SIZE_SCALE * (1 + 0.08 * over), // grows 8% every level
    maxHp: Math.round(s.hp * (1 + 0.08 * over)),
    speed: s.speed * SPEED_SCALE * (1 + 0.012 * over),
    bite: s.bite * (1 + 0.08 * over),
    biteCd: s.biteCd,
    armor: s.armor,
  };
}

// XP a creature is worth when killed
export function xpValue(size) {
  const base = size / SIZE_SCALE;
  return Math.round(2 + 5 * base * base);
}

// Bot population per zone: [speciesId or [choices], count, minLevel, maxLevel]
export const BOT_TABLE = {
  // spots with a list pick a random species from it every time they respawn, so every creature still appears
  shallow: [['shrimp', 8, 1, 3], ['krill', 5, 1, 1], ['anchovy', 4, 1, 3], ['sardine', 3, 4, 6],
    [['puffer', 'lionfish', 'trilobite'], 3, 4, 6], ['barracuda', 1, 9, 10]],
  mid: [['anchovy', 3, 1, 3], ['sardine', 2, 5, 8], [['lionfish', 'puffer', 'trilobite'], 2, 5, 8],
    ['barracuda', 3, 9, 12], [['grouper', 'moray', 'anomalocaris'], 4, 9, 12], ['swordfish', 1, 15, 16]],
  deep: [[['moray', 'anomalocaris', 'grouper'], 1, 11, 14],
    [['mako', 'greatwhite', 'squid', 'boxjelly', 'turtle', 'swordfish', 'dunkleosteus', 'cameroceras'], 3, 15, 20],
    [['megalodon', 'mosasaurus', 'liopleurodon', 'livyatan'], 1, 21, 24]],
};

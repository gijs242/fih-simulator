# Fih Simulator

A multiplayer 3D ocean evolution game played in the browser. You start as a ghost shrimp, eat to grow, and evolve
along branching paths. The paths run through real modern animals up to prehistoric apex predators: Megalodon,
Mosasaurus, Liopleurodon and Livyatan. Bots fill the ocean, so you can also play alone.

## Play locally

```bash
npm install
npm start
```

Open http://localhost:3000. "Play offline" runs the whole simulation in your browser with no server.

## Controls

| Input | Action |
|---|---|
| Mouse | Steer (click the game to capture the mouse, Esc to release it) |
| W A S D | Swim |
| Space / Shift | Up / down |
| Alt | Dash |
| Left click (hold) | Bite |
| Right click | Species ability |
| 1 / 2 | Pick an evolution |
| Tab | Side menu: become any creature (these runs don't count for the all-time board) |
| M | Mute |

## Evolution tree

| Tier (level) | Creatures |
|---|---|
| 0 (1) | Ghost Shrimp |
| 1 (4) | Sardine · Pufferfish · Lionfish · Trilobite |
| 2 (9) | Barracuda · Goliath Grouper · Moray Eel · Anomalocaris |
| 3 (15) | Mako · Swordfish · Great White · Leatherback · Giant Squid · Box Jellyfish · Dunkleosteus · Cameroceras |
| 4 (21) | Megalodon · Mosasaurus · Liopleurodon · Livyatan |

Schools of harmless prey (Antarctic krill, anchovies and smaller creatures) spawn around every player, sized so you can eat them.

## Deploying (Render)

1. Push this repo to GitHub.
2. On https://render.com, choose **New → Blueprint** and pick the repo. `render.yaml` sets everything up.
3. Share the `https://fih-simulator-xxxx.onrender.com` URL.

On the free plan the server sleeps after 15 minutes without players, and the next visitor waits about a minute for it
to wake. The all-time leaderboard is saved to `data/leaderboard.json`, which resets whenever the server restarts.
Add a Render persistent disk (paid) and set `DATA_DIR` to its mount path to keep the leaderboard.

## Layout

- `shared/` holds the world, species and simulation code, used by both the server and offline mode.
- `server/` contains the Node HTTP and WebSocket server, which runs the authoritative simulation at 20 Hz.
- `client/` contains the Three.js renderer, procedural creature models, HUD, input and synthesized audio.

Debug view of every creature model: `/?gallery`, or a single one with `/?gallery=megalodon`.

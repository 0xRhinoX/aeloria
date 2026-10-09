# Aeloria

A bioluminescent world of floating mountains, giant trees and winged riders, grown in the browser from a single seed. There are no models, textures or downloaded assets. Every mesh, colour, glow, sky and sound is generated in code.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

## Deploy to Vercel

1. Import the repository in Vercel.
2. Vercel detects Vite automatically. `vercel.json` sets the build command (`npm run build`), the output directory (`dist`) and long-term caching for hashed assets.

It is a fully static site, so no server or environment variables are needed.

## What's in the world

| Place | What you'll see |
| --- | --- |
| Hanging Peaks | ~40 floating mountains, karst spires, stone arches, waterfalls falling into mist |
| Elder Tree | a 200 m braided tree with ~2,600 glowing hanging strands |
| Lumen Forest | rainforest giants, glowing pods, trumpet flowers, ferns and mushrooms |
| Amber Plains | grass meadows and umbrella trees under drifting islands |
| Mirror Lake | still water with glowing plankton under a banded gas giant |

## Controls

| Key | Action |
| --- | --- |
| Click a rider / `1`–`6` / `Tab` | switch rider |
| `F` | take the reins (`WASD` or arrows to steer, `Shift` to dive fast, `Esc` back to autopilot). On touch, drag to steer. |
| `C` | camera: Chase, Saddle, Orbit, Film |
| `T` | sky: Day, Dusk, Night |
| `R` | start or quit the ring race |
| `G` / hold `B` | seek a wild flock / bond with a wild mount |
| `P` | photo mode (Save image) |
| `H` | hide the interface |
| `M` | sound |
| `N` | new world |

## Mechanics

- **Glow trail:** riders flying low make the ground and plants ripple with light, strongest at night.
- **Skyveil Run:** a ring race through the Hanging Peaks, with best times saved per seed.
- **Wild mounts:** riderless flocks circle the peaks and plains. Fly within 40 m and hold Bond for 2.5 s to take the wild mount. Your old mount returns to the wild, and the new colourway is kept.
- **Drift seeds:** 60 glowing seeds per world. Collecting them unlocks the Aurora (10), Obsidian (25) and Sunbloom (45) colourways.
- **Weather:** clear, mist, rain and storm, with rain streaks, rippling water, lightning and thunder.
- **Shareable worlds:** the seed, rider, sky and weather live in the URL (`?seed=4417&rider=2&sky=1&weather=storm`).
- **Procedural sound:** wind, an ambient pad, wingbeats, creature chirps, chimes, rain and thunder, all synthesised with Web Audio.

## How it's built

- **Vite + React + TypeScript**, rendering with **three.js** through **React Three Fiber**. React handles only the UI. The 3D scene is driven imperatively in `src/engine/Engine.ts` from a single `useFrame` loop, so there is no per-frame React reconciliation.
- **Generation runs in a Web Worker** (`src/world/worker.ts`). It returns plain typed arrays, which are transferred to the main thread rather than copied, so the page stays responsive while the world grows.
- **Instancing in spatial chunks:** plants and trees are `InstancedMesh` tiles with their own bounding spheres, so frustum culling and distance culling skip whole tiles.
- **One shader patch for life** (`bioMat` in `src/engine/materials.ts`) adds per-vertex bioluminescence, world-space lichen speckles, wind sway and the wing-ripple glow to standard PBR materials.
- **Quality tiers:** phones get fewer plants, a coarser terrain and no antialiasing. Auto graphics mode adjusts the pixel ratio to hold the frame rate.

```
src/
  world/     noise, terrain, plant/tree/rock builders, generator, worker   (runs off-thread)
  engine/    materials, sky/weather palette, creatures, flight, flocks, race, seeds, audio, Engine
  state/     zustand store for the interface
  ui/        panels, HUD, roster, name tags
```

Add `?debug` to the URL to expose `window.aeloria` (the engine and store) in the console.

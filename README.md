# Aeloria

A bioluminescent world of floating mountains, giant trees and winged riders, grown in the browser from a single seed. There are no models, textures or downloaded assets. Every mesh, colour, glow, sky and sound is generated in code.

Made by [@0xRhinoX](https://x.com/0xRhinoX). More AI-built worlds on [Pokeable](https://pokeable.app/).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

## Deploy to Cloudflare

1. In the Cloudflare dashboard, go to Workers & Pages → Create → Import a repository and pick this repo.
2. Build command: `npm run build`. Deploy command: `npx wrangler deploy`.
3. `wrangler.jsonc` serves the `dist` folder as static assets, and `public/_headers` sets long-term caching for hashed assets.
4. Attach a custom domain under the Worker's Domains tab → Add Domain.

The Worker also runs a small `Presence` Durable Object (`worker/index.ts`) behind `/api/presence`. Each open game holds a WebSocket to it, and it sends back the number of players online, shown in the top-right corner. It hibernates between joins and leaves, so it fits the free Workers plan.

It is a fully static site, so no server or environment variables are needed.

## What's in the world

| Place | What you'll see |
| --- | --- |
| Hanging Peaks | ~40 floating mountains, karst spires, stone arches, waterfalls falling into mist |
| Elder Tree | a 200 m braided tree with a leafy glowing canopy and ~2,600 hanging strands |
| Lumen Forest | rainforest giants, glowing pods, trumpet flowers, ferns, mushrooms and boulders |
| Amber Plains | dense grass and umbrella trees under drifting islands |
| Mirror Lake | water with depth colour, shoreline foam and glowing plankton, under a banded gas giant |
| The Leviathan | a 300 m sky whale swimming a slow figure-eight over the whole world, with a glowing garden on its back and tendrils streaming from its belly |

## Flying

Press `F` (or **Take reins**) to fly the selected rider yourself. Press it again to hand back to autopilot.

| Input | Keyboard + mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Steer | Click the view to capture the mouse, then aim with it. Or use `WASD` / arrows. | Left stick | Left stick on screen |
| Flap (thrust, uses stamina) | `Space` | `A` or `RT` | **Flap** |
| Dive (tuck the wings) | `Shift` | `B` or `LT` | **Dive** |
| Barrel roll | `Q` / `E` | `X` | **Roll** |
| Back to autopilot | `F` | `Start` | **Autopilot** |

The flight model is energy based. Banking turns the mount. Diving trades height for speed, and climbing spends it. Tucking the wings cuts drag for fast dives. Flapping gives thrust but drains stamina, which refills while you glide. Collecting a drift seed or passing a race ring tops it up. Fly too slow and the mount stalls and noses down. Rock, ground and water are solid, so you bounce off them and lose speed. **Flight assist** (on by default, in Settings → Ride) steers gently around rock and pulls up near the ground, whether you steer with the mouse or the keys. It also gives a soaring lift that holds cruising speed in level flight, and levels the nose when you let go, so you only flap to go faster or climb.

## Other controls

| Key | Action |
| --- | --- |
| Click a rider / `1`–`6` / `Tab` | switch rider |
| `C` (`Shift+C` back) | camera: Chase, Saddle, Drone, Orbit, Film |
| `M` | world map: click anywhere to fly there, or jump straight there |
| `T` | sky: Day, Dusk, Night |
| `R` | start or quit the ring race |
| `G` / hold `B` | seek a wild flock / bond with a wild mount |
| `L` | ride with the Leviathan (the autopilot escorts it; flying yourself, the compass marks it) |
| `P` | photo mode, with depth of field and Save image |
| `H` | hide the interface |
| `O` | sound (on by default, starts on your first click or key press) |
| `K` | full screen |
| `Esc` | pause, with every control explained (while aiming with the mouse, the first `Esc` only frees the cursor) |
| `N` | new world |

## Finding your way

- **Minimap** in the HUD rotates with your heading. It shows riders, drift seeds, wild mounts, the next race ring and your map pin. Click it to open the world map.
- **World map** (`M`): a hill-shaded overview baked from the terrain. Click any spot to set a pin, and the autopilot flies you there. You can also jump straight there.
- **Compass** across the top shows the heading, nearby places with distances, the nearest drift seed, the nearest wild mount, the next race ring and your pin.
- **Drone camera** follows from high above for a wide view of the surroundings.

## Graphics presets

| Preset | What it does |
| --- | --- |
| Fast | Direct rendering without post-processing, fewer grass blades, shorter draw distance. Default on phones. |
| Balanced | HDR bloom, colour grading, 2× MSAA, camera-following grass. Default on most laptops. |
| High | Adds sun shadows, 4× MSAA and denser grass. Default on strong desktops. |

Every preset adjusts the pixel ratio on the fly to hold the frame rate. The choice is remembered.

## Mechanics

- **Glow trail:** riders flying low make the ground and plants ripple with light, strongest at night. Wingtips leave light trails at speed.
- **Skyveil Run:** a ring race through the Hanging Peaks, with best times saved per seed.
- **The Leviathan:** a sky whale that follows its own path like a snake, so turns ripple down its 300 m body. Its route rises smoothly over the floating isles and the Elder Tree. Its body, flippers and flukes are solid, and flying alongside it puts you in its slipstream, which pushes you along and restores stamina. Every minute or so it sings, exhales a glowing spout, and the whole world's glow swells in answer. It shows on the compass, minimap and world map.
- **Wild mounts:** riderless flocks circle the peaks and plains. Fly within 40 m and hold Bond for 2.5 s to take the wild mount. Your old mount returns to the wild, and the new colourway is kept.
- **Drift seeds:** 60 glowing seeds per world. Collecting them unlocks the Aurora (10), Obsidian (25) and Sunbloom (45) colourways.
- **Weather:** clear, mist, rain and storm, with valley fog, rain streaks, rippling water, lightning and thunder.
- **Shareable worlds:** the seed, rider, sky and weather live in the URL (`?seed=4417&rider=2&sky=1&weather=storm`).
- **Procedural sound:** wind, a dive whistle, an ambient pad, wingbeats, impacts, water spray, creature chirps, chimes, rain and thunder, all synthesised with Web Audio.

## How it's built

- **Vite + React + TypeScript**, rendering with **three.js** through **React Three Fiber**. React handles only the UI. The 3D scene is driven imperatively in `src/engine/Engine.ts` from a single `useFrame` loop, so there is no per-frame React reconciliation.
- **Generation runs in a Web Worker** (`src/world/worker.ts`). It returns plain typed arrays, which are transferred to the main thread rather than copied, so the page stays responsive while the world grows. The worker also bakes:
  - terrain sky occlusion, including soft shadows under floating isles,
  - a field texture (height, grass density, forest mask, occlusion) for the GPU,
  - the overview map.
- **Leaf-card canopies:** trees combine a lumpy core volume with alpha-tested leaf cards drawn from a procedural foliage atlas (`src/engine/leaves.ts`). The cards keep the canopy's normals, so the foliage shades as one soft volume.
- **Camera-following grass** (`src/engine/grass.ts`): up to 130k blades in a tile that wraps around the camera. They are positioned entirely on the GPU from the field texture, using the same triangle split as the terrain mesh.
- **One shader patch for life** (`bioMat` in `src/engine/materials.ts`) adds the following to standard PBR materials:
  - per-vertex bioluminescence,
  - world-space lichen speckles,
  - procedural bump detail,
  - wind sway,
  - wing-ripple glow,
  - backlit wing membranes,
  - height fog that fills valleys and scatters toward the sun.
- **Post-processing** (`src/engine/post.ts`, pmndrs `postprocessing`): HDR render, mipmap bloom, then one grade pass (exposure, ACES, saturation, vignette). Depth of field is on in photo mode.
- **The Leviathan is shaped on the GPU** (`src/engine/leviathan.ts`). The CPU lays its spine along the path each frame and uploads it as a small float texture. The vertex shader builds a smooth 25k-vertex body from it, and the fragment shader paints the skin per pixel: countershading, mottling, throat pleats, rows of lights, glowing spine chevrons, moss, tubercles, barnacles and the eye, with fine relief from a procedural height field. Its flippers and flukes are lofted from airfoil sections, the garden on its back is one instanced draw placed from the same spine texture, and its tendrils trail along the path it has just swum.
- **Instancing in spatial chunks:** plants, trees and boulders are `InstancedMesh` tiles with their own bounding spheres, so frustum culling and distance culling skip whole tiles.

```
src/
  world/     noise, terrain, plant/tree/rock builders, generator, worker   (runs off-thread)
  engine/    materials, post, grass, leaves, sky/weather palette, creatures, rider flight model,
             camera rig, input, effects (trails, speed lines, spray), flocks, race, seeds, audio, Engine
  state/     zustand store for the interface
  ui/        panels, HUD with minimap, compass, world map, touch controls, name tags
```

Add `?debug` to the URL to expose `window.aeloria` (the engine and store) in the console.

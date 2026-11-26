# beneRadio – Tecnam flight sim: LKBE Benešov, LKPM Příbram, LKPR Praha, LKVL Vlašim, LKKV Karlovy Vary

A browser flight sim for a flight school at **LKBE Benešov**. You start on the apron, taxi to the real
holding points, fly a circuit over the real terrain and villages, land, and taxi back.
The physics is roughly P2002-like and meant to be fun: lift-off at about 150 m, Vy about 66 kt, stall at about 47/40 kt (clean/full flaps).
It is not a certified training device.

## Run

```bash
npm install
npm run dev        # http://localhost:5190
```

Press **H** in the sim for the key list. The basics:

- **E**: start the engine
- **Enter**: radio call
- **P**: parking brake
- **W/S**: throttle
- **A/D**: steering and rudder
- **Arrow keys**: stick
- **F/R**: flaps
- **C**: camera view
- **M**: map

## World: detail islands + streaming

- **Detail islands** are pre-baked high-resolution areas around the airports: 5 m ČÚZK DMR 5G terrain, 1 m orthophoto, OSM buildings and forests,
  and a painted aerodrome surface. They are LKBE (22 × 22 km, `public/data/`), LKPM (8 × 8 km), LKPR (10 × 10 km) LKVL Vlašim (6 × 6 km) and LKKV Karlovy Vary (14 × 14 km, which includes the whole city and the Ohře valley), all of these under `public/data/<ICAO>/`.
  LKKV is controlled (Vary TOWER). Its stands are generated from OSM's numbered stand lead-in lines.
  LKVL's taxiway A, holding point and stands are hand-placed in `registry.ts`, because OSM only maps its runway.
- **Everywhere else in Czechia streams in** (`src/world/stream.ts`, `src/world/stream-buildings.ts`) as a quadtree of tiles around the camera:
  - ČÚZK `ORTOFOTO_WM` photo
  - Terrarium elevation (AWS Open Data)
  - OpenFreeMap vector tiles for buildings and place names

  Streamed tiles are not drawn inside the islands, and their heights blend into the island edges.
- **Airports** come from `src/airport/registry.ts`. LKBE is hand-tuned (`lkbe.ts`). LKPM and LKPR are generated from their OSM aerodrome data
  (runways, taxiways, holding positions, stands) plus a few facts from the AIP and VFR Manual. LKPR uses TOWER phraseology.
- **New islands:** add an entry to `scripts/islands.mjs`, then run `node scripts/fetch-island.mjs <ICAO>` and `node scripts/build-island.mjs <ICAO>`.
  Then add its facts to `META` in `src/airport/registry.ts`.

## What's in it

| Part | Source |
|---|---|
| Terrain, 22 × 22 km around the ARP | ČÚZK **DMR 5G** elevation: 5 m around the airfield, about 10–15 m elsewhere |
| Ground texture | ČÚZK **orthophoto**: about 1 m/px within 3 km, lower resolution further out |
| Villages (25.6k buildings), forests, place names | **OpenStreetMap** |
| Runways and taxiways A, A1, B, C, C2, C3, D | OSM, checked against the ŘLP VFR Manual chart `VFR-AD-LKBE-ADC` |
| Holding points, stands, windsocks, circuit directions | `src/airport/lkbe.ts` |

**Holding point positions are approximate** (placed at the strip edges). The school can move them in
`src/airport/lkbe.ts` (`HOLDING_POINTS`). The map, the signs and the lesson routing all update from that file.

## Aircraft models

Pick the model and livery at the bottom left; the choice is saved in the browser.

- **Tecnam P2002 Sierra (detailed)** is the default. It's the FlightGear model by Emmanuel Baranger (helijah), with
  the interior, panel, seats and 6 liveries. It lives in `public/models/p2002/` as unmodified AC3D/PNG files,
  loaded by `src/models/ac3d.ts`. **Licence: GPL v2+** (`public/models/p2002/COPYING`), so if you redistribute
  the app, keep those files and the credit, and make them available under the GPL.
- **LKBE Benešov school livery** is the default livery: Czech-flag blue and red, "LKBE" and a flag on the fin, and the registration
  from the **Reg** box (which is also your radio callsign). It's generated in `src/models/livery.ts` on top of the FlightGear texture.
- **🔥 Hot Rod Flames** is a 90s/00s custom-paint job: gloss white, with airbrushed yellow → orange → red flame licks and a thin dark-red
  pinstripe on the fuselage, wings and wheel pants. It's generated in `src/models/flames.ts` and clipped to the model's UV triangles.
- **Tecnam P2006T twin** is the FlightGear P2006T MMA model by helijah, also GPL. It has two engines, retractable gear (**Shift+G**) with gear doors,
  and engine-failure training (**U** / **I**). Its own flight numbers are in `src/sim/p2006t.ts`.
  The **🎖 Czech Air Force** livery (`src/models/military.ts`) is two-tone grey with roundels, a fin flash, a 4-digit serial (the Reg box),
  an anti-glare panel and the FLIR turret, radar and SATCOM shown. Callsign: "CZECH AIR FORCE 0731".
- **Simple model (original)** is the procedural low-poly model from `src/sim/p2002.ts`.

Both models share the same physics. Moving surfaces, prop, wheels and nose-wheel steering are animated using the pivot data
from FlightGear's `p2002.xml`.

## Airfield ground

Inside the aerodrome boundary the aerial photo is replaced by painted ground (`src/world/airfield-ground.ts`):
mown grass with stripes on the runway strips, worn runway and taxiway surfaces, the grass parking, a paved apron and roads.
It blends softly into the photo at the airfield fence, so the parked aircraft and cars in the photo no longer show.

## Navigation

**Direct to** in the bottom bar picks a destination airport (`src/nav.ts`). You then get:
- a magenta course line on the moving map, with distance, magnetic course and ETE
- a magenta bearing pointer on the heading indicator
- a marker over the destination in the 3D view, or an arrow at the screen edge when it is out of view
- a hint to join the circuit and call the station once you are within 4 NM

**M** cycles the map: small, big, and wide (60 km).

## Buildings

`src/world/buildings.ts` and `src/world/building-textures.ts` build the villages from procedural textures:
- plaster walls with a window per 4 m per floor, and corrugated metal on hangars and barns
- clay-tile roofs: hip roofs on squarish houses, gables with plaster ends on longer ones, roof overhangs and chimneys
- low-pitch metal roofs on hangars, gravel flat roofs with parapets
- church towers with spires
- castles (`historic=castle`, for example **Konopiště**, a landmark on the LKBE circuit): realistic height, steep tiled roofs that rise from the outer and courtyard walls to the ridge, and round corner towers with conical roofs
- courtyards: inner rings of OSM multipolygons keep their holes and their walls

The same builder is used for every baked island and for the streamed villages.

## ATC: the controller is watching

`src/atc-monitor.ts` compares what you do with what you were told, and the controller calls you on frequency when you deviate.
The radio box flashes amber, and each violation goes into the debrief. It watches for:
- leaving the cleared taxi route, or taxiing too fast
- entering the runway in use before reporting ready
- taking off without clearance (at LKPR: "STOP, STOP, STOP")
- lining up on the wrong runway or in the wrong direction
- flying the circuit on the wrong side, or more than 300 ft off circuit altitude
- leaving the circuit area without reporting
- landing on the wrong runway, or not vacating it

After 4 calls the controller tells you to contact the duty instructor after landing.
On screen, ordinary radio messages fade out after about 20 s. Warnings stay up only while the problem lasts:
they clear about 2 s after you fix it, or when that phase of the flight is over. Calls are spoken with the browser's built-in voices,
in ICAO-style phraseology (`src/voice.ts`): phonetic registrations, digit-by-digit runways and QNH, "niner". **V** turns the voice on or off.

## Easter egg 👵

Fly below circuit altitude (under ~2400 ft) within about 400 m of **Tisem** (the village 3 km WNW of the field) and Benešov RADIO passes on a complaint
from the Tisem granny. Do it again and the police are called. When you come back near LKBE, a police car chases you across the airfield with its siren on.
If it catches you on the ground (you are slower than about 15 kt), the sim freezes in grey and shows **BUSTED**, with a fine and an arrest call in English.
The logic is in `src/jokes.ts` and the pursuit in `PoliceChase` (`src/world/police.ts`). Backspace clears it all.

## Code map

- `src/sim/fdm.ts`: rigid-body flight model (aero, engine, wheels, crash checks)
- `src/sim/p2002.ts`: aircraft numbers and the low-poly model
- `src/lesson.ts`: the lesson flow and radio calls (callsign `OK-SIM`)
- `src/airport/`: layout, taxi routing, 3D airfield objects
- `src/world/`: terrain tiles, buildings, sky
- `src/ui/`: instrument panel, moving map, HUD

## Rebuilding the data

The raw downloads live in `raw/`, which git ignores. The processed files in `public/data/` (about 25 MB) are committed.

```bash
node scripts/fetch-osm.mjs raw/osm/region.json   # Overpass extract
node scripts/fetch-cuzk.mjs                       # ortho tiles + DEM
node scripts/build-data.mjs raw                   # -> public/data/*
node --import tsx scripts/fdm-test.ts             # headless physics checks
```

## Licences and attribution

- Orthophoto and DMR 5G: © ČÚZK, CC BY 4.0
- Map data: © OpenStreetMap contributors, ODbL (vector tiles via OpenFreeMap)
- Streamed elevation: Terrarium tiles (Mapzen / AWS Open Data)
- Aerodrome data: AIP/VFR Manual, ŘLP ČR
- Tecnam P2002 Sierra 3D model: © Emmanuel Baranger (helijah), FlightGear FGAddon, GPL v2+

Keep the in-app credit line if you publish it.

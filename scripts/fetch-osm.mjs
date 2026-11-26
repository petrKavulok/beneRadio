// Fetch an OpenStreetMap extract (buildings, roads, landuse, water, aeroway, places)
// for the sim region via Overpass. Usage: node scripts/fetch-osm.mjs <outFile>
import { writeFile } from 'node:fs/promises';
import { REGION } from './config.mjs';

const out = process.argv[2] ?? 'raw/osm/region.json';
const b = `${REGION.s},${REGION.w},${REGION.n},${REGION.e}`;
const q = `[out:json][timeout:300];
(
  way["building"](${b});
  relation["building"](${b});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track|living_street)$"](${b});
  way["railway"="rail"](${b});
  way["landuse"~"^(forest|residential|farmyard|industrial|meadow|orchard|allotments)$"](${b});
  way["natural"~"^(wood|water|scrub)$"](${b});
  relation["natural"~"^(wood|water)$"](${b});
  relation["landuse"="forest"](${b});
  way["waterway"~"^(river|stream)$"](${b});
  way["aeroway"](${b});
  node["aeroway"](${b});
  node["place"~"^(town|village|hamlet|suburb)$"](${b});
  way["power"="line"](${b});
  node["man_made"~"^(tower|mast|water_tower)$"](${b});
  node["natural"="tree"](${b});
);
out geom qt;`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
let res;
for (let attempt = 0; attempt < 6; attempt++) {
  const url = ENDPOINTS[attempt % ENDPOINTS.length];
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'lkbe-sim-data-fetch/0.1' },
      body: 'data=' + encodeURIComponent(q),
    });
    if (res.ok) break;
    console.warn(`${url} -> ${res.status}`);
  } catch (e) { console.warn(`${url} -> ${e.message}`); }
  res = undefined;
  await new Promise((r) => setTimeout(r, 5000 * 2 ** Math.floor(attempt / ENDPOINTS.length)));
}
if (!res) throw new Error('all Overpass endpoints failed');
const txt = await res.text();
await writeFile(out, txt);
const j = JSON.parse(txt);
console.log(`wrote ${out}: ${(txt.length / 1e6).toFixed(1)} MB, ${j.elements.length} elements`);

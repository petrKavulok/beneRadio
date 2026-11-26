// Fetch raw data for a detail island: OSM extract, ČÚZK DMR 5G, ČÚZK orthophoto tiles.
// Usage: node scripts/fetch-island.mjs LKPM
import { writeFile, mkdir } from 'node:fs/promises';
import { islandBox } from './islands.mjs';
import { bboxDeg, toLocal } from './config.mjs';

const id = process.argv[2];
const box = islandBox(id);
const raw = `raw/${id}`, pub = `public/data/${id}`;
await mkdir(`${raw}`, { recursive: true });
await mkdir(`${pub}/ortho`, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, opts, kind = 'json') {
  for (let i = 0; i < 6; i++) {
    try { const r = await fetch(url, opts); if (r.ok) return kind === 'json' ? r.json() : kind === 'text' ? r.text() : Buffer.from(await r.arrayBuffer()); console.warn(url.slice(0, 60), r.status); }
    catch (e) { console.warn(url.slice(0, 60), e.message); }
    await sleep(3000 * (i + 1));
  }
  throw new Error('failed ' + url);
}

// ---- OSM ----
const b = bboxDeg(box.x0, box.z0, box.x1, box.z1);
const bb = `${b.s},${b.w},${b.n},${b.e}`;
const q = `[out:json][timeout:300];
(
  way["building"](${bb}); relation["building"](${bb});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track|living_street)$"](${bb});
  way["landuse"~"^(forest|residential|industrial)$"](${bb}); way["natural"="wood"](${bb});
  relation["natural"="wood"](${bb}); relation["landuse"="forest"](${bb});
  way["aeroway"](${bb}); node["aeroway"](${bb}); relation["aeroway"](${bb});
  node["place"~"^(town|village|hamlet|suburb)$"](${bb});
);
out geom qt;`;
const EP = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
let osm;
for (let i = 0; i < 9 && !osm; i++) {
  try {
    const r = await fetch(EP[i % EP.length], { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'lkbe-sim-data-fetch/0.1' }, body: 'data=' + encodeURIComponent(q) });
    if (r.ok) osm = await r.text(); else console.warn('overpass', r.status);
  } catch (e) { console.warn('overpass', e.message); }
  if (!osm) await sleep(5000 * (1 + Math.floor(i / 3)));
}
if (!osm) throw new Error('overpass failed');
await writeFile(`${raw}/osm.json`, osm);
console.log(`${id} osm ${(osm.length / 1e6).toFixed(1)} MB`);

// ---- ČÚZK ----
const ORTHO = 'https://ags.cuzk.cz/arcgis1/rest/services/ORTOFOTO/MapServer/export';
const DEM = 'https://ags.cuzk.cz/arcgis2/rest/services/dmr5g/ImageServer/exportImage';
async function exportImg(base, bb, W, extra, file) {
  const H = Math.round((W * (bb.n - bb.s)) / (bb.e - bb.w));
  const j = await get(`${base}?bbox=${bb.w},${bb.s},${bb.e},${bb.n}&bboxSR=4326&imageSR=4326&size=${W},${H}&${extra}&f=json`);
  await writeFile(file, await get(j.href, undefined, 'buf'));
  const ex = j.extent;
  const [x0, z0] = toLocal(ex.ymax, ex.xmin), [x1, z1] = toLocal(ex.ymin, ex.xmax);
  return { x0, z0, x1, z1, w: j.width, h: j.height };
}
const demW = Math.min(4000, Math.round(box.size / (box.demRes ?? 5) / Math.cos(box.arp[0] * Math.PI / 180))); // ~5 m (or demRes) in y
const dem = await exportImg(DEM, b, demW, 'format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation', `${raw}/dem.tif`);
console.log(`${id} dem ${dem.w}x${dem.h}`);

const tiles = [];
const jobs = [];
for (let row = 0; row < box.tiles; row++) for (let col = 0; col < box.tiles; col++) jobs.push({ col, row });
async function worker() {
  while (jobs.length) {
    const { col, row } = jobs.shift();
    const x0 = box.x0 + col * 2000, z0 = box.z0 + row * 2000;
    const near = Math.hypot(x0 + 1000 - box.cx, z0 + 1000 - box.cz) < 2600;
    const file = `ortho/t_${col}_${row}.jpg`;
    const ex = await exportImg(ORTHO, bboxDeg(x0, z0, x0 + 2000, z0 + 2000), near ? 2048 : 1024, 'format=jpg&transparent=false', `${pub}/${file}`);
    tiles.push({ col, row, ring: near ? 0 : 2, file, ...ex, tx0: x0, tz0: z0 });
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
tiles.sort((a, b2) => a.row - b2.row || a.col - b2.col);
await writeFile(`${raw}/fetch-manifest.json`, JSON.stringify({ dem, tiles }, null, 1));
console.log(`${id} ortho ${tiles.length} tiles done`);

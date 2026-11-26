// Convert raw downloads into compact runtime files in public/data/.
// Usage: node scripts/build-data.mjs <rawDir>   (default: raw)
import { readFile, writeFile } from 'node:fs/promises';
import { fromFile } from 'geotiff';
import { toLocal, HALF } from './config.mjs';
import { forestMask, buildBuildings } from './osm-features.mjs';

const raw = process.argv[2] ?? 'raw';
const fm = JSON.parse(await readFile(`${raw}/cuzk/fetch-manifest.json`, 'utf8'));
const out = 'public/data';

// ---- DEM: Uint16, h = v / 20 + 150 (5 cm steps) ----
async function dem(name) {
  const img = await (await fromFile(`${raw}/cuzk/dem_${name}.tif`)).getImage();
  const [r] = await img.readRasters();
  const w = img.getWidth(), h = img.getHeight();
  const u = new Uint16Array(w * h);
  let mn = 1e9, mx = -1e9, bad = 0;
  for (let i = 0; i < r.length; i++) {
    let v = r[i];
    if (!(v > 100 && v < 2000)) { bad++; v = 400; }
    mn = Math.min(mn, v); mx = Math.max(mx, v);
    u[i] = Math.round((v - 150) * 20);
  }
  await writeFile(`${out}/dem_${name}.bin`, Buffer.from(u.buffer));
  console.log(`dem ${name}: ${w}x${h} min ${mn.toFixed(1)} max ${mx.toFixed(1)} bad ${bad}`);
  return { ...fm.dem[name], w, h, file: `dem_${name}.bin` };
}
const demOuter = await dem('outer');
const demInner = await dem('inner');

// ---- OSM ----
const osm = JSON.parse(await readFile(`${raw}/osm/region.json`, 'utf8'));
const forest = forestMask(osm.elements, 10);
await writeFile(`${out}/forest.bin`, Buffer.from(forest.bits.buffer));
console.log(`forest mask ${forest.n}x${forest.n}, ${(forest.cover * 100).toFixed(1)} % cover`);

const buildings = buildBuildings(osm.elements);
await writeFile(`${out}/buildings.json`, JSON.stringify(buildings));
console.log(`buildings: ${buildings.length}`);

const places = [];
for (const e of osm.elements) {
  const t = e.tags ?? {};
  if (e.type === 'node' && t.place && t.name) {
    const [x, z] = toLocal(e.lat, e.lon);
    if (Math.abs(x) < HALF && Math.abs(z) < HALF) places.push({ n: t.name, t: t.place, x: Math.round(x), z: Math.round(z) });
  }
}
await writeFile(`${out}/places.json`, JSON.stringify(places));
console.log(`places: ${places.length}`);

// ---- airfield ground: aerodrome boundary + nearby roads/tracks ----
const AF = { x0: -800, z0: -520, x1: 720, z1: 620 };
const inAF = ([x, z]) => x > AF.x0 && x < AF.x1 && z > AF.z0 && z < AF.z1;
const airfield = { box: AF, boundary: [], roads: [] };
for (const e of osm.elements) {
  const t = e.tags ?? {};
  if (!e.geometry) continue;
  const pts = e.geometry.map((p) => toLocal(p.lat, p.lon).map((v) => Math.round(v * 10) / 10));
  if (t.aeroway === 'aerodrome') airfield.boundary = pts;
  else if (t.highway && pts.some(inAF)) airfield.roads.push({ t: t.highway, s: t.surface ?? '', pts });
}
await writeFile(`${out}/airfield.json`, JSON.stringify(airfield));
console.log(`airfield: boundary ${airfield.boundary.length} pts, ${airfield.roads.length} roads`);

const manifest = {
  origin: { lat: 49.74083, lon: 14.64472 },
  half: HALF,
  dem: { outer: demOuter, inner: demInner },
  forest: { file: 'forest.bin', n: forest.n, cell: forest.cell },
  tiles: fm.tiles.map(({ col, row, ring, file, x0, z0, x1, z1 }) => ({ col, row, ring, file, x0, z0, x1, z1 })),
};
await writeFile(`${out}/manifest.json`, JSON.stringify(manifest));
console.log('manifest written');

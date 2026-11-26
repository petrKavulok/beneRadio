// Build runtime files for a detail island: node scripts/build-island.mjs LKPM
import { readFile, writeFile } from 'node:fs/promises';
import { fromFile } from 'geotiff';
import { toLocal } from './config.mjs';
import { islandBox } from './islands.mjs';
import { forestMask, buildBuildings, joinRings } from './osm-features.mjs';

const id = process.argv[2];
const box = islandBox(id);
const raw = `raw/${id}`, out = `public/data/${id}`;
const fm = JSON.parse(await readFile(`${raw}/fetch-manifest.json`, 'utf8'));

// DEM -> Uint16 (h = v/20 + 150)
const img = await (await fromFile(`${raw}/dem.tif`)).getImage();
const [r] = await img.readRasters();
const u = new Uint16Array(r.length);
let mn = 1e9, mx = -1e9;
for (let i = 0; i < r.length; i++) { let v = r[i]; if (!(v > 100 && v < 2000)) v = 380; mn = Math.min(mn, v); mx = Math.max(mx, v); u[i] = Math.round((v - 150) * 20); }
await writeFile(`${out}/dem.bin`, Buffer.from(u.buffer));
console.log(`${id} dem ${img.getWidth()}x${img.getHeight()} ${mn.toFixed(0)}..${mx.toFixed(0)} m`);

const osm = JSON.parse(await readFile(`${raw}/osm.json`, 'utf8'));
const forest = forestMask(osm.elements, 10, { x0: box.x0, z0: box.z0, size: box.size });
await writeFile(`${out}/forest.bin`, Buffer.from(forest.bits.buffer));
const blds = buildBuildings(osm.elements, [box.cx, box.cz], box.fixLevels);
await writeFile(`${out}/buildings.json`, JSON.stringify(blds));
console.log(`${id} forest ${(forest.cover * 100).toFixed(1)} %, buildings ${blds.length}`);

const L = (g) => g.map((p) => toLocal(p.lat, p.lon).map((v) => Math.round(v * 10) / 10));
const places = [], ap = { runways: [], taxiways: [], aprons: [], holds: [], stands: [], windsocks: [], boundary: [], roads: [], buildingsAero: [] };
for (const e of osm.elements) {
  const t = e.tags ?? {};
  if (e.type === 'node' && t.place && t.name) { const [x, z] = toLocal(e.lat, e.lon); places.push({ n: t.name, t: t.place, x: Math.round(x), z: Math.round(z) }); }
  if (e.type === 'node' && t.aeroway) {
    const p = toLocal(e.lat, e.lon).map((v) => Math.round(v * 10) / 10);
    if (t.aeroway === 'holding_position') ap.holds.push({ ref: t.ref ?? t.name ?? '', pos: p, cat: t['holding_position:type'] ?? '' });
    if (t.aeroway === 'parking_position') ap.stands.push({ ref: t.ref ?? t.name ?? '', pos: p });
    if (t.aeroway === 'windsock') ap.windsocks.push(p);
  }
  if (e.type === 'relation' && t.aeroway === 'aerodrome' && e.members) {
    const rings = joinRings(e.members.filter((m) => m.role === 'outer' && m.geometry?.length > 1).map((m) => L(m.geometry)));
    const big = rings.sort((a, b2) => b2.length - a.length)[0];
    if (big && big.length > ap.boundary.length) ap.boundary = big;
  }
  if (!e.geometry) continue;
  const pts = L(e.geometry);
  if (t.aeroway === 'runway') ap.runways.push({ ref: t.ref ?? '', width: parseFloat(t.width) || 30, surface: t.surface ?? '', pts });
  else if (t.aeroway === 'taxiway' || t.aeroway === 'taxilane') ap.taxiways.push({ ref: t.ref ?? t.name ?? '', width: parseFloat(t.width) || 0, surface: t.surface ?? '', kind: t.aeroway, pts }); // 0 = not tagged
  else if (t.aeroway === 'apron') ap.aprons.push({ surface: t.surface ?? '', pts });
  else if (t.aeroway === 'holding_position') ap.holds.push({ ref: t.ref ?? '', pos: pts[Math.floor(pts.length / 2)], line: pts, cat: '' });
  else if (t.aeroway === 'parking_position') ap.stands.push({ ref: t.ref ?? '', pos: pts[0] });
  else if (t.aeroway === 'aerodrome' && pts.length > ap.boundary.length) ap.boundary = pts;
  else if (t.highway) ap.roads.push({ t: t.highway, s: t.surface ?? '', pts });
}
// merge runway ways that share a ref: keep the two extreme points along the runway axis
const byRef = new Map();
for (const r of ap.runways) { const k = r.ref; if (!byRef.has(k)) byRef.set(k, []); byRef.get(k).push(r); }
ap.runways = [...byRef.values()].map((list) => {
  const pts = list.flatMap((r) => r.pts);
  let best = [pts[0], pts[1]], bd = -1;
  for (const a of pts) for (const b2 of pts) { const d = Math.hypot(a[0] - b2[0], a[1] - b2[1]); if (d > bd) { bd = d; best = [a, b2]; } }
  return { ...list[0], width: Math.max(...list.map((r) => r.width)), pts: best };
});
await writeFile(`${out}/airport.json`, JSON.stringify(ap));
await writeFile(`${out}/places.json`, JSON.stringify(places));
console.log(`${id} airport: ${ap.runways.length} rwy, ${ap.taxiways.length} twy, ${ap.aprons.length} aprons, ${ap.holds.length} holds, ${ap.stands.length} stands, boundary ${ap.boundary.length}`);

await writeFile(`${out}/manifest.json`, JSON.stringify({
  id, name: box.name, box: { x0: box.x0, z0: box.z0, x1: box.x1, z1: box.z1, cx: box.cx, cz: box.cz },
  dem: { ...fm.dem, file: 'dem.bin' },
  forest: { file: 'forest.bin', n: forest.n, cell: forest.cell, x0: box.x0, z0: box.z0 },
  tiles: fm.tiles.map(({ col, row, ring, file, x0, z0, x1, z1, tx0, tz0 }) => ({ col, row, ring, file, x0, z0, x1, z1, tx0, tz0 })),
}));
console.log(`${id} manifest written`);

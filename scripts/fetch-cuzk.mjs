// Fetch ČÚZK orthophoto tiles and DMR 5G elevation for the sim region.
// Ortho -> public/data/ortho/t_<col>_<row>.jpg (+ manifest), DEM -> raw/cuzk/dem_*.tif
// Usage: node scripts/fetch-cuzk.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { TILE_M, TILES, HALF, bboxDeg, toLocal } from './config.mjs';

const ORTHO = 'https://ags.cuzk.cz/arcgis1/rest/services/ORTOFOTO/MapServer/export';
const DEM = 'https://ags.cuzk.cz/arcgis2/rest/services/dmr5g/ImageServer/exportImage';
const C = (TILES - 1) / 2;

async function getJson(url) {
  for (let i = 0; i < 5; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); console.warn('HTTP', r.status); }
    catch (e) { console.warn(e.message); }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error('failed ' + url);
}
async function download(url, file) {
  for (let i = 0; i < 5; i++) {
    try { const r = await fetch(url); if (r.ok) { await writeFile(file, Buffer.from(await r.arrayBuffer())); return; } }
    catch (e) { console.warn(e.message); }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error('failed ' + url);
}
// Export an image whose pixel grid is square in degrees (ArcGIS otherwise widens the bbox);
// returns the extent the server actually used, in local metres.
async function exportImg(base, bb, W, extra, file) {
  const H = Math.round((W * (bb.n - bb.s)) / (bb.e - bb.w));
  const q = `bbox=${bb.w},${bb.s},${bb.e},${bb.n}&bboxSR=4326&imageSR=4326&size=${W},${H}&${extra}&f=json`;
  const j = await getJson(`${base}?${q}`);
  await download(j.href, file);
  const ex = j.extent;
  const [x0, z0] = toLocal(ex.ymax, ex.xmin);
  const [x1, z1] = toLocal(ex.ymin, ex.xmax);
  return { x0, z0, x1, z1, w: j.width, h: j.height };
}

await mkdir('public/data/ortho', { recursive: true });
await mkdir('raw/cuzk', { recursive: true });

// --- DEM: outer (whole region) + inner (5 x 5 km around ARP) ---
const dem = {};
dem.outer = await exportImg(DEM, bboxDeg(-HALF, -HALF, HALF, HALF), 2168,
  'format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation', 'raw/cuzk/dem_outer.tif');
console.log('dem outer', dem.outer);
dem.inner = await exportImg(DEM, bboxDeg(-2500, -2500, 2500, 2500), 1548,
  'format=tiff&pixelType=F32&interpolation=RSP_BilinearInterpolation', 'raw/cuzk/dem_inner.tif');
console.log('dem inner', dem.inner);

// --- Ortho tiles: resolution by ring distance from the centre tile ---
const jobs = [];
for (let row = 0; row < TILES; row++) for (let col = 0; col < TILES; col++) jobs.push({ col, row });
const tiles = [];
let done = 0;
async function worker() {
  while (jobs.length) {
    const { col, row } = jobs.shift();
    const ring = Math.max(Math.abs(col - C), Math.abs(row - C));
    const W = ring <= 1 ? 2048 : ring === 2 ? 1024 : 512;
    const x0 = -HALF + col * TILE_M, z0 = -HALF + row * TILE_M;
    const name = `t_${col}_${row}.jpg`;
    const file = `public/data/ortho/${name}`;
    const ex = await exportImg(ORTHO, bboxDeg(x0, z0, x0 + TILE_M, z0 + TILE_M), W,
      'format=jpg&transparent=false', file);
    tiles.push({ col, row, ring, file: `ortho/${name}`, ...ex });
    if (++done % 10 === 0) console.log(`ortho ${done}/${TILES * TILES}`);
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
tiles.sort((a, b) => a.row - b.row || a.col - b.col);
await writeFile('raw/cuzk/fetch-manifest.json', JSON.stringify({ dem, tiles }, null, 1));
console.log('done', existsSync('raw/cuzk/dem_outer.tif'));

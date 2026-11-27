// Runtime access to baked geo data (detail islands: LKBE region + airport islands) and,
// outside them, to the streamed terrain. World frame: origin LKBE ARP, +x east, +z south (m).
import type { Rect } from './geo';

export interface Extent { x0: number; z0: number; x1: number; z1: number }
export interface DemInfo extends Extent { w: number; h: number; file: string }
export interface TileInfo extends Extent { col: number; row: number; ring: number; file: string; tx0: number; tz0: number }

export const CANOPY = 19; // forest canopy height above ground (m)
const BASE = import.meta.env.BASE_URL + 'data/';

class Grid {
  dx: number; dz: number;
  constructor(public info: DemInfo, public h: Float32Array) {
    this.dx = (info.x1 - info.x0) / info.w; this.dz = (info.z1 - info.z0) / info.h;
  }
  contains(x: number, z: number, m: number) { const i = this.info; return x > i.x0 + m && x < i.x1 - m && z > i.z0 + m && z < i.z1 - m; }
  sample(x: number, z: number) {
    const { w, h } = this.info;
    let fx = (x - this.info.x0) / this.dx - 0.5, fz = (z - this.info.z0) / this.dz - 0.5;
    fx = Math.min(Math.max(fx, 0), w - 1.001); fz = Math.min(Math.max(fz, 0), h - 1.001);
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, a = this.h, o = iz * w + ix;
    return (a[o] * (1 - tx) + a[o + 1] * tx) * (1 - tz) + (a[o + w] * (1 - tx) + a[o + w + 1] * tx) * tz;
  }
}

async function bin(path: string) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`load ${path}: ${r.status}`);
  return r.arrayBuffer();
}
async function grid(dir: string, info: DemInfo) {
  const u = new Uint16Array(await bin(dir + info.file));
  const f = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) f[i] = u[i] / 20 + 150;
  return new Grid(info, f);
}

/** One baked area with its own elevation, forest mask and orthophoto tiles. */
export class Region {
  grids: Grid[] = [];
  forest!: Uint8Array;
  constructor(public id: string, public dir: string, public box: Rect, public tiles: TileInfo[],
    public forestInfo: { file: string; n: number; cell: number; x0: number; z0: number }) {}

  contains(x: number, z: number, m = 0) { return x > this.box.x0 + m && x < this.box.x1 - m && z > this.box.z0 + m && z < this.box.z1 - m; }
  heightAt(x: number, z: number) {
    for (const g of this.grids) if (g.contains(x, z, 30)) return g.sample(x, z);
    return this.grids[this.grids.length - 1].sample(x, z);
  }
  forestAt(x: number, z: number) {
    const { n, cell, x0, z0 } = this.forestInfo;
    const c = Math.floor((x - x0) / cell), r = Math.floor((z - z0) / cell);
    if (c < 0 || r < 0 || c >= n || r >= n) return 0;
    const i = r * n + c;
    return (this.forest[i >> 3] >> (i & 7)) & 1;
  }
  forestSmooth(x: number, z: number) {
    const { cell, x0, z0 } = this.forestInfo;
    const fx = (x - x0) / cell - 0.5, fz = (z - z0) / cell - 0.5;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const s = (c: number, r: number) => this.forestAt(x0 + (c + 0.5) * cell, z0 + (r + 0.5) * cell);
    return (s(ix, iz) * (1 - tx) + s(ix + 1, iz) * tx) * (1 - tz) + (s(ix, iz + 1) * (1 - tx) + s(ix + 1, iz + 1) * tx) * tz;
  }
}

export interface HeightSource { heightAt(x: number, z: number): number | null }

export class GeoData {
  regions: Region[] = [];
  stream: HeightSource | null = null;
  private last: Region | null = null;

  static async load(progress: (s: string, f?: number) => void, islands: string[]) {
    const g = new GeoData();
    progress('Loading elevation (ČÚZK DMR 5G)…', 0.04);
    // LKBE region (original layout in data/)
    const m = await (await fetch(BASE + 'manifest.json')).json();
    const half = m.half as number;
    const lkbe = new Region('LKBE', '', { x0: -half, z0: -half, x1: half, z1: half },
      m.tiles.map((t: TileInfo) => ({ ...t, tx0: -half + t.col * 2000, tz0: -half + t.row * 2000 })),
      { ...m.forest, x0: -half, z0: -half });
    lkbe.grids = await Promise.all([grid('', m.dem.inner), grid('', m.dem.outer)]);
    lkbe.forest = new Uint8Array(await bin(m.forest.file));
    g.regions.push(lkbe);
    // airport islands
    for (const id of islands) {
      try {
        const im = await (await fetch(`${BASE}${id}/manifest.json`)).json();
        const r = new Region(id, `${id}/`, im.box, im.tiles, im.forest);
        r.grids = [await grid(`${id}/`, im.dem)];
        r.forest = new Uint8Array(await bin(`${id}/${im.forest.file}`));
        g.regions.push(r);
      } catch (e) { console.warn('island not available', id, e); }
    }
    return g;
  }

  region(x: number, z: number, margin = 0) {
    if (this.last?.contains(x, z, margin)) return this.last;
    const r = this.regions.find((q) => q.contains(x, z, margin)) ?? null;
    if (r) this.last = r;
    return r;
  }
  /** Bare-earth ground height (m AMSL). */
  heightAt(x: number, z: number) {
    const r = this.region(x, z, 20);
    if (r) return r.heightAt(x, z);
    const s = this.stream?.heightAt(x, z);
    if (s != null) return s;
    const near = this.regions.find((q) => q.contains(x, z, -200));
    return near ? near.heightAt(x, z) : 400;
  }
  forestSmooth(x: number, z: number) { const r = this.region(x, z); return r ? r.forestSmooth(x, z) : 0; }
  /** Top of obstacles (ground + canopy) for crash checks. */
  surfaceAt(x: number, z: number) { return this.heightAt(x, z) + this.forestSmooth(x, z) * CANOPY; }
  islandRects(): Rect[] { return this.regions.map((r) => r.box); }
}

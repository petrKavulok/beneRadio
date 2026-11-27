import { later } from './budget';
// Streamed villages outside the baked islands: OSM buildings and place names from
// OpenFreeMap vector tiles (OpenMapTiles schema), built around the camera as you fly.
import * as THREE from 'three';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { tileXY, tileLatLon, toLocal, Rect } from './geo';
import { buildBuildings, Bld } from './buildings';
import type { GeoData } from './data';
import type { Place } from '../ui/map';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const BZ = 14, BUILD_RADIUS = 4500, KEEP_RADIUS = 7000, PZ = 10;

interface BTile { key: string; x: number; y: number; state: 'loading' | 'ready' | 'failed' | 'waiting'; group?: THREE.Group; centre: [number, number] }

export class StreamedVillages {
  group = new THREE.Group();
  private url: string | null = null;
  private tiles = new Map<string, BTile>();
  private placeTiles = new Set<string>();
  private loading = 0;
  private t = 0;

  constructor(private geo: GeoData, private islands: Rect[], private places: Place[], private groundReady: (x: number, z: number) => boolean) {
    this.group.name = 'streamed-villages';
    fetch(TILEJSON).then((r) => r.json()).then((j) => { this.url = j.tiles[0]; }).catch((e) => console.warn('OpenFreeMap unavailable', e));
  }

  private inIsland(x: number, z: number) { return this.islands.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1); }

  update(cam: THREE.Vector3, dt: number, agl: number) {
    this.t += dt;
    if (!this.url || this.t < 0.5) return;
    this.t = 0;
    const [lat, lon] = toLatLonLocal(cam.x, cam.z);
    // place names from low-zoom tiles (3 x 3 around the camera)
    const [px, py] = tileXY(lat, lon, PZ);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) this.loadPlaces(Math.floor(px) + dx, Math.floor(py) + dy);
    // buildings only when reasonably low (they are invisible from high up anyway)
    const [bx, by] = tileXY(lat, lon, BZ);
    const want: { x: number; y: number; d: number }[] = [];
    if (agl < 3500) {
      const r = 4;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(bx) + dx, y = Math.floor(by) + dy;
        const [la, lo] = tileLatLon(x + 0.5, y + 0.5, BZ), [cx, cz] = toLocal(la, lo);
        const d = Math.hypot(cx - cam.x, cz - cam.z);
        if (d < BUILD_RADIUS && !this.inIsland(cx, cz)) want.push({ x, y, d });
      }
    }
    want.sort((a, b) => a.d - b.d);
    for (const w of want) {
      if (this.loading >= 3) break;
      const key = `${w.x}/${w.y}`;
      const t = this.tiles.get(key);
      if (t && t.state !== 'waiting') continue;
      const [la, lo] = tileLatLon(w.x + 0.5, w.y + 0.5, BZ), c = toLocal(la, lo);
      if (!this.groundReady(c[0], c[1])) { this.tiles.set(key, { key, x: w.x, y: w.y, state: 'waiting', centre: c }); continue; }
      this.loadBuildings({ key, x: w.x, y: w.y, state: 'loading', centre: c });
    }
    // unload far tiles
    for (const [k, t] of this.tiles) {
      if (Math.hypot(t.centre[0] - cam.x, t.centre[1] - cam.z) > KEEP_RADIUS) {
        if (t.group) { this.group.remove(t.group); t.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); } }); }
        if (t.state !== 'loading') this.tiles.delete(k);
      }
    }
  }

  private async fetchTile(z: number, x: number, y: number) {
    const r = await fetch(this.url!.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)));
    if (!r.ok) throw new Error(String(r.status));
    return new VectorTile(new PbfReader(await r.arrayBuffer()));
  }

  private async loadBuildings(t: BTile) {
    this.tiles.set(t.key, t);
    this.loading++;
    try {
      const vt = await this.fetchTile(BZ, t.x, t.y);
      // parsing and geometry building run in the per-frame work budget (towns are split into chunks)
      await new Promise<void>((done) => later(() => { try { this.parseAndBuild(t, vt); } finally { done(); } }));
    } catch (e) { t.state = 'failed'; console.warn('buildings tile', t.key, e); }
    finally { this.loading--; }
  }

  private parseAndBuild(t: BTile, vt: VectorTile) {
    {
      const layer = vt.layers.building;
      const list: Bld[] = [];
      if (layer) for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 3) continue;
        const ext = f.extent;
        const rings = f.loadGeometry();
        const outer = rings[0];
        if (!outer || outer.length < 4) continue;
        const pts: number[] = [];
        let cx = 0, cz = 0;
        for (const p of outer) {
          const [la, lo] = tileLatLon(t.x + p.x / ext, t.y + p.y / ext, BZ);
          const [x, z] = toLocal(la, lo);
          pts.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10); cx += x; cz += z;
        }
        pts.length -= 2; // drop closing point
        cx /= outer.length; cz /= outer.length;
        if (this.inIsland(cx, cz)) continue;
        // area (and CCW orientation as expected by the builder)
        let a = 0;
        for (let k = 0; k < pts.length; k += 2) { const j = (k + 2) % pts.length; a += pts[k] * pts[j + 1] - pts[j] * pts[k + 1]; }
        if (Math.abs(a / 2) < 8) continue;
        if (a < 0) { const rev: number[] = []; for (let k = pts.length - 2; k >= 0; k -= 2) rev.push(pts[k], pts[k + 1]); pts.splice(0, pts.length, ...rev); }
        const area = Math.abs(a / 2);
        const props = f.properties as Record<string, number | string>;
        const h = Number(props.render_height) > 0 ? Math.min(Number(props.render_height), 60) - (Number(props.render_min_height) || 0) : area > 400 ? 8 : 5;
        list.push({ p: pts, h: area < 250 && h < 9 ? 4.5 : h, r: area < 300 && h < 12 ? 1 : 0, k: area > 600 ? 1 : 0 });
      }
      if (list.length) {
        const g = (t.group = new THREE.Group());
        this.group.add(g);
        const CHUNK = 120;
        for (let i = 0; i < list.length; i += CHUNK) {
          const part = list.slice(i, i + CHUNK);
          later(() => { if (t.group === g && g.parent) g.add(buildBuildings(this.geo, part)); });
        }
      }
      t.state = 'ready';
    }
  }

  private async loadPlaces(x: number, y: number) {
    const key = `${x}/${y}`;
    if (this.placeTiles.has(key)) return;
    this.placeTiles.add(key);
    try {
      const vt = await this.fetchTile(PZ, x, y);
      const layer = vt.layers.place;
      if (!layer) return;
      const have = new Set(this.places.map((p) => p.n + Math.round(p.x / 800) + ',' + Math.round(p.z / 800)));
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i), props = f.properties as Record<string, string>;
        const cls = String(props.class ?? '');
        const t = cls === 'city' || cls === 'town' ? 'town' : cls === 'village' ? 'village' : cls === 'hamlet' || cls === 'suburb' ? 'hamlet' : '';
        const name = props['name:cs'] || props.name;
        if (!t || !name) continue;
        const p = f.loadGeometry()[0][0];
        const [la, lo] = tileLatLon(x + p.x / f.extent, y + p.y / f.extent, PZ);
        const [px, pz] = toLocal(la, lo);
        const k = name + Math.round(px / 800) + ',' + Math.round(pz / 800);
        if (have.has(k)) continue;
        have.add(k);
        this.places.push({ n: name, t, x: Math.round(px), z: Math.round(pz) });
      }
    } catch (e) { console.warn('places tile', key, e); }
  }
}

import { toLatLon as toLatLonLocal } from './geo';

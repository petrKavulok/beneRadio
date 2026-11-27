import { ELEV_CACHE, LOW_MEM } from '../quality';
// how long an out-of-view tile is kept (frames) and the most tiles kept loaded; phones are much stricter
const KEEP_FRAMES = LOW_MEM ? 120 : 600, MAX_READY = LOW_MEM ? 220 : 900;
import { later } from './budget';
// Streamed Czech-wide terrain: quadtree of Web-Mercator tiles around the camera.
// Height: Terrarium elevation tiles (AWS open data). Texture: ČÚZK orthophoto (ORTOFOTO_WM).
// Tiles are not drawn inside the baked detail islands (shader discard), which keep their own data.
import * as THREE from 'three';
import { tileXY, tileLatLon, toLatLon, tileLocal, CZ_BOUNDS, Rect } from './geo';

const ORTHO_URL = (z: number, x: number, y: number) => `https://ags.cuzk.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/${z}/${y}/${x}`;
const ELEV_URL = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const ROOT_Z = 8, MAX_Z = LOW_MEM ? 16 : 17, ELEV_MAX_Z = 12, SEG = 24, MAX_LOADS = 6, VIEW_RANGE = 42000;

interface Node {
  z: number; x: number; y: number; key: string;
  rect: Rect;               // local-metre bounds
  size: number;             // approx edge length (m)
  state: 'none' | 'loading' | 'ready' | 'failed';
  mesh?: THREE.Mesh;
  mapImg?: CanvasImageSource; // small copy for the moving map (phones drop the full photo after upload)
  heights?: Float32Array;   // (SEG+1)^2 grid heights
  kids?: Node[];
  used: number;             // last frame shown/needed
  excluded: boolean;        // fully inside a baked island
}

type Elev = { z: number; x: number; y: number; h: Float32Array };

export class StreamedTerrain {
  group = new THREE.Group();
  private roots: Node[] = [];
  private queue = new Set<Node>();
  private loading = 0;
  private frame = 0;
  private elevCache = new Map<string, Promise<Elev | null>>();
  private shown = new Set<Node>();
  private uniforms: { rects: { value: THREE.Vector4[] }; detail: { value: THREE.Texture | null } };
  // photos are decoded off the main thread (createImageBitmap); Safari would otherwise decode at upload time
  // (kept upright for the moving map; the texture flips it via its UV transform instead of flipY)
  private tl = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'none' });
  private loadTex(url: string): Promise<THREE.Texture | null> {
    return this.tl.loadAsync(url).then((bmp) => {
      const t = new THREE.Texture(bmp as ImageBitmap);
      t.flipY = false; t.repeat.set(1, -1); t.offset.set(0, 1); t.needsUpdate = true;
      return t;
    }).catch(() => null);
  }
  private fallbackTex: THREE.Texture;
  enabled = true;
  stats = { shown: 0, loading: 0, nodes: 0 };

  /** baked ground height at the nearest island edge, for blending streamed heights into it */
  edgeHeight: ((x: number, z: number) => number) | null = null;

  constructor(private renderer: THREE.WebGLRenderer, private islands: Rect[], detail: THREE.Texture | null) {
    this.group.name = 'streamed-terrain';
    this.tl.setCrossOrigin('anonymous');
    const rects = Array.from({ length: 4 }, (_, i) => {
      const r = islands[i];
      // inset so the baked tiles' skirts and edges stay visible; outside islands stream draws
      return r ? new THREE.Vector4(r.x0 + 15, r.z0 + 15, r.x1 - 15, r.z1 - 15) : new THREE.Vector4(1e9, 1e9, 1e9, 1e9);
    });
    this.uniforms = { rects: { value: rects }, detail: { value: detail } };
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const g = c.getContext('2d')!; g.fillStyle = '#6b7a52'; g.fillRect(0, 0, 2, 2);
    this.fallbackTex = new THREE.CanvasTexture(c);
    const [x0, y0] = tileXY(CZ_BOUNDS.n, CZ_BOUNDS.w, ROOT_Z), [x1, y1] = tileXY(CZ_BOUNDS.s, CZ_BOUNDS.e, ROOT_Z);
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) this.roots.push(this.node(ROOT_Z, x, y));
  }

  private node(z: number, x: number, y: number): Node {
    const [ax, az] = tileLocal(x, y, z), [bx, bz] = tileLocal(x + 1, y + 1, z);
    const rect = { x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz) };
    const excluded = this.islands.some((r) => rect.x0 >= r.x0 + 20 && rect.x1 <= r.x1 - 20 && rect.z0 >= r.z0 + 20 && rect.z1 <= r.z1 - 20);
    return { z, x, y, key: `${z}/${x}/${y}`, rect, size: rect.x1 - rect.x0, state: 'none', used: 0, excluded };
  }

  private children(n: Node) {
    if (!n.kids) { const z = n.z + 1, x = n.x * 2, y = n.y * 2; n.kids = [this.node(z, x, y), this.node(z, x + 1, y), this.node(z, x, y + 1), this.node(z, x + 1, y + 1)]; }
    return n.kids;
  }

  private distTo(n: Node, cam: THREE.Vector3, ground: number) {
    const dx = Math.max(n.rect.x0 - cam.x, 0, cam.x - n.rect.x1), dz = Math.max(n.rect.z0 - cam.z, 0, cam.z - n.rect.z1);
    return Math.hypot(dx, dz, Math.max(0, cam.y - ground));
  }

  /** Call every frame with the camera position. */
  update(cam: THREE.Vector3, groundY: number) {
    if (!this.enabled) { this.group.visible = false; return; }
    this.group.visible = true;
    this.frame++;
    const want = new Set<Node>();
    const visit = (n: Node): boolean => {
      const d = this.distTo(n, cam, groundY);
      if (d > VIEW_RANGE || n.excluded) return true;
      n.used = this.frame;
      const split = n.z < MAX_Z && d < n.size * 1.7;
      if (!split) {
        if (n.state === 'ready') { want.add(n); return true; }
        this.request(n, d); return false;
      }
      const kids = this.children(n).filter((k) => this.distTo(k, cam, groundY) <= VIEW_RANGE && !k.excluded);
      for (const k of kids) if (k.state !== 'ready') this.request(k, this.distTo(k, cam, groundY));
      if (kids.every((k) => k.state === 'ready' || k.state === 'failed')) { for (const k of kids) if (k.state === 'ready') visit(k); return true; }
      if (n.state === 'ready') { want.add(n); return true; }
      this.request(n, d); return false;
    };
    for (const r of this.roots) visit(r);
    // show / hide
    for (const n of this.shown) if (!want.has(n)) { if (n.mesh) n.mesh.visible = false; }
    for (const n of want) { n.mesh!.visible = true; n.used = this.frame; }
    this.shown = want;
    this.pump(cam);
    if (this.frame % (LOW_MEM ? 30 : 120) === 0) this.evict();
    this.stats.shown = want.size; this.stats.loading = this.loading;
  }

  private prio = new Map<Node, number>();
  private request(n: Node, d: number) {
    n.used = this.frame;
    if (n.state !== 'none') return;
    this.queue.add(n); this.prio.set(n, d);
  }
  private pump(cam: THREE.Vector3) {
    if (this.loading >= MAX_LOADS || !this.queue.size) return;
    const list = [...this.queue].sort((a, b) => (this.prio.get(a)! - this.prio.get(b)!) || a.z - b.z);
    for (const n of list) {
      if (this.loading >= MAX_LOADS) break;
      this.queue.delete(n); this.prio.delete(n);
      if (n.used < this.frame - 2) continue; // no longer needed
      this.load(n, cam);
    }
    // drop stale requests
    for (const n of this.queue) if (n.used < this.frame - 2) { this.queue.delete(n); this.prio.delete(n); }
  }

  private elevation(z: number, x: number, y: number): Promise<Elev | null> {
    const key = `${z}/${x}/${y}`;
    let p = this.elevCache.get(key);
    if (!p) {
      p = fetch(ELEV_URL(z, x, y)).then(async (r) => {
        if (!r.ok) return null;
        const bmp = await createImageBitmap(await r.blob());
        const c = new OffscreenCanvas(256, 256), g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, 256, 256).data, h = new Float32Array(256 * 256);
        for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        return { z, x, y, h };
      }).catch(() => null);
      this.elevCache.set(key, p);
      while (this.elevCache.size > ELEV_CACHE) this.elevCache.delete(this.elevCache.keys().next().value!);
    }
    return p;
  }

  private async load(n: Node, _cam: THREE.Vector3) {
    n.state = 'loading'; this.loading++;
    let elev: Elev | null = null, tex: THREE.Texture | null = null, ex = 0, ey = 0, f = 1;
    try {
      const ez = Math.min(n.z, ELEV_MAX_Z); f = 2 ** (n.z - ez);
      ex = Math.floor(n.x / f); ey = Math.floor(n.y / f);
      [elev, tex] = await Promise.all([
        this.elevation(ez, ex, ey),
        this.loadTex(ORTHO_URL(n.z, n.x, n.y)),
      ]);
    } catch (e) {
      console.warn('tile failed', n.key, e);
      n.state = 'failed'; this.loading--;
      return;
    }
    // the CPU-heavy part runs in the per-frame work budget
    later(() => this.finish(n, elev, tex, ex, ey, f));
  }

  private finish(n: Node, elev: Elev | null, tex: THREE.Texture | null, ex: number, ey: number, f: number) {
    try {
      const heights = new Float32Array((SEG + 1) ** 2);
      for (let r = 0; r <= SEG; r++) for (let c = 0; c <= SEG; c++) {
        let h = 400;
        if (elev) {
          const px = ((n.x + c / SEG) / f - ex) * 256 - 0.5, py = ((n.y + r / SEG) / f - ey) * 256 - 0.5;
          h = sampleGrid(elev.h, px, py);
        }
        heights[r * (SEG + 1) + c] = this.blendEdge(n, c, r, h);
      }
      n.heights = heights;
      if (tex) {
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); tex.generateMipmaps = true;
        this.renderer.initTexture(tex); // upload now, inside the budget, not in a random later frame
        if (LOW_MEM) {
          // keep only a 128 px copy for the moving map; the full decoded photo is already on the GPU
          const bmp = tex.image as ImageBitmap, c = document.createElement('canvas');
          c.width = c.height = 128; c.getContext("2d")!.drawImage(bmp, 0, 0, 128, 128);
          n.mapImg = c; bmp.close?.();
          tex.image = { width: bmp.width, height: bmp.height } as unknown as ImageBitmap;
        }
      }
      n.mesh = this.buildMesh(n, heights, tex ?? this.fallbackTex);
      n.mesh.visible = false;
      this.group.add(n.mesh);
      n.state = 'ready';
    } catch (e) {
      console.warn('tile failed', n.key, e);
      n.state = 'failed';
    } finally { this.loading--; }
  }

  /** Blend towards the baked island height within 400 m of an island edge (hides the seam). */
  private blendEdge(n: Node, c: number, r: number, h: number) {
    if (!this.edgeHeight) return h;
    const [x, z] = tileLocal(n.x + c / SEG, n.y + r / SEG, n.z);
    for (const q of this.islands) {
      const cx = Math.min(Math.max(x, q.x0), q.x1), cz = Math.min(Math.max(z, q.z0), q.z1);
      const d = Math.hypot(x - cx, z - cz);
      if (d < 400) {
        const ix = Math.min(Math.max(cx, q.x0 + 5), q.x1 - 5), iz = Math.min(Math.max(cz, q.z0 + 5), q.z1 - 5);
        const hb = this.edgeHeight(ix, iz), t = d / 400, k = t * t * (3 - 2 * t);
        return hb + (h - hb) * k;
      }
    }
    return h;
  }

  private buildMesh(n: Node, heights: Float32Array, tex: THREE.Texture) {
    const N = SEG + 1;
    const [cx, cz] = tileLocal(n.x + 0.5, n.y + 0.5, n.z);
    const skirt = 4 * SEG;
    const pos = new Float32Array((N * N + skirt) * 3), uv = new Float32Array((N * N + skirt) * 2);
    const idx: number[] = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const [x, z] = tileLocal(n.x + c / SEG, n.y + r / SEG, n.z), i = r * N + c;
      pos[i * 3] = x - cx; pos[i * 3 + 1] = heights[i]; pos[i * 3 + 2] = z - cz;
      uv[i * 2] = c / SEG; uv[i * 2 + 1] = 1 - r / SEG;
    }
    for (let r = 0; r < SEG; r++) for (let c = 0; c < SEG; c++) { const a = r * N + c, b = a + 1, d = a + N, e = d + 1; idx.push(a, d, b, b, d, e); }
    const ring: number[] = [];
    for (let c = 0; c < SEG; c++) ring.push(c);
    for (let r = 0; r < SEG; r++) ring.push(r * N + SEG);
    for (let c = SEG; c > 0; c--) ring.push(SEG * N + c);
    for (let r = SEG; r > 0; r--) ring.push(r * N);
    const s0 = N * N, drop = Math.max(15, n.size * 0.01);
    ring.forEach((g, k) => {
      const i = s0 + k;
      pos[i * 3] = pos[g * 3]; pos[i * 3 + 1] = pos[g * 3 + 1] - drop; pos[i * 3 + 2] = pos[g * 3 + 2];
      uv[i * 2] = uv[g * 2]; uv[i * 2 + 1] = uv[g * 2 + 1];
    });
    for (let k = 0; k < ring.length; k++) { const g0 = ring[k], g1 = ring[(k + 1) % ring.length], a = s0 + k, b = s0 + ((k + 1) % ring.length); idx.push(g0, g1, a, g1, b, a); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    ring.forEach((gi, k) => nrm.setXYZ(s0 + k, nrm.getX(gi), nrm.getY(gi), nrm.getZ(gi)));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const u = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.islandRects = u.rects;
      sh.vertexShader = 'varying vec2 vWXZ;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = 'uniform vec4 islandRects[4];\nvarying vec2 vWXZ;\n' + sh.fragmentShader.replace('void main() {', `void main() {
        for (int i = 0; i < 4; i++) { vec4 r = islandRects[i]; if (vWXZ.x > r.x && vWXZ.x < r.z && vWXZ.y > r.y && vWXZ.y < r.w) discard; }`);
    };
    mat.customProgramCacheKey = () => 'streamTile';
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, 0, cz);
    m.receiveShadow = false;
    m.matrixAutoUpdate = false; m.updateMatrix();
    m.userData.node = n;
    return m;
  }

  private evict() {
    const all: Node[] = [];
    const walk = (n: Node) => { all.push(n); n.kids?.forEach(walk); };
    this.roots.forEach(walk);
    this.stats.nodes = all.length;
    const drop = (n: Node) => {
      if (n.mesh) {
        this.group.remove(n.mesh); n.mesh.geometry.dispose();
        const mat = n.mesh.material as THREE.MeshLambertMaterial;
        if (mat.map !== this.fallbackTex) { (mat.map?.image as ImageBitmap | undefined)?.close?.(); mat.map?.dispose(); }
        mat.dispose();
      }
      n.mesh = undefined; n.heights = undefined; n.mapImg = undefined; n.state = 'none';
    };
    const spare = all.filter((n) => n.state === 'ready' && !this.shown.has(n) && n.z > ROOT_Z);
    for (const n of spare) if (n.used < this.frame - KEEP_FRAMES) drop(n);
    // hard cap: drop the least recently used spare tiles until under the limit
    const ready = all.filter((n) => n.state === 'ready').length;
    if (ready > MAX_READY) {
      const lru = spare.filter((n) => n.state === 'ready').sort((a, b) => a.used - b.used);
      for (let k = 0; k < ready - MAX_READY && k < lru.length; k++) drop(lru[k]);
    }
    for (const n of all) if (n.kids && n.used < this.frame - 2 * KEEP_FRAMES && n.kids.every((k) => k.state !== 'ready' && k.state !== 'loading' && !k.kids)) n.kids = undefined;
  }

  /** Ground height from the finest shown tile, or null if nothing is loaded there. */
  heightAt(x: number, z: number): number | null {
    let best: Node | null = null;
    for (const n of this.shown) {
      if (x < n.rect.x0 || x > n.rect.x1 || z < n.rect.z0 || z > n.rect.z1) continue;
      if (!best || n.z > best.z) best = n;
    }
    if (!best || !best.heights) return null;
    const [lat, lon] = toLatLon(x, z);
    const [tx, ty] = tileXY(lat, lon, best.z);
    return sampleGrid(best.heights, (tx - best.x) * SEG, (ty - best.y) * SEG, SEG + 1);
  }

  /** Streamed photo tiles for the moving map (image + local rect). */
  mapTiles() {
    const out: { img: CanvasImageSource; x0: number; z0: number; x1: number; z1: number; ring: number }[] = [];
    for (const n of this.shown) {
      const img = n.mapImg ?? (((n.mesh?.material as THREE.MeshLambertMaterial)?.map?.image) as CanvasImageSource | undefined);
      if (img && (img as HTMLImageElement).width > 2) out.push({ img, ...n.rect, ring: 100 - n.z });
    }
    return out;
  }
}

function sampleGrid(h: Float32Array, px: number, py: number, w = 256) {
  px = Math.min(Math.max(px, 0), w - 1.001); py = Math.min(Math.max(py, 0), w - 1.001);
  const ix = px | 0, iy = py | 0, tx = px - ix, ty = py - iy, o = iy * w + ix;
  return (h[o] * (1 - tx) + h[o + 1] * tx) * (1 - ty) + (h[o + w] * (1 - tx) + h[o + w + 1] * tx) * ty;
}
export { tileLatLon };

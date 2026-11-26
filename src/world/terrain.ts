// Terrain tiles: DMR 5G height + forest canopy displacement, textured with ČÚZK orthophoto.
import * as THREE from 'three';
import { GeoData, CANOPY, TileInfo, Region } from './data';

const BASE = import.meta.env.BASE_URL + 'data/';
const TILE_M = 2000;

/** Tile mesh in coordinates relative to the tile origin (tx0, tz0). */
function tileGeometry(reg: Region, t: TileInfo, segs: number) {
  const x0 = t.tx0, z0 = t.tz0;
  const n = segs + 1;
  const skirt = 4 * segs;
  const pos = new Float32Array((n * n + skirt) * 3);
  const uv = new Float32Array((n * n + skirt) * 2);
  const idx: number[] = [];
  const ux = 1 / (t.x1 - t.x0), uz = 1 / (t.z1 - t.z0);
  const put = (i: number, x: number, y: number, z: number) => {
    pos[i * 3] = x - x0; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z - z0;
    uv[i * 2] = (x - t.x0) * ux; uv[i * 2 + 1] = 1 - (z - t.z0) * uz;
  };
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const x = x0 + (c / segs) * TILE_M, z = z0 + (r / segs) * TILE_M;
    put(r * n + c, x, reg.heightAt(x, z) + reg.forestSmooth(x, z) * CANOPY, z);
  }
  for (let r = 0; r < segs; r++) for (let c = 0; c < segs; c++) {
    const a = r * n + c, b = a + 1, d = a + n, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  // Skirts hide cracks between tiles of different resolution.
  const ring: number[] = [];
  for (let c = 0; c < segs; c++) ring.push(c);
  for (let r = 0; r < segs; r++) ring.push(r * n + segs);
  for (let c = segs; c > 0; c--) ring.push(segs * n + c);
  for (let r = segs; r > 0; r--) ring.push(r * n);
  const s0 = n * n;
  ring.forEach((g, k) => put(s0 + k, pos[g * 3] + x0, pos[g * 3 + 1] - 25, pos[g * 3 + 2] + z0));
  for (let k = 0; k < ring.length; k++) {
    const g0 = ring[k], g1 = ring[(k + 1) % ring.length], s = s0 + k, s1 = s0 + ((k + 1) % ring.length);
    idx.push(g0, g1, s, g1, s1, s);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  ring.forEach((gi, k) => nrm.setXYZ(s0 + k, nrm.getX(gi), nrm.getY(gi), nrm.getZ(gi)));
  g.computeBoundingSphere();
  return g;
}

/** Tileable grass/soil noise used to add close-up detail over the 1 m orthophoto. */
function detailTexture() {
  const n = 256, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!, img = g.createImageData(n, n);
  const rnd = (x: number, y: number) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v = 0, a = 0.5;
    for (let o = 1; o <= 32; o *= 2) {
      const fx = (x / n) * o * 4, fy = (y / n) * o * 4, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, m = o * 4;
      const r = (i: number, j: number) => rnd(((i % m) + m) % m, ((j % m) + m) % m);
      v += a * ((r(ix, iy) * (1 - tx) + r(ix + 1, iy) * tx) * (1 - ty) + (r(ix, iy + 1) * (1 - tx) + r(ix + 1, iy + 1) * tx) * ty);
      a *= 0.5;
    }
    const i = (y * n + x) * 4, b = Math.round(v * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Painted aerodrome ground per region, blended over the photo (texture set once painted). */
export interface GroundOverlay { map: { value: THREE.Texture }; box: { value: THREE.Vector4 } }
const overlays = new Map<string, GroundOverlay>();
export function groundOverlay(regionId: string): GroundOverlay {
  let o = overlays.get(regionId);
  if (!o) overlays.set(regionId, (o = { map: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) }, box: { value: new THREE.Vector4(0, 0, 1, 1) } }));
  return o;
}

function withDetail(mat: THREE.MeshLambertMaterial, detail: THREE.Texture, ov: GroundOverlay) {
  mat.customProgramCacheKey = () => 'bakedDetail';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detail };
    sh.uniforms.afMap = ov.map;
    sh.uniforms.afBox = ov.box;
    sh.vertexShader = 'varying vec2 vWorldXZ;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = 'uniform sampler2D detailMap;\nuniform sampler2D afMap;\nuniform vec4 afBox;\nvarying vec2 vWorldXZ;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec2 afUv = (vWorldXZ - afBox.xy) / afBox.zw;
      if (afUv.x > 0.0 && afUv.x < 1.0 && afUv.y > 0.0 && afUv.y < 1.0) {
        vec4 af = texture2D(afMap, vec2(afUv.x, 1.0 - afUv.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, af.rgb, af.a);
      }
      float dDist = length(vViewPosition);
      float dFade = 1.0 - smoothstep(60.0, 900.0, dDist);
      float d1 = texture2D(detailMap, vMapUv * 700.0).r;
      float d2 = texture2D(detailMap, vMapUv * 97.0).r;
      diffuseColor.rgb *= mix(1.0, 0.72 + 0.56 * (d1 * 0.65 + d2 * 0.35), dFade);`);
  };
  return mat;
}

export async function buildTerrain(geo: GeoData, renderer: THREE.WebGLRenderer, progress: (s: string) => void) {
  const group = new THREE.Group();
  group.name = 'terrain';
  const loader = new THREE.TextureLoader();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const detail = detailTexture();
  const mapTiles: { img: CanvasImageSource; x0: number; z0: number; x1: number; z1: number; ring: number }[] = [];
  const jobs = geo.regions.flatMap((reg) => reg.tiles.map((t) => ({ reg, t })));
  let done = 0;
  await Promise.all(jobs.map(async ({ reg, t }) => {
    const tex = await loader.loadAsync(BASE + reg.dir + t.file);
    mapTiles.push({ img: tex.image as CanvasImageSource, x0: t.x0, z0: t.z0, x1: t.x1, z1: t.z1, ring: t.ring });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = aniso;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const segs = t.ring <= 1 ? 256 : t.ring === 2 ? 128 : 48;
    const mat = t.ring <= 1 ? withDetail(new THREE.MeshLambertMaterial({ map: tex }), detail, groundOverlay(reg.id)) : new THREE.MeshLambertMaterial({ map: tex });
    const mesh = new THREE.Mesh(tileGeometry(reg, t, segs), mat);
    mesh.position.set(t.tx0, 0, t.tz0);
    mesh.receiveShadow = t.ring <= 1;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    group.add(mesh);
    if (++done % 12 === 0) progress(`Terrain tiles ${done}/${jobs.length}…`);
  }));
  // Last-resort ground far below everything (only visible if streaming is unavailable), lost in haze.
  const far = new THREE.Mesh(new THREE.CircleGeometry(250000, 64), new THREE.MeshLambertMaterial({ color: 0x5d6e47 }));
  far.rotation.x = -Math.PI / 2;
  far.position.y = 150;
  group.add(far);
  return { group, mapTiles, detail };
}

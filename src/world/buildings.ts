// Extrude OSM building footprints: textured walls (windows per floor), hip/gable tiled roofs,
// chimneys, flat roofs with parapets, metal-clad hangars, church towers. Merged per 2 km tile.
import * as THREE from 'three';
import { GeoData } from './data';
import { buildingMaterials, SLOT } from './building-textures';

/** r: 0 flat, 1 pitched (gable/hip), 2 wing roof (castles); hl: inner rings (courtyards, clockwise) */
export interface Bld { p: number[]; h: number; r: 0 | 1 | 2; k: number; hl?: number[][] }

const WALL = [[0xece6da, 0xf3efe6, 0xe9dcc0, 0xd9d4ca, 0xf0e2b8], [0xc9c6bd, 0xb9b8b0, 0xd6d1c3], [0xe8e4dc, 0xd0d6dc], [0xf1ece0], [0xb5aca0, 0x9d978d], [0xece1c8, 0xe6dcc6]];
const ROOF = [[0xa4442c, 0x8e3b28, 0xb5583a, 0x5a5048, 0x6b3a2a], [0x8a8f8c, 0x6f7a72, 0x9a9a96], [0x5d625f, 0x7c7f7c], [0x4d5a52], [0x5f5a55, 0x7a6f66], [0x7a3d2c, 0x6c3a2f]];

function rng(seed: number) {
  let s = seed * 2654435761 >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Minimum-area oriented rectangle (tested on footprint edge directions). */
function obb(pts: [number, number][]) {
  let best = { area: Infinity, ux: 1, uz: 0, min0: 0, max0: 0, min1: 0, max1: 0 };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    let ux = b[0] - a[0], uz = b[1] - a[1];
    const l = Math.hypot(ux, uz); if (l < 0.5) continue;
    ux /= l; uz /= l;
    let min0 = Infinity, max0 = -Infinity, min1 = Infinity, max1 = -Infinity;
    for (const p of pts) {
      const s = p[0] * ux + p[1] * uz, t = -p[0] * uz + p[1] * ux;
      min0 = Math.min(min0, s); max0 = Math.max(max0, s); min1 = Math.min(min1, t); max1 = Math.max(max1, t);
    }
    const area = (max0 - min0) * (max1 - min1);
    if (area < best.area) best = { area, ux, uz, min0, max0, min1, max1 };
  }
  return best;
}

type Bucket = { pos: number[][]; uv: number[][]; col: number[][] };
const newBucket = (): Bucket => ({ pos: [[], [], [], [], []], uv: [[], [], [], [], []], col: [[], [], [], [], []] });

type V2 = [number, number];
/** Douglas-Peucker simplification of a closed ring. */
function simplify(ring: V2[], tol: number): V2[] {
  if (ring.length < 8) return ring;
  const dp = (pts: V2[]): V2[] => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    let iMax = 0, dMax = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((pts[i][0] - a[0]) * dz - (pts[i][1] - a[1]) * dx) / L; if (d > dMax) { dMax = d; iMax = i; } }
    return dMax < tol ? [a, b] : [...dp(pts.slice(0, iMax + 1)).slice(0, -1), ...dp(pts.slice(iMax))];
  };
  const half = Math.floor(ring.length / 2);
  const out = [...dp(ring.slice(0, half + 1)).slice(0, -1), ...dp([...ring.slice(half), ring[0]]).slice(0, -1)];
  return out.length >= 3 ? out : ring;
}
/** Inset a ring towards its left side (the building side) by d, with clamped mitres. */
function insetRing(ring: V2[], d: number): V2[] {
  const n = ring.length, out: V2[] = [];
  const nrm = (i: number): V2 => { const a = ring[i], b = ring[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return [-dz / L, dx / L]; };
  for (let i = 0; i < n; i++) {
    const n0 = nrm((i - 1 + n) % n), n1 = nrm(i), dot = n0[0] * n1[0] + n0[1] * n1[1];
    let mx = (n0[0] + n1[0]) / (1 + dot), mz = (n0[1] + n1[1]) / (1 + dot);
    const ml = Math.hypot(mx, mz); if (ml > 2.5) { mx *= 2.5 / ml; mz *= 2.5 / ml; }
    out.push([ring[i][0] + mx * d, ring[i][1] + mz * d]);
  }
  return out;
}

export function buildBuildings(geo: GeoData, list: Bld[]) {
  const buckets = new Map<string, Bucket>();
  const c = new THREE.Color();
  list.forEach((b, bi) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < b.p.length; i += 2) pts.push([b.p[i], b.p[i + 1]]);
    let cx = 0, cz = 0, gmin = Infinity, gsum = 0;
    for (const p of pts) { cx += p[0]; cz += p[1]; const g = geo.heightAt(p[0], p[1]); gmin = Math.min(gmin, g); gsum += g; }
    cx /= pts.length; cz /= pts.length;
    const key = `${Math.floor(cx / 2000)},${Math.floor(cz / 2000)}`;
    let bk = buckets.get(key);
    if (!bk) buckets.set(key, (bk = newBucket()));
    const R = rng(bi + 1);
    const o = obb(pts);
    const L = o.max0 - o.min0, W = o.max1 - o.min1, area = Math.max(1, L * W);
    const metal = b.k === 1 || b.k === 4;
    const wallC = WALL[b.k][Math.floor(R() * WALL[b.k].length)];
    const roofC = ROOF[b.k][Math.floor(R() * ROOF[b.k].length)];
    const gnd = gsum / pts.length;
    // village houses: one storey with a pitched roof unless OSM says otherwise
    let h = b.h;
    if (b.k === 0 && b.r === 1 && area < 260 && h <= 4.6) h = 3.2 + R() * 0.5;
    const base = gmin - 1.5, eave = gnd + h;
    const tri = (slot: number, col: number, v: number[], uv: number[]) => {
      c.setHex(col);
      for (let i = 0; i < v.length; i += 3) { bk!.pos[slot].push(v[i], v[i + 1], v[i + 2]); bk!.col[slot].push(c.r, c.g, c.b); }
      bk!.uv[slot].push(...uv);
    };
    const quad = (slot: number, col: number, a: number[], b2: number[], c2: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[]) =>
      tri(slot, col, [...a, ...b2, ...c2, ...a, ...c2, ...d], [...ua, ...ub, ...uc, ...ua, ...uc, ...ud]);

    // ---- walls: u = perimeter metres / 4, v = height above ground / 3 (one window per floor tile)
    const flat = b.r !== 2 && !(b.r === 1 && W > 2 && W < 30);
    const top = flat ? eave + 0.45 : eave; // parapet on flat roofs
    const wallSlot = metal ? SLOT.metal : SLOT.wall;
    const holes: [number, number][][] = (b.hl ?? []).map((h) => { const r: [number, number][] = []; for (let i = 0; i < h.length; i += 2) r.push([h[i], h[i + 1]]); return r; });
    let s = R() * 4;
    for (const ring of [pts, ...holes]) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], d = ring[(i + 1) % ring.length], len = Math.hypot(d[0] - a[0], d[1] - a[1]);
      const shade = new THREE.Color(wallC).multiplyScalar(0.93 + 0.07 * R()).getHex();
      const plain = b.k === 3; // churches: plain plaster, no house windows (castles keep their windows)
      const u0 = plain ? 0.03 : s / 4, u1 = plain ? 0.12 : (s + len) / 4, v0 = (base - gnd) / 3, v1 = (top - gnd) / 3;
      quad(wallSlot, shade, [a[0], base, a[1]], [d[0], base, d[1]], [d[0], top, d[1]], [a[0], top, a[1]], [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
      s += len;
    }

    // ---- castle: steep "wing" roofs rising from the outer and courtyard walls to a ridge, plus round towers
    if (b.r === 2) {
      const outerS = simplify(pts, 0.8), holesS = holes.map((h) => simplify(h, 0.8));
      // wing depth: median distance from outer vertices to the courtyards (else the short side)
      let wing = Math.min(L, W);
      if (holesS.length) {
        const ds = outerS.map((p) => Math.min(...holesS.flatMap((h) => h.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))))).sort((a, c) => a - c);
        wing = ds[Math.floor(ds.length / 2)];
      }
      const dIn = Math.max(2.5, Math.min(8, wing * 0.45)), rise = dIn * Math.tan(54 * Math.PI / 180), ridgeY = eave + rise;
      const slope = Math.hypot(dIn, rise) / 2;
      const rc2 = new THREE.Color(roofC).multiplyScalar(0.86).getHex();
      const rings = [outerS, ...holesS], insets = rings.map((r) => insetRing(r, dIn));
      rings.forEach((r, ri) => {
        const v = insets[ri];
        let u = 0;
        for (let i = 0; i < r.length; i++) {
          const j = (i + 1) % r.length, len = Math.hypot(r[j][0] - r[i][0], r[j][1] - r[i][1]);
          quad(SLOT.tiles, i % 2 ? roofC : rc2, [r[i][0], eave, r[i][1]], [r[j][0], eave, r[j][1]], [v[j][0], ridgeY, v[j][1]], [v[i][0], ridgeY, v[i][1]], [u / 2, 0], [(u + len) / 2, 0], [(u + len) / 2, slope], [u / 2, slope]);
          u += len;
        }
      });
      // close the top where the wings are wider than twice the inset
      try {
        const top = THREE.ShapeUtils.triangulateShape(insets[0].map((p) => new THREE.Vector2(p[0], p[1])), insets.slice(1).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))));
        const all = insets.flat();
        for (const t of top) { const [p, q, r] = t.map((i) => all[i]); tri(SLOT.tiles, rc2, [p[0], ridgeY, p[1], q[0], ridgeY, q[1], r[0], ridgeY, r[1]], [p[0] / 2, p[1] / 2, q[0] / 2, q[1] / 2, r[0] / 2, r[1] / 2]); }
      } catch { /* insets crossed: the slopes already meet */ }
      // round towers with conical roofs at the sharpest outer corners
      const n = outerS.length, corners: { p: V2; turn: number }[] = [];
      for (let i = 0; i < n; i++) {
        const a = outerS[(i - 1 + n) % n], p = outerS[i], c2 = outerS[(i + 1) % n];
        const e1 = Math.atan2(p[1] - a[1], p[0] - a[0]), e2 = Math.atan2(c2[1] - p[1], c2[0] - p[0]);
        const turn = Math.atan2(Math.sin(e2 - e1), Math.cos(e2 - e1)); // > 0 = convex corner (left turn on a CCW ring)
        if (turn > 0.9) corners.push({ p, turn });
      }
      corners.sort((x, y) => y.turn - x.turn);
      const towers: V2[] = [];
      for (const cn of corners) if (towers.length < 5 && towers.every((t) => Math.hypot(t[0] - cn.p[0], t[1] - cn.p[1]) > 25)) towers.push(cn.p);
      const rad = Math.min(5, dIn * 0.75), seg = 14, tTop = ridgeY + 2.5, apexY = tTop + rad * 2.2;
      for (const tp of towers) {
        for (let k = 0; k < seg; k++) {
          const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
          const x0 = tp[0] + Math.cos(a0) * rad, z0 = tp[1] + Math.sin(a0) * rad, x1 = tp[0] + Math.cos(a1) * rad, z1 = tp[1] + Math.sin(a1) * rad;
          const u0 = (k / seg) * rad * 1.57, u1 = ((k + 1) / seg) * rad * 1.57;
          quad(SLOT.wall, wallC, [x0, base, z0], [x1, base, z1], [x1, tTop, z1], [x0, tTop, z0], [u0, (base - gnd) / 3], [u1, (base - gnd) / 3], [u1, (tTop - gnd) / 3], [u0, (tTop - gnd) / 3]);
          tri(SLOT.tiles, k % 2 ? roofC : rc2, [x0, tTop, z0, x1, tTop, z1, tp[0], apexY, tp[1]], [u0, 0, u1, 0, (u0 + u1) / 2, rad]);
        }
      }
      return;
    }

    if (flat) {
      const shape = pts.map((p) => new THREE.Vector2(p[0], p[1]));
      const holeShapes = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
      const allPts = [...pts, ...holes.flat()];
      const fc = new THREE.Color(roofC).lerp(new THREE.Color(0xcfcfcb), 0.6).getHex();
      for (const t of THREE.ShapeUtils.triangulateShape(shape, holeShapes)) {
        const [p, q, r] = t.map((i) => allPts[i]);
        tri(SLOT.flat, fc, [p[0], eave, p[1], q[0], eave, q[1], r[0], eave, r[1]], [p[0] / 4, p[1] / 4, q[0] / 4, q[1] / 4, r[0] / 4, r[1] / 4]);
      }
      return;
    }

    // ---- pitched roof on the oriented rectangle, ridge along the long side
    let { ux, uz, min0, max0, min1, max1 } = o;
    if (W > L) { [ux, uz] = [-uz, ux]; [min0, max0, min1, max1] = [min1, max1, -max0, -min0]; }
    const ov = 0.45; min0 -= ov; max0 += ov; min1 -= ov; max1 += ov;
    const len = max0 - min0, w = (max1 - min1) / 2, mid = (min1 + max1) / 2;
    const pitch = metal ? Math.tan(12 * Math.PI / 180) : Math.tan((38 + R() * 8) * Math.PI / 180);
    const rise = Math.min(w * pitch, metal ? 3 : 7);
    const ridge = eave + rise;
    const hip = !metal && b.k !== 3 && (len / (2 * w) < 1.35 || R() < 0.25);
    const inset = hip ? Math.min(w, len / 2 - 0.3) : 0;
    const P = (sa: number, t: number, y: number) => [sa * ux - t * uz, y, sa * uz + t * ux];
    const A = P(min0, min1, eave), B = P(max0, min1, eave), C = P(max0, max1, eave), D = P(min0, max1, eave);
    const E = P(min0 + inset, mid, ridge), F = P(max0 - inset, mid, ridge);
    const slot = metal ? SLOT.seam : SLOT.tiles;
    const slope = Math.hypot(w, rise) / 2; // uv: 2 m tiles along ridge and down the slope
    const rc2 = new THREE.Color(roofC).multiplyScalar(0.84).getHex();
    quad(slot, roofC, A, B, F, E, [min0 / 2, 0], [max0 / 2, 0], [(max0 - inset) / 2, slope], [(min0 + inset) / 2, slope]);
    quad(slot, rc2, C, D, E, F, [max0 / 2, 0], [min0 / 2, 0], [(min0 + inset) / 2, slope], [(max0 - inset) / 2, slope]);
    if (hip) {
      const hs = Math.hypot(inset, rise) / 2, hw = w / 2;
      tri(slot, rc2, [...D, ...A, ...E], [-hw, 0, hw, 0, 0, hs]);
      tri(slot, roofC, [...B, ...C, ...F], [-hw, 0, hw, 0, 0, hs]);
    } else {
      // gable ends in plain plaster (left strip of the wall tile has no window)
      const gv = (y: number) => (y - gnd) / 3;
      tri(wallSlot, wallC, [...A, ...E, ...D], [0.02, gv(eave), 0.08, gv(ridge), 0.14, gv(eave)]);
      tri(wallSlot, wallC, [...B, ...C, ...F], [0.02, gv(eave), 0.14, gv(eave), 0.08, gv(ridge)]);
    }
    // ---- chimney on most houses
    if (b.k === 0 && R() < 0.7 && w > 2.5) {
      const cs = min0 + inset + (len - 2 * inset) * (0.25 + R() * 0.5), ct = mid + (R() < 0.5 ? -1 : 1) * w * 0.35;
      const yb = eave + rise * 0.65 - 0.3, yt = ridge + 0.8;
      const cc = R() < 0.5 ? 0x8d4a3a : 0xd8d2c8, q = 0.32;
      const c4 = [P(cs - q, ct - q, 0), P(cs + q, ct - q, 0), P(cs + q, ct + q, 0), P(cs - q, ct + q, 0)];
      for (let k = 0; k < 4; k++) {
        const a = c4[k], d = c4[(k + 1) % 4];
        quad(SLOT.wall, cc, [a[0], yb, a[2]], [d[0], yb, d[2]], [d[0], yt, d[2]], [a[0], yt, a[2]], [0.02, 0.9], [0.1, 0.9], [0.1, 0.99], [0.02, 0.99]);
      }
      quad(SLOT.flat, 0x555555, [c4[0][0], yt, c4[0][2]], [c4[1][0], yt, c4[1][2]], [c4[2][0], yt, c4[2][2]], [c4[3][0], yt, c4[3][2]], [0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2]);
    }
    // ---- church tower with spire at one end of the nave
    if (b.k === 3 && area > 120) {
      const tw = Math.min(6, w * 1.1), s0 = min0 + ov, t0 = mid;
      const ty = ridge + 6 + Math.min(14, len * 0.5), sp = ty + tw * 1.6;
      const q = tw / 2, c4 = [P(s0 - q, t0 - q, 0), P(s0 + q, t0 - q, 0), P(s0 + q, t0 + q, 0), P(s0 - q, t0 + q, 0)];
      for (let k = 0; k < 4; k++) {
        const a = c4[k], d = c4[(k + 1) % 4];
        quad(SLOT.wall, 0xf3eee2, [a[0], base, a[2]], [d[0], base, d[2]], [d[0], ty, d[2]], [a[0], ty, a[2]], [0.03, 0], [0.12, 0], [0.12, 0.6], [0.03, 0.6]);
      }
      const apex = P(s0, t0, sp);
      for (let k = 0; k < 4; k++) {
        const a = c4[k], d = c4[(k + 1) % 4];
        tri(SLOT.seam, 0x4f6b5e, [a[0], ty, a[2], d[0], ty, d[2], apex[0], apex[1], apex[2]], [0, 0, 1, 0, 0.5, 2]);
      }
    }
  });
  const group = new THREE.Group();
  group.name = 'buildings';
  const mats = buildingMaterials();
  for (const bk of buckets.values()) {
    const g = new THREE.BufferGeometry();
    const pos: number[] = [], uv: number[] = [], col: number[] = [];
    for (let m = 0; m < 5; m++) {
      if (!bk.pos[m].length) continue;
      g.addGroup(pos.length / 3, bk.pos[m].length / 3, m);
      for (const v of bk.pos[m]) pos.push(v);
      for (const v of bk.uv[m]) uv.push(v);
      for (const v of bk.col[m]) col.push(v);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mats);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return group;
}

/** Point-in-polygon index of buildings near the airfield for taxi collisions. */
export function obstacleIndex(list: Bld[], radius: number, centres: [number, number][] = [[0, 0]]) {
  const polys: { pts: number[]; minx: number; maxx: number; minz: number; maxz: number }[] = [];
  for (const b of list) {
    const p = b.p;
    if (!centres.some((c) => Math.hypot(p[0] - c[0], p[1] - c[1]) < radius)) continue;
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < p.length; i += 2) { minx = Math.min(minx, p[i]); maxx = Math.max(maxx, p[i]); minz = Math.min(minz, p[i + 1]); maxz = Math.max(maxz, p[i + 1]); }
    polys.push({ pts: p, minx, maxx, minz, maxz });
  }
  return (x: number, z: number) => {
    for (const q of polys) {
      if (x < q.minx || x > q.maxx || z < q.minz || z > q.maxz) continue;
      let inside = false;
      const p = q.pts;
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
        if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  };
}

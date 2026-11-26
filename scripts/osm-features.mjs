// OSM -> forest mask + building list (local metres).
import { toLocal, HALF } from './config.mjs';

const ll = (g) => g.map((p) => toLocal(p.lat, p.lon));

// Join open way segments into closed rings.
export function joinRings(segs) {
  const rings = [];
  const pool = segs.map((s) => s.slice());
  while (pool.length) {
    let ring = pool.pop();
    let guard = 0;
    while (guard++ < 10000) {
      const a = ring[0], b = ring[ring.length - 1];
      if (a[0] === b[0] && a[1] === b[1] && ring.length > 3) break;
      const i = pool.findIndex((s) => {
        const s0 = s[0], s1 = s[s.length - 1];
        return (s0[0] === b[0] && s0[1] === b[1]) || (s1[0] === b[0] && s1[1] === b[1]);
      });
      if (i < 0) break;
      let s = pool.splice(i, 1)[0];
      if (!(s[0][0] === b[0] && s[0][1] === b[1])) s = s.reverse();
      ring = ring.concat(s.slice(1));
    }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}

// Polygons as arrays of rings (local coords), outer + inner mixed (even-odd fill).
function polygons(elements, pred) {
  const out = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    if (!pred(t)) continue;
    if (e.type === 'way' && e.geometry?.length > 3) out.push([ll(e.geometry)]);
    else if (e.type === 'relation' && e.members) {
      const segs = e.members.filter((m) => m.type === 'way' && m.geometry?.length > 1).map((m) => ll(m.geometry));
      const rings = joinRings(segs);
      if (rings.length) out.push(rings);
    }
  }
  return out;
}

export function forestMask(elements, cell, box = { x0: -HALF, z0: -HALF, size: 2 * HALF }) {
  const n = Math.round(box.size / cell);
  const bits = new Uint8Array(Math.ceil((n * n) / 8));
  const isForest = (t) => t.landuse === 'forest' || t.natural === 'wood';
  let count = 0;
  for (const rings of polygons(elements, isForest)) {
    const edges = [];
    let zmin = Infinity, zmax = -Infinity;
    for (const r of rings) for (let i = 0; i < r.length - 1; i++) {
      edges.push([r[i], r[i + 1]]);
      zmin = Math.min(zmin, r[i][1]); zmax = Math.max(zmax, r[i][1]);
    }
    const r0 = Math.max(0, Math.floor((zmin - box.z0) / cell));
    const r1 = Math.min(n - 1, Math.ceil((zmax - box.z0) / cell));
    for (let row = r0; row <= r1; row++) {
      const zc = box.z0 + (row + 0.5) * cell;
      const xs = [];
      for (const [a, b] of edges) {
        if ((a[1] <= zc) !== (b[1] <= zc)) xs.push(a[0] + ((zc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - box.x0) / cell - 0.5));
        const c1 = Math.min(n - 1, Math.floor((xs[k + 1] - box.x0) / cell - 0.5));
        for (let col = c0; col <= c1; col++) {
          const idx = row * n + col;
          if (!(bits[idx >> 3] & (1 << (idx & 7)))) { bits[idx >> 3] |= 1 << (idx & 7); count++; }
        }
      }
    }
  }
  return { bits, n, cell, cover: count / (n * n) };
}

const KIND = {
  industrial: 1, warehouse: 1, barn: 1, farm_auxiliary: 1, hangar: 1, agricultural: 1, cowshed: 1, greenhouse: 1, transportation: 1,
  commercial: 2, retail: 2, civic: 2, school: 2, public: 2, office: 2, hotel: 2, apartments: 2, hospital: 2,
  church: 3, chapel: 3,
  garage: 4, garages: 4, shed: 4, roof: 4,
};

export function buildBuildings(elements, centre = [0, 0], fixLevels = true) {
  const out = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    if (!t.building) continue;
    let ring, holes = [];
    if (e.type === 'way' && e.geometry?.length > 3) ring = ll(e.geometry);
    else if (e.type === 'relation' && e.members) {
      const outer = e.members.filter((m) => m.role === 'outer' && m.geometry?.length > 1).map((m) => ll(m.geometry));
      ring = joinRings(outer)[0];
      // inner rings (courtyards), stored clockwise so the building is on their left like the outer ring
      holes = joinRings(e.members.filter((m) => m.role === 'inner' && m.geometry?.length > 1).map((m) => ll(m.geometry))).map((h) => {
        h = h.slice(0, -1);
        let ha = 0; for (let i = 0; i < h.length; i++) { const p = h[i], q = h[(i + 1) % h.length]; ha += p[0] * q[1] - q[0] * p[1]; }
        return ha > 0 ? h.reverse() : h;
      }).filter((h) => h.length >= 3);
    }
    if (!ring) continue;
    ring = ring.slice(0, -1);
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    a /= 2;
    if (Math.abs(a) < 8) continue;
    if (a < 0) ring.reverse();
    const area = Math.abs(a);
    const castle = t.historic === 'castle' || t.building === 'castle';
    const k = castle ? 5 : (KIND[t.building] ?? 0);
    let h = parseFloat(t.height);
    const lv = parseFloat(t['building:levels']);
    // Around the aerodrome several OSM hangars carry their height (m) in building:levels.
    const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    if (fixLevels && !(h > 0) && lv > 3 && Math.hypot(cx - centre[0], cz - centre[1]) < 1500) h = Math.min(lv, 9);
    if (!(h > 0)) h = lv > 0 ? lv * 3 + 1 : k === 4 ? 2.6 : k === 1 ? (area > 600 ? 8 : 5.5) : k === 3 ? 12 : area > 400 ? 9 : 4.5;
    if (castle) h = Math.max(h, area > 1500 ? 14 : 10); // OSM often says "1 level" for whole castles
    let r = castle ? 2 : t['roof:shape'] === 'flat' ? 0 : t['roof:shape'] === 'gabled' ? 1 : (k === 0 || k === 3) && area < 400 ? 1 : k === 1 && area < 900 ? 1 : 0;
    const rnd = (v) => Math.round(v * 10) / 10;
    const b = { p: ring.flat().map(rnd), h: rnd(h), r, k };
    if (holes.length) b.hl = holes.map((hh) => hh.flat().map(rnd));
    out.push(b);
  }
  return out;
}

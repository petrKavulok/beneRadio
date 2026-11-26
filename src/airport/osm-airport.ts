// Build an Airport from the baked OSM aerodrome extract (public/data/<ICAO>/airport.json)
// plus a few hand-written facts (radio, circuit, which stands to use).
import type { Airport, P2, Runway, Taxiway, HoldingPoint, Stand, Road } from './types';
import { isPaved } from './types';

export interface OsmAirportJson {
  runways: { ref: string; width: number; surface: string; pts: P2[] }[];
  taxiways: { ref: string; width: number; surface: string; kind: string; pts: P2[] }[];
  aprons: { surface: string; pts: P2[] }[];
  holds: { ref: string; pos: P2; line?: P2[]; cat: string }[];
  stands: { ref: string; pos: P2 }[];
  windsocks: P2[];
  boundary: P2[];
  roads: Road[];
}
export interface AirportMeta {
  icao: string; name: string; radio: string; callName: string; towered: boolean;
  elevFt: number; circuitFt: number; magVar: number; circuit: Record<string, 'L' | 'R'>;
  centre: P2; tower: { pos: P2; height: number };
  /** pick stands for the player (default: first few) */
  stands?: (all: { ref: string; pos: P2 }[]) => Stand[];
  /** extra/override holding points */
  holds?: HoldingPoint[];
  hpFor?: Record<string, string>;
  ignoreRunways?: string[];
  /** hand-drawn additions where OSM has nothing (small grass fields) */
  extraTaxiways?: Taxiway[];
  extraAprons?: { pts: P2[]; paved: boolean }[];
}

const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const brg = (a: P2, b: P2) => (Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180 / Math.PI + 360) % 360;

function segDist(p: P2, a: P2, b: P2) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

export function airportFromOsm(j: OsmAirportJson, m: AirportMeta): Airport {
  // ---- runways: split "06/24" into two directions, assign ends by magnetic bearing
  const runways: Runway[] = [];
  for (const r of j.runways) {
    if (!r.ref.includes('/') || m.ignoreRunways?.includes(r.ref)) continue;
    const a = r.pts[0], b = r.pts[r.pts.length - 1];
    const [d1, d2] = r.ref.split('/').map((s) => s.trim());
    const mag = (brg(a, b) - m.magVar + 360) % 360;
    const n1 = parseInt(d1) * 10;
    const firstIsD1 = Math.abs(((mag - n1 + 540) % 360) - 180) < 90;
    const [t1, t2] = firstIsD1 ? [a, b] : [b, a];
    const paved = isPaved(r.surface);
    const strip = paved ? Math.max(r.width * 2.5, 150) : Math.max(r.width * 2.5, 60);
    const base = { pair: `${d1}/${d2}`, width: r.width, strip, surface: r.surface || 'grass', lit: paved };
    runways.push({ id: d1, thr: t1, end: t2, ...base }, { id: d2, thr: t2, end: t1, ...base });
  }
  // ---- taxiways
  // OSM often leaves taxiway surface/width untagged: at an airport with paved runways assume a paved
  // taxiway, sized for the airport (major airport ~23 m, small field ~10 m); taxilanes are narrower.
  const pavedField = runways.some((r) => isPaved(r.surface));
  const longest = Math.max(0, ...runways.map((r) => Math.hypot(r.end[0] - r.thr[0], r.end[1] - r.thr[1])));
  const defW = (kind: string) => (kind === 'taxilane' ? (longest > 2500 ? 15 : 8) : longest > 2500 ? 23 : pavedField ? 10.5 : 11);
  const taxiways: Taxiway[] = [...(m.extraTaxiways ?? []), ...j.taxiways.map((t) => {
    const paved = t.surface ? isPaved(t.surface) : pavedField;
    return { name: t.ref || (t.kind === 'taxilane' ? 'apron' : 'TWY'), pts: t.pts, width: t.width > 0 ? t.width : defW(t.kind), paved, lit: paved && longest > 2500 };
  })];
  // ---- holding points: OSM nodes/lines, else synthesised at the strip edge nearest each threshold
  const holds: HoldingPoint[] = [...(m.holds ?? [])];
  const hpFor: Record<string, string> = { ...(m.hpFor ?? {}) };
  const twyPts = taxiways.flatMap((t) => t.pts.map((p) => ({ p, name: t.name })));
  const nearestTwy = (p: P2) => { let best = { d: Infinity, name: '' }; for (const t of taxiways) { if (!/^[A-Z][A-Z0-9]{0,3}$/.test(t.name) || t.name === 'TWY') continue; for (let i = 0; i + 1 < t.pts.length; i++) { const d = segDist(p, t.pts[i], t.pts[i + 1]); if (d < best.d) best = { d, name: t.name }; } } return best.d < 250 ? best : { d: Infinity, name: '' }; };
  for (const r of runways) {
    if (hpFor[r.id]) continue;
    const L = dist(r.thr, r.end), ux = (r.end[0] - r.thr[0]) / L, uz = (r.end[1] - r.thr[1]) / L;
    const lateral = (p: P2) => Math.abs((p[0] - r.thr[0]) * -uz + (p[1] - r.thr[1]) * ux);
    const along = (p: P2) => (p[0] - r.thr[0]) * ux + (p[1] - r.thr[1]) * uz;
    let best: { pos: P2; ref: string; score: number } | null = null;
    for (const h of j.holds) {
      const lat = lateral(h.pos), al = along(h.pos);
      if (lat > r.strip + 120 || al < -150 || al > L * 0.35) continue;
      const score = Math.abs(al) + lat * 0.5;
      if (!best || score < best.score) best = { pos: h.pos, ref: h.ref, score };
    }
    if (!best) {
      for (const { p } of twyPts) {
        const lat = lateral(p), al = along(p);
        if (lat < r.strip / 2 + 8 || lat > r.strip / 2 + 90 || al < -100 || al > L * 0.3) continue;
        const score = Math.abs(al) + lat;
        if (!best || score < best.score) best = { pos: p, ref: '', score };
      }
    }
    if (!best) {
      for (const { p } of twyPts) {
        const lat = lateral(p), al = along(p);
        if (lat < r.strip / 2 + 8 || lat > r.strip / 2 + 120 || al < -100 || al > L * 0.8) continue;
        const score = Math.abs(al) + lat;
        if (!best || score < best.score) best = { pos: p, ref: '', score };
      }
    }
    if (!best) continue;
    const on = nearestTwy(best.pos).name;
    const hid = best.ref || `${on || 'HP'}-${r.id}`;
    const existing = holds.find((h) => h.id === hid);
    if (existing) existing.runways.push(r.id);
    else holds.push({ id: hid, label: `${best.ref || on || 'Holding point'} – RWY ${r.id}`, pos: best.pos, on: best.ref || on, runways: [r.id], facing: [r.thr[0] + ux * 40, r.thr[1] + uz * 40] });
    hpFor[r.id] = hid;
  }
  // ---- stands
  let stands: Stand[] = m.stands ? m.stands(j.stands) : j.stands.slice(0, 5).map((s, i) => ({ id: s.ref || `S${i + 1}`, pos: s.pos, hdg: 0 }));
  if (!stands.length && j.aprons.length) {
    const a = j.aprons[0].pts, c: P2 = [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length];
    stands = [{ id: 'S1', pos: c, hdg: 0 }];
  }
  // ---- parking area polygon: aprons union (largest apron near the stands)
  const parking = stands.length > 1 && !j.aprons.length ? hull(stands.map((s) => s.pos), 25)
    : j.aprons.length ? (j.aprons.find((a) => stands.some((s) => inPolyLocal(s.pos, a.pts)))?.pts ?? j.aprons.reduce((a, b) => (b.pts.length > a.pts.length ? b : a)).pts)
    : stands.length ? square(stands[0].pos, 60) : square(m.centre, 60);
  const xs = j.boundary.map((p) => p[0]), zs = j.boundary.map((p) => p[1]);
  const pad = 80;
  return {
    icao: m.icao, name: m.name, radio: m.radio, callName: m.callName, towered: m.towered,
    elevFt: m.elevFt, circuitFt: m.circuitFt, magVar: m.magVar, circuit: m.circuit, centre: m.centre,
    runways, taxiways, holds, hpFor, stands, parking,
    aprons: [...(m.extraAprons ?? []), ...j.aprons.map((a) => ({ pts: a.pts, paved: isPaved(a.surface) || a.surface === '' }))],
    windsocks: j.windsocks, tower: m.tower, boundary: j.boundary, roads: j.roads,
    groundBox: xs.length ? { x0: Math.min(...xs) - pad, z0: Math.min(...zs) - pad, x1: Math.max(...xs) + pad, z1: Math.max(...zs) + pad } : { x0: m.centre[0] - 1500, z0: m.centre[1] - 1500, x1: m.centre[0] + 1500, z1: m.centre[1] + 1500 },
  };
}
const square = (c: P2, r: number): P2[] => [[c[0] - r, c[1] - r], [c[0] + r, c[1] - r], [c[0] + r, c[1] + r], [c[0] - r, c[1] + r]];
function inPolyLocal(p: P2, poly: P2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside; }
  return inside;
}
/** padded bounding box of points as a polygon */
function hull(pts: P2[], pad: number): P2[] {
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, z0 = Math.min(...zs) - pad, z1 = Math.max(...zs) + pad;
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

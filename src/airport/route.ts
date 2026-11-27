// Taxi graph built from the taxiway polylines + shortest-path routing.
import type { Airport, P2, Stand } from './types';

interface Node { p: P2; edges: { to: number; w: number; twy: string }[] }

const key = (p: P2) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

export class TaxiGraph {
  nodes: Node[] = [];
  private index = new Map<string, number>();

  private stands: Stand[];
  constructor(ap: Airport) {
    this.stands = ap.stands;
    for (const sg of splitSegments(ap.taxiways)) this.link(sg.a, sg.b, sg.name);
    // Runways as (costlier) taxi paths: small fields often require backtracking on the runway.
    for (const r of ap.runways) {
      if (r.id > r.pair.split('/')[1]) continue;
      const L = Math.hypot(r.end[0] - r.thr[0], r.end[1] - r.thr[1]), ux = (r.end[0] - r.thr[0]) / L, uz = (r.end[1] - r.thr[1]) / L;
      const joins: { s: number; p: P2; from: P2; name: string }[] = [];
      for (const t of ap.taxiways) for (const e of [t.pts[0], t.pts[t.pts.length - 1]]) {
        const dx = e[0] - r.thr[0], dz = e[1] - r.thr[1], al = dx * ux + dz * uz, lat = Math.abs(dx * -uz + dz * ux);
        if (lat < r.width / 2 + 45 && al > -20 && al < L + 20) {
          const sa = Math.min(Math.max(al, 0), L);
          joins.push({ s: sa, p: [r.thr[0] + ux * sa, r.thr[1] + uz * sa], from: e, name: t.name });
        }
      }
      joins.sort((a, b) => a.s - b.s);
      const chain: P2[] = [r.thr, ...joins.map((j) => j.p), r.end];
      for (let i = 0; i + 1 < chain.length; i++) if (Math.hypot(chain[i][0] - chain[i + 1][0], chain[i][1] - chain[i + 1][1]) > 0.5) this.link(chain[i], chain[i + 1], `RWY ${r.pair}`, 2.5);
      for (const j of joins) if (Math.hypot(j.p[0] - j.from[0], j.p[1] - j.from[1]) > 0.5) this.link(j.from, j.p, j.name);
    }
    // Holding points snap onto the nearest taxiway segment; stands are joined to the closest
    // point of the nearest taxiway (not a far-away vertex), unless a lead-in line already ends there.
    for (const hp of ap.holds) this.insertOnNearest(hp.pos);
    for (const s of ap.stands) {
      const i = this.index.get(key(s.pos));
      if (i !== undefined && this.nodes[i].edges.length) continue;
      const q = this.insertOnNearest(s.pos, true);
      if (q) this.link(s.pos, q, 'apron');
    }
  }

  private node(p: P2) {
    const k = key(p);
    let i = this.index.get(k);
    if (i === undefined) { i = this.nodes.length; this.nodes.push({ p, edges: [] }); this.index.set(k, i); }
    return i;
  }
  private link(a: P2, b: P2, twy: string, cost = 1) {
    const i = this.node(a), j = this.node(b), w = Math.hypot(a[0] - b[0], a[1] - b[1]) * cost;
    this.nodes[i].edges.push({ to: j, w, twy }); this.nodes[j].edges.push({ to: i, w, twy });
  }
  private unlink(i: number, j: number) {
    this.nodes[i].edges = this.nodes[i].edges.filter((e) => e.to !== j);
    this.nodes[j].edges = this.nodes[j].edges.filter((e) => e.to !== i);
  }
  /** Split the closest edge at p (or, with `project`, at the point of that edge closest to p, which is returned). */
  private insertOnNearest(p: P2, project = false): P2 | null {
    let best = { d: Infinity, i: -1, j: -1, twy: '', w: 0 };
    this.nodes.forEach((n, i) => n.edges.forEach((e) => {
      if (e.to < i || (project && (e.twy.startsWith('RWY') || e.twy === 'apron'))) return;
      const d = segDist(p, n.p, this.nodes[e.to].p);
      if (d < best.d) best = { d, i, j: e.to, twy: e.twy, w: e.w };
    }));
    if (best.i < 0) return null;
    const a = this.nodes[best.i].p, b = this.nodes[best.j].p;
    const q = project ? closestOnSeg(p, a, b) : p;
    if (Math.hypot(q[0] - a[0], q[1] - a[1]) < 0.5) return a;
    if (Math.hypot(q[0] - b[0], q[1] - b[1]) < 0.5) return b;
    const cost = best.w / (Math.hypot(a[0] - b[0], a[1] - b[1]) || 1);
    this.unlink(best.i, best.j);
    this.link(a, q, best.twy, cost); this.link(q, b, best.twy, cost);
    return q;
  }
  nearestNode(p: P2, excludeStands = false) {
    let bi = 0, bd = Infinity;
    const stands = new Set(this.stands.map((s) => key(s.pos)));
    this.nodes.forEach((n, i) => {
      if (excludeStands && stands.has(key(n.p))) return;
      const d = Math.hypot(n.p[0] - p[0], n.p[1] - p[1]);
      if (d < bd) { bd = d; bi = i; }
    });
    return bi;
  }

  /** Shortest route from a position to a target point; returns polyline and taxiway names in order. */
  route(from: P2, to: P2) {
    const s = this.nearestNode(from), t = this.nearestNode(to);
    const dist = new Array(this.nodes.length).fill(Infinity), prev: { n: number; twy: string }[] = [];
    const done = new Set<number>();
    dist[s] = 0;
    while (done.size < this.nodes.length) {
      let u = -1, ud = Infinity;
      dist.forEach((d, i) => { if (!done.has(i) && d < ud) { ud = d; u = i; } });
      if (u < 0 || u === t) break;
      done.add(u);
      for (const e of this.nodes[u].edges) {
        if (dist[u] + e.w < dist[e.to]) { dist[e.to] = dist[u] + e.w; prev[e.to] = { n: u, twy: e.twy }; }
      }
    }
    const pts: P2[] = [];
    const names: string[] = [];
    for (let c = t; c !== s && prev[c]; c = prev[c].n) {
      pts.unshift(this.nodes[c].p);
      const nm = prev[c].twy;
      if (nm !== 'apron' && names[0] !== nm) names.unshift(nm);
    }
    pts.unshift(this.nodes[s].p);
    return { pts, names, length: dist[t] };
  }
}

export function segDist(p: P2, a: P2, b: P2) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

export function closestOnSeg(p: P2, a: P2, b: P2): P2 {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return [a[0] + t * dx, a[1] + t * dz];
}

/**
 * Taxiway polylines -> graph segments. OSM lines often cross without a shared vertex, or a
 * stand lead-in ends right on a taxilane between two of its vertices: split segments at
 * crossings and snap loose ends lying within 3 m of another line onto it.
 */
function splitSegments(twys: { name: string; pts: P2[] }[]) {
  type Seg = { a: P2; b: P2; name: string; line: number; cuts: { t: number; p: P2 }[] };
  const segs: Seg[] = [];
  twys.forEach((t, line) => { for (let i = 0; i + 1 < t.pts.length; i++) segs.push({ a: t.pts[i], b: t.pts[i + 1], name: t.name, line, cuts: [] }); });
  const box = segs.map((s) => [Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[0], s.b[0]), Math.max(s.a[1], s.b[1])]);
  const tOn = (s: Seg, p: P2) => { const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1]; return ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dz) / (dx * dx + dz * dz || 1); };
  // proper crossings
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = box[i], B = box[j];
    if (A[0] > B[2] || B[0] > A[2] || A[1] > B[3] || B[1] > A[3]) continue;
    const s = segs[i], u = segs[j];
    const rx = s.b[0] - s.a[0], rz = s.b[1] - s.a[1], qx = u.b[0] - u.a[0], qz = u.b[1] - u.a[1];
    const den = rx * qz - rz * qx;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((u.a[0] - s.a[0]) * qz - (u.a[1] - s.a[1]) * qx) / den, v = ((u.a[0] - s.a[0]) * rz - (u.a[1] - s.a[1]) * rx) / den;
    if (t <= 1e-4 || t >= 1 - 1e-4 || v <= 1e-4 || v >= 1 - 1e-4) continue;
    const p: P2 = [s.a[0] + t * rx, s.a[1] + t * rz];
    s.cuts.push({ t, p }); u.cuts.push({ t: v, p });
  }
  // loose ends close to another line
  const extra: { a: P2; b: P2; name: string }[] = [];
  const used = new Map<string, number>();
  for (const t of twys) for (const p of t.pts) used.set(key(p), (used.get(key(p)) ?? 0) + 1);
  twys.forEach((t, line) => {
    for (const e of [t.pts[0], t.pts[t.pts.length - 1]]) {
      if ((used.get(key(e)) ?? 0) > 1) continue;
      let best: { s: Seg; d: number } | null = null;
      for (const s of segs) { if (s.line === line) continue; const d = segDist(e, s.a, s.b); if (d < 3 && (!best || d < best.d)) best = { s, d }; }
      if (!best) continue;
      const tt = tOn(best.s, e);
      const q: P2 = tt <= 0.01 ? best.s.a : tt >= 0.99 ? best.s.b : closestOnSeg(e, best.s.a, best.s.b);
      if (tt > 0.01 && tt < 0.99) best.s.cuts.push({ t: tt, p: q });
      if (Math.hypot(q[0] - e[0], q[1] - e[1]) > 0.05) extra.push({ a: e, b: q, name: t.name });
    }
  });
  const out: { a: P2; b: P2; name: string }[] = [...extra];
  for (const s of segs) {
    const pts = [s.a, ...s.cuts.sort((x, y) => x.t - y.t).map((c) => c.p), s.b];
    for (let i = 0; i + 1 < pts.length; i++) if (Math.hypot(pts[i][0] - pts[i + 1][0], pts[i][1] - pts[i + 1][1]) > 0.05) out.push({ a: pts[i], b: pts[i + 1], name: s.name });
  }
  return out;
}

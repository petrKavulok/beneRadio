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
    for (const t of ap.taxiways) for (let i = 0; i < t.pts.length - 1; i++) this.link(t.pts[i], t.pts[i + 1], t.name);
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
    // Holding points and stands snap onto the nearest taxiway segment.
    for (const hp of ap.holds) this.insertOnNearest(hp.pos);
    for (const s of ap.stands) {
      const n = this.nearestNode(s.pos, true);
      this.link(s.pos, this.nodes[n].p, 'apron');
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
  /** Split the closest edge at p. */
  private insertOnNearest(p: P2) {
    let best = { d: Infinity, i: -1, j: -1, twy: '' };
    this.nodes.forEach((n, i) => n.edges.forEach((e) => {
      if (e.to < i) return;
      const d = segDist(p, n.p, this.nodes[e.to].p);
      if (d < best.d) best = { d, i, j: e.to, twy: e.twy };
    }));
    if (best.i < 0) return;
    const a = this.nodes[best.i].p, b = this.nodes[best.j].p;
    this.unlink(best.i, best.j);
    this.link(a, p, best.twy); this.link(p, b, best.twy);
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

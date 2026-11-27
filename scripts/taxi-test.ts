// Taxi routes at every airport: stand -> holding point for each runway, and back.
// Flags routes whose legs leave the taxiway/runway/apron network (long "apron" links, gaps).
import { readFile } from 'node:fs/promises';
(globalThis as any).fetch = async (u: string) => {
  try { const b = await readFile('public' + u); return { ok: true, json: async () => JSON.parse(b.toString()) }; }
  catch { return { ok: false }; }
};
const { loadAirports } = await import('../src/airport/registry');
const { TaxiGraph } = await import('../src/airport/route');
const only = process.argv[2];
for (const ap of await loadAirports()) {
  if (only && ap.icao !== only) continue;
  const g = new TaxiGraph(ap);
  console.log(`\n${ap.icao}: ${ap.stands.length} stands (${ap.stands.map((s) => s.id).join(' ')}), holds ${ap.holds.map((h) => h.id).join(' ')}`);
  const st = ap.stands[Math.min(1, ap.stands.length - 1)];
  for (const [rid, hid] of Object.entries(ap.hpFor)) {
    const hp = ap.holds.find((h) => h.id === hid)!;
    const r = g.route(st.pos, hp.pos);
    const legs = r.pts.slice(1).map((p, i) => Math.hypot(p[0] - r.pts[i][0], p[1] - r.pts[i][1]));
    const end = r.pts[r.pts.length - 1];
    const miss = Math.hypot(end[0] - hp.pos[0], end[1] - hp.pos[1]);
    const start = Math.hypot(r.pts[0][0] - st.pos[0], r.pts[0][1] - st.pos[1]);
    const bad = !isFinite(r.length) || miss > 1 || start > 1;
    console.log(`${bad ? '✗' : ' '} ${st.id} -> ${hid.padEnd(8)} RWY ${rid.padEnd(4)} via ${r.names.join(', ').padEnd(30)} ${Math.round(r.length)} m, ${r.pts.length} pts, longest leg ${Math.round(Math.max(...legs))} m${miss > 1 ? `, ends ${Math.round(miss)} m from hold` : ''}`);
  }
}

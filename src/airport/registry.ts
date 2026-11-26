// All modelled airports. LKBE is hand-tuned (lkbe.ts); LKPM and LKPR come from the baked
// OSM extracts plus the facts below (VFR Manual / AIP ČR).
import type { Airport, P2, Stand } from './types';
import { lkbeAirport } from './lkbe';
import { airportFromOsm, AirportMeta, OsmAirportJson } from './osm-airport';
import { toLocal } from '../world/geo';

const BASE = import.meta.env.BASE_URL + 'data/';
export const ISLAND_IDS = ['LKPM', 'LKPR', 'LKVL', 'LKKV'];

const pickStands = (filter: (ref: string) => boolean, hdg: number, max = 5) => (all: { ref: string; pos: P2 }[]): Stand[] =>
  all.filter((s) => filter(s.ref)).sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true })).slice(0, max).map((s) => ({ id: s.ref, pos: s.pos, hdg }));

const META: Record<string, () => AirportMeta> = {
  LKPM: () => {
    const c = toLocal(49.72, 14.10028);
    return {
      icao: 'LKPM', name: 'Příbram', radio: 'Příbram RADIO 118.755', callName: 'Příbram RADIO', towered: false,
      elevFt: 1529, circuitFt: 2500, magVar: 5,
      // VFR Manual: circuits to the north only (RWY 24 right-hand, RWY 06 left-hand); avoid Občov
      circuit: { '06': 'L', '06L': 'L', '06R': 'L', '24': 'R', '24L': 'R', '24R': 'R' },
      centre: c, tower: { pos: [c[0] - 300, c[1] + 470], height: 8 },
      // OSM has no apron/stands here: grass parking in front of the hangar row (between TWY C and E)
      stands: () => {
        const a: P2 = [c[0] - 362, c[1] + 395], b: P2 = [c[0] - 647, c[1] + 589];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz, nz = ux; // normal towards the runway (north-west)
        return [0.2, 0.35, 0.5, 0.65].map((t, i) => ({ id: `P${i + 1}`, pos: [a[0] + ux * L * t + nx * 30, a[1] + uz * L * t + nz * 30] as P2, hdg: 326 }));
      },
    };
  },
  LKVL: () => {
    const c = toLocal(49.72889, 14.87889);
    const at = (x: number, z: number): P2 => [c[0] + x, c[1] + z];
    return {
      icao: 'LKVL', name: 'Vlašim', radio: 'Vlašim RADIO 119.655', callName: 'Vlašim RADIO', towered: false,
      elevFt: 1421, circuitFt: 2430, magVar: 5,
      // VFR Manual: RWY 13 left-hand, RWY 31 right-hand; after take-off 13 turn left 30° to avoid Vlašim
      circuit: { '13': 'L', '31': 'R' },
      centre: c, tower: { pos: at(150, -60), height: 6 },
      // OSM has only the runway: taxiway A from the apron by the hangars straight to the runway (backtrack to either end)
      extraTaxiways: [{ name: 'A', pts: [at(112, 18), at(59, 87), at(31.6, 122.3)], width: 12, paved: false }],
      extraAprons: [{ pts: [at(128, -28), at(186, -24), at(184, 16), at(126, 12)], paved: true }],
      holds: [{ id: 'A', label: 'A – RWY 13/31', pos: at(59, 87), on: 'A', runways: ['13', '31'], facing: at(31.6, 122.3) }],
      hpFor: { '13': 'A', '31': 'A' },
      stands: () => [[96, -14], [82, 4], [68, 22]].map(([x, z], i) => ({ id: `P${i + 1}`, pos: at(x, z), hdg: 217 })),
    };
  },
  LKKV: () => {
    const c = toLocal(50.20306, 12.915);
    return {
      icao: 'LKKV', name: 'Karlovy Vary', radio: 'Vary TOWER 121.230 · ATIS 127.640', callName: 'Vary TOWER', towered: true,
      elevFt: 1989, circuitFt: 3000, magVar: 5,
      // circuits south of the runway, away from the city (VFR chart AD 2-LKKV-VFRC)
      circuit: { '11': 'R', '29': 'L', '12': 'R', '30': 'L' },
      centre: c, tower: { pos: [c[0] - 330, c[1] + 140], height: 22 },
      standApron: 1, // the larger apron west of the terminal
    };
  },
  LKPR: () => {
    const c = toLocal(50.10167, 14.26333);
    return {
      icao: 'LKPR', name: 'Praha Ruzyně', radio: 'Praha TOWER 118.105', callName: 'Praha TOWER', towered: true,
      elevFt: 1234, circuitFt: 2500, magVar: 5,
      circuit: { '06': 'L', '24': 'R', '12': 'L', '30': 'R' },
      centre: c, tower: { pos: [c[0] + 520, c[1] + 380], height: 45 },
      stands: pickStands((r) => /^S\d+$/.test(r), 0), // GA apron South
      ignoreRunways: ['05/23'],
    };
  },
};

export async function loadAirports(): Promise<Airport[]> {
  const lkbeOsm = await (await fetch(BASE + 'airfield.json')).json();
  const out: Airport[] = [lkbeAirport(lkbeOsm)];
  for (const id of ISLAND_IDS) {
    try {
      const r = await fetch(`${BASE}${id}/airport.json`);
      if (!r.ok) continue;
      const j = (await r.json()) as OsmAirportJson;
      out.push(airportFromOsm(j, META[id]()));
    } catch (e) { console.warn('airport not available', id, e); }
  }
  return out;
}

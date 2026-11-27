// LKBE Benešov aerodrome layout in local metres (x east, z south, origin = ARP).
// Geometry from OpenStreetMap, checked against the ČÚZK orthophoto and the
// ŘLP VFR Manual aerodrome chart (VFR-AD-LKBE-ADC). Holding point positions are
// placed at the strip edges and are approximate: the flight school can move
// them here without touching any other code.

import type { P2, Runway, Taxiway, HoldingPoint, Stand, Airport, Road } from './types';
export type { P2, Runway, Taxiway, HoldingPoint, Stand } from './types';
export { rwyHeading, rwyLength } from './types';


const rw = (pair: string, a: P2, b: P2, width: number, strip: number, surface: string, lit = false): Runway[] => {
  const [ida, idb] = pair.split('/');
  return [
    { id: ida, pair, thr: a, end: b, width, strip, surface, lit },
    { id: idb, pair, thr: b, end: a, width, strip, surface, lit },
  ];
};

export const RUNWAYS: Runway[] = [
  ...rw('06/24', [-333, 46], [298, -293], 23, 60, 'reinforced grass', true),
  ...rw('09L/27R', [-381, 147], [365, 121], 40, 100, 'grass'),
  ...rw('09R/27L', [-381, 181], [365, 155], 18, 100, 'grass'),
];


export const TAXIWAYS: Taxiway[] = [
  { name: 'C', lit: true, pts: [[18, 314], [16, 260], [16, 250], [13, 183], [12, 145], [8, 47], [7, 4], [4, -82], [2, -86], [-18, -123]] },
  { name: 'D', pts: [[-310, 81], [2, -86], [315, -254], [301, -280]] },
  { name: 'B', pts: [[-224, 296], [-255, 216], [-280, 155], [-310, 81], [-329, 43]] },
  { name: 'A', pts: [[-224, 296], [-195, 291], [-160, 285], [-67, 269], [16, 250], [73, 235], [190, 207], [258, 191], [301, 186], [349, 180], [363, 175], [371, 170], [379, 159], [380, 148], [378, 132], [365, 133]] },
  { name: 'A1', pts: [[-262, 196], [-100, 278]] },
  { name: 'C2', pts: [[13, 183], [-67, 269]] },
  { name: 'C3', pts: [[13, 183], [73, 235]] },
  { name: 'apron', pts: [[-160, 285], [-150, 342]] },
  { name: 'apron', pts: [[-195, 291], [-188, 354]] },
];


// `facing` = a point the holding aircraft looks towards (the runway).
export const HOLDING_POINTS: HoldingPoint[] = [
  { id: 'C-S', label: 'C (south) – RWY 09/27', on: 'C', pos: [13.6, 197], runways: ['09L', '27R', '09R', '27L'], facing: [12, 145] },
  { id: 'C-N', label: 'C (north) – RWY 06/24', on: 'C', pos: [4.1, -78], runways: ['06', '24'], facing: [-18, -123] },
  { id: 'C-X', label: 'C – RWY 09/27 from north', on: 'C', pos: [9.4, 80], runways: ['09L', '27R', '09R', '27L'], facing: [12, 145] },
  { id: 'B-06', label: 'B – RWY 06', on: 'B', pos: [-307, 88], runways: ['06'], facing: [-329, 43] },
  { id: 'B-09', label: 'B – RWY 09', on: 'B', pos: [-252.7, 222], runways: ['09L', '09R'], facing: [-280, 155] },
  { id: 'A-27', label: 'A – RWY 27', on: 'A', pos: [305, 185.5], runways: ['27L', '27R'], facing: [365, 140] },
  { id: 'D-24', label: 'D – RWY 24', on: 'D', pos: [314, -256], runways: ['24'], facing: [298, -293] },
];

// Grass parking in front of the F-Air / hangar row; heading in degrees true.
export const STANDS: Stand[] = [
  { id: 'S1', pos: [-226, 318], hdg: 0 },
  { id: 'S2', pos: [-205, 322], hdg: 0 },
  { id: 'S3', pos: [-172, 318], hdg: 0 },
  { id: 'S4', pos: [-140, 320], hdg: 0 },
  { id: 'S5', pos: [-110, 318], hdg: 0 },
];

export const APRON: P2[] = [[-262, 300], [-90, 290], [40, 280], [45, 345], [-60, 350], [-150, 360], [-262, 352]];

export const WINDSOCKS: P2[] = [[-68, 298], [-99, -135]];
export const TOWER: { pos: P2; height: number } = { pos: [30, 335], height: 9 };

export const INFO = {
  icao: 'LKBE',
  name: 'Benešov',
  radio: 'Benešov RADIO 118.005',
  elevFt: 1322,
  circuitFt: 2460,
  magVar: 5, // degrees east
  // Circuits: RWY 06, 09L/R left hand; RWY 24, 27L/R right hand (VFR Manual).
  circuit: { '06': 'L', '24': 'R', '09L': 'L', '09R': 'L', '27L': 'R', '27R': 'R' } as Record<string, 'L' | 'R'>,
};


const HP_FOR: Record<string, string> = { '24': 'D-24', '06': 'B-06', '27L': 'A-27', '27R': 'A-27', '09L': 'B-09', '09R': 'B-09' };

/** LKBE as a generic Airport (boundary + roads come from the baked OSM extract). */
export function lkbeAirport(osm: { boundary: P2[]; roads: Road[] }): Airport {
  return {
    icao: INFO.icao, name: INFO.name, radio: INFO.radio, callName: 'Benešov RADIO', towered: false,
    elevFt: INFO.elevFt, circuitFt: INFO.circuitFt, magVar: INFO.magVar, circuit: INFO.circuit,
    centre: [0, 0], runways: RUNWAYS, taxiways: TAXIWAYS, holds: HOLDING_POINTS, hpFor: HP_FOR, stands: STANDS,
    parking: APRON, aprons: [{ pts: [[-150, 344], [-56, 339], [-54, 356], [-149, 362]], paved: true }],
    windsocks: WINDSOCKS, tower: TOWER, boundary: osm.boundary, roads: osm.roads,
    groundBox: { x0: -560, z0: -460, x1: 520, z1: 500 },
    // the school flies 06/24 practically always; with 24 in use the day's first take-off is from 27
    runwayUse: { usual: ['06', '24'], share: 0.99, firstDeparture: { '24': '27R' } },
  };
}

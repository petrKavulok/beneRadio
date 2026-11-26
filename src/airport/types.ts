// Common airport description used by the lesson, map, routing, ground painter and 3D furniture.
export type P2 = [number, number];

export interface Runway {
  id: string;        // designator for this direction, e.g. "24"
  pair: string;      // "06/24"
  thr: P2; end: P2;  // threshold, opposite end
  width: number; strip: number;
  surface: string;   // 'grass' | 'reinforced grass' | 'asphalt' | 'concrete' …
  lit?: boolean;
}
export interface Taxiway { name: string; pts: P2[]; lit?: boolean; width?: number; paved?: boolean }
export interface HoldingPoint { id: string; label: string; pos: P2; on: string; runways: string[]; facing: P2 }
export interface Stand { id: string; pos: P2; hdg: number }
export interface Apron { pts: P2[]; paved: boolean }
export interface Road { t: string; s: string; pts: P2[] }

export interface Airport {
  icao: string;
  name: string;
  radio: string;          // e.g. "Benešov RADIO 118.005" / "Praha TOWER 118.105"
  callName: string;       // how the station is addressed: "Benešov RADIO", "Praha TOWER"
  towered: boolean;
  elevFt: number;
  circuitFt: number;
  magVar: number;
  circuit: Record<string, 'L' | 'R'>;
  centre: P2;
  runways: Runway[];
  taxiways: Taxiway[];
  holds: HoldingPoint[];
  hpFor: Record<string, string>;   // runway id -> holding point id used for departures
  stands: Stand[];
  parking: P2[];                   // polygon: "parked on the apron" area
  aprons: Apron[];
  windsocks: P2[];
  tower: { pos: P2; height: number };
  boundary: P2[];
  roads: Road[];
  /** draw the painted ground for this airport (box in local metres) */
  groundBox: { x0: number; z0: number; x1: number; z1: number };
}

export function rwyHeading(r: Runway) {
  return (Math.atan2(r.end[0] - r.thr[0], -(r.end[1] - r.thr[1])) * 180 / Math.PI + 360) % 360;
}
export function rwyLength(r: Runway) { return Math.hypot(r.end[0] - r.thr[0], r.end[1] - r.thr[1]); }
export function isPaved(surface: string) { return /asphalt|concrete|paved|bitumen/.test(surface); }

export function inPoly(p: P2, poly: P2[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

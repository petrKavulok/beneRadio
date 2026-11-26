// World projection (same as scripts/config.mjs): local tangent plane at LKBE ARP,
// +x east, +z south (m). Plus Web-Mercator tile helpers for streamed data.
export const ORIGIN = { lat: 49.74083, lon: 14.64472 };
const R = 6378137, D2R = Math.PI / 180;
const COS0 = Math.cos(ORIGIN.lat * D2R);

export function toLocal(lat: number, lon: number): [number, number] {
  return [(lon - ORIGIN.lon) * D2R * R * COS0, -(lat - ORIGIN.lat) * D2R * R];
}
export function toLatLon(x: number, z: number): [number, number] {
  return [ORIGIN.lat + (-z / R) / D2R, ORIGIN.lon + (x / (R * COS0)) / D2R];
}

/** fractional tile coordinates of a lat/lon at zoom z */
export function tileXY(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin(lat * D2R);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y];
}
/** lat/lon of fractional tile coordinates */
export function tileLatLon(x: number, y: number, z: number): [number, number] {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / D2R;
  return [lat, lon];
}
/** local metres of fractional tile coordinates */
export function tileLocal(x: number, y: number, z: number): [number, number] {
  const [lat, lon] = tileLatLon(x, y, z);
  return toLocal(lat, lon);
}

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export const CZ_BOUNDS = { s: 48.5, n: 51.1, w: 12.0, e: 18.9 };

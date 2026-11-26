// Shared geo config for data scripts. World frame: local tangent plane,
// origin = LKBE ARP, +x = east (m), +z = south (m) (three.js: -z is north), y = up.
export const ORIGIN = { lat: 49.74083, lon: 14.64472 };
export const R = 6378137;
export const COS0 = Math.cos((ORIGIN.lat * Math.PI) / 180);

// Region: 11 x 11 tiles of 2 km => 22 x 22 km centred on the ARP.
export const TILE_M = 2000;
export const TILES = 11;
export const HALF = (TILE_M * TILES) / 2; // 11000 m

export function toLocal(lat, lon) {
  const x = ((lon - ORIGIN.lon) * Math.PI / 180) * R * COS0;
  const z = -((lat - ORIGIN.lat) * Math.PI / 180) * R;
  return [x, z];
}
export function toLatLon(x, z) {
  const lon = ORIGIN.lon + (x / (R * COS0)) * 180 / Math.PI;
  const lat = ORIGIN.lat + (-z / R) * 180 / Math.PI;
  return [lat, lon];
}
// bbox (deg) for a local-metre rectangle
export function bboxDeg(x0, z0, x1, z1) {
  const [latN, lonW] = toLatLon(x0, z0);
  const [latS, lonE] = toLatLon(x1, z1);
  return { s: latS, w: lonW, n: latN, e: lonE };
}
export const REGION = bboxDeg(-HALF, -HALF, HALF, HALF);

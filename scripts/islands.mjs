// Detail islands (baked high-res data) around airports other than LKBE.
// LKBE keeps its original 22 km region in public/data/ (scripts/fetch-cuzk.mjs + build-data.mjs).
import { toLocal } from './config.mjs';

export const ISLANDS = {
  LKPM: { name: 'Příbram', arp: [49.72, 14.10028], tiles: 4, fixLevels: false },
  LKPR: { name: 'Praha Ruzyně', arp: [50.10167, 14.26333], tiles: 5, fixLevels: false },
  LKVL: { name: 'Vlašim', arp: [49.72889, 14.87889], tiles: 3, fixLevels: false },
  // big island: airport + the whole city of Karlovy Vary and the Ohře valley; 7 m DEM keeps the file small
  LKKV: { name: 'Karlovy Vary', arp: [50.20306, 12.915], tiles: 7, fixLevels: false, demRes: 7 },
};

/** Island geometry in local metres: square of `tiles` × 2 km centred on the ARP. */
export function islandBox(id) {
  const isl = ISLANDS[id];
  if (!isl) throw new Error(`unknown island ${id}`);
  const [cx, cz] = toLocal(isl.arp[0], isl.arp[1]);
  const size = isl.tiles * 2000;
  return { id, ...isl, cx, cz, size, x0: cx - size / 2, z0: cz - size / 2, x1: cx + size / 2, z1: cz + size / 2 };
}

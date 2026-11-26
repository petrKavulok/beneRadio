// Direct-to navigation: distance, course and time to a destination airport.
import type { Airport, P2 } from './airport/types';

export interface NavInfo { icao: string; name: string; to: P2; distNm: number; brgTrue: number; brgMag: number; eteMin: number | null }

export function navTo(ap: Airport | null, x: number, z: number, gsKt: number, magVar = 5): NavInfo | null {
  if (!ap) return null;
  const dx = ap.centre[0] - x, dz = ap.centre[1] - z;
  const dist = Math.hypot(dx, dz);
  const brgTrue = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  const distNm = dist / 1852;
  return {
    icao: ap.icao, name: ap.name, to: ap.centre, distNm, brgTrue,
    brgMag: (brgTrue - magVar + 360) % 360,
    eteMin: gsKt > 30 ? (distNm / gsKt) * 60 : null,
  };
}
export const fmtBrg = (b: number) => String(Math.round(b) % 360 || 360).padStart(3, '0');

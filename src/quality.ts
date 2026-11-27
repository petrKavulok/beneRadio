// Low-memory mode for phones: iOS Safari kills a tab that uses too much (GPU) memory, and the full set of
// baked orthophoto tiles is ~840 MB of textures. Phones get smaller tiles, a smaller shadow map and a lower
// render resolution. Override with ?lowmem=1 / ?lowmem=0.
const q = new URLSearchParams(location.search).get('lowmem');
const ua = navigator.userAgent;
const smallTouch = navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 600;
const devMem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
export const LOW_MEM = q !== null ? q === '1' : /iPhone|iPod|Android.+Mobile/.test(ua) || smallTouch || devMem <= 3;

/** Max orthophoto tile width per detail ring (null = keep the original size). */
export const orthoMaxWidth = (ring: number): number | null => (LOW_MEM ? (ring <= 1 ? 1024 : ring === 2 ? 512 : 256) : null);

/** Phones keep fewer streamed height tiles in memory. */
export const ELEV_CACHE = LOW_MEM ? 40 : 300;

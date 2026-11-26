// Procedural building textures (near-white so per-building vertex colours can tint them).
// Wall tiles are 4 m wide × 3 m (one floor) tall; roof tiles 2 m × 2 m.
import * as THREE from 'three';

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return { c, g: c.getContext('2d')! }; }
function tex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function grain(g: CanvasRenderingContext2D, w: number, h: number, amt: number, seed: number) {
  const img = g.getImageData(0, 0, w, h), d = img.data, R = rng(seed);
  for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
}

/** Plaster wall, one window per 4 m × 3 m tile (sill at 0.85 m, 1.2 × 1.3 m window). */
function plasterWindow() {
  const W = 256, H = 192, px = W / 4; // 64 px per metre
  const { c, g } = canvas(W, H);
  g.fillStyle = '#f2efe9'; g.fillRect(0, 0, W, H);
  grain(g, W, H, 14, 1);
  // plinth shadow at the very bottom of the floor (only visible on the ground floor)
  const y = (m: number) => H - m * px;
  const wx = W / 2 - 0.6 * px, ww = 1.2 * px, wy = y(0.85 + 1.3), wh = 1.3 * px;
  g.fillStyle = '#d9d5cc'; g.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);           // reveal
  g.fillStyle = '#fbfbfa'; g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);             // frame
  const glass = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
  glass.addColorStop(0, '#5d7a8f'); glass.addColorStop(0.45, '#2c3c4a'); glass.addColorStop(1, '#1d2730');
  g.fillStyle = glass; g.fillRect(wx, wy, ww, wh);
  g.fillStyle = '#fbfbfa'; g.fillRect(wx + ww / 2 - 2, wy, 4, wh); g.fillRect(wx, wy + wh * 0.32, ww, 3); // mullions
  g.fillStyle = '#c9c4ba'; g.fillRect(wx - 8, wy + wh + 3, ww + 16, 5);           // sill
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(wx - 8, wy + wh + 8, ww + 16, 3);
  return tex(c);
}

/** Corrugated metal cladding (hangars, barns, industry). */
function corrugated() {
  const W = 256, H = 192, { c, g } = canvas(W, H);
  for (let x = 0; x < W; x++) { const v = 222 + 22 * Math.sin((x / W) * Math.PI * 2 * 20); g.fillStyle = `rgb(${v},${v},${v + 3})`; g.fillRect(x, 0, 1, H); }
  g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, H - 10, W, 10);
  grain(g, W, H, 8, 2);
  return tex(c);
}

/** Clay roof tiles in rows (2 m × 2 m tile, rows ~0.33 m). */
function clayTiles() {
  const S = 256, { c, g } = canvas(S, S), R = rng(3);
  g.fillStyle = '#e9e4df'; g.fillRect(0, 0, S, S);
  const rows = 6, cols = 10, rh = S / rows, cw = S / cols;
  for (let r = 0; r < rows; r++) for (let k = -1; k <= cols; k++) {
    const x = k * cw + (r % 2) * cw / 2, y0 = r * rh;
    const tone = 222 + R() * 30;
    const gr = g.createLinearGradient(x, 0, x + cw, 0);
    gr.addColorStop(0, `rgb(${tone - 40},${tone - 40},${tone - 40})`); gr.addColorStop(0.5, `rgb(${tone},${tone},${tone})`); gr.addColorStop(1, `rgb(${tone - 50},${tone - 50},${tone - 50})`);
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(x, y0); g.lineTo(x + cw, y0); g.lineTo(x + cw, y0 + rh * 0.85); g.quadraticCurveTo(x + cw / 2, y0 + rh * 1.12, x, y0 + rh * 0.85); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, y0 + rh * 0.84, cw, 2);
  }
  grain(g, S, S, 10, 4);
  return tex(c);
}

/** Standing-seam metal roof. */
function metalRoof() {
  const S = 256, { c, g } = canvas(S, S);
  g.fillStyle = '#e6e8ea'; g.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += S / 8) { g.fillStyle = '#ffffff'; g.fillRect(x, 0, 3, S); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 3, 0, 2, S); }
  grain(g, S, S, 6, 5);
  return tex(c);
}

/** Gravel / bitumen flat roof. */
function gravel() {
  const S = 256, { c, g } = canvas(S, S);
  g.fillStyle = '#d6d6d2'; g.fillRect(0, 0, S, S);
  grain(g, S, S, 60, 6);
  return tex(c);
}

let cache: ReturnType<typeof make> | null = null;
function make() {
  const mat = (map: THREE.Texture) => new THREE.MeshLambertMaterial({ map, vertexColors: true, side: THREE.DoubleSide });
  return {
    wall: mat(plasterWindow()),
    metal: mat(corrugated()),
    tiles: mat(clayTiles()),
    seam: mat(metalRoof()),
    flat: mat(gravel()),
  };
}
/** Shared building materials, created once. Index order = material slot. */
export function buildingMaterials() {
  if (!cache) cache = make();
  return [cache.wall, cache.metal, cache.tiles, cache.seam, cache.flat];
}
export const SLOT = { wall: 0, metal: 1, tiles: 2, seam: 3, flat: 4 } as const;

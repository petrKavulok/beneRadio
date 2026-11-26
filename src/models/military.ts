// Czech Air Force-style military livery for the P2006T: two-tone grey (darker upper surfaces),
// matte anti-glare panel, blue-white-red roundels (fuselage, wings top/bottom), tricolour fin
// flash, 4-digit serial and stencils. Markings are placed by 3D position on the model; the
// texture position/orientation is derived from the UV mapping of the triangle underneath.
import * as THREE from 'three';

const N = 2048;
const SKIP = new Set(['roueA', 'roueG', 'roueD', 'heliceG', 'heliceD', 'propdiscG', 'propdiscD', 'propblurG', 'propblurD', 'echappement', 'trous', 'axeAB', 'axeAH', 'axeGB', 'axeGH', 'axeDB', 'axeDH', 'lampes']);
const CZ_BLUE = '#11457e', CZ_RED = '#d7141a';

interface Tri { p: THREE.Vector3[]; uv: THREE.Vector2[]; n: THREE.Vector3; name: string }

function triangles(meshes: THREE.Mesh[]) {
  const out: Tri[] = [];
  for (const m of meshes) {
    const pos = m.geometry.attributes.position, uv = m.geometry.attributes.uv;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const p = [0, 1, 2].map((k) => new THREE.Vector3(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)));
      const u = [0, 1, 2].map((k) => new THREE.Vector2(uv.getX(i + k), uv.getY(i + k)));
      const n = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]));
      if (n.lengthSq() < 1e-12) continue;
      out.push({ p, uv: u, n: n.normalize(), name: m.name });
    }
  }
  return out;
}

/** Canvas transform drawing in metres on the surface near `pt` (x = `right`, y = -`up`). */
function decalFrame(tris: Tri[], pt: THREE.Vector3, normal: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, only?: string[]) {
  let best: { t: Tri; d: number; q: THREE.Vector3 } | null = null;
  const tmp = new THREE.Triangle(), q = new THREE.Vector3();
  for (const t of tris) {
    if (only && !only.includes(t.name)) continue;
    if (t.n.dot(normal) < 0.35) continue;
    tmp.set(t.p[0], t.p[1], t.p[2]); tmp.closestPointToPoint(pt, q);
    const d = q.distanceTo(pt);
    if (!best || d < best.d) best = { t, d, q: q.clone() };
  }
  if (!best) return null;
  const { t, q: hit } = best;
  const e1 = t.p[1].clone().sub(t.p[0]), e2 = t.p[2].clone().sub(t.p[0]);
  const du1 = t.uv[1].clone().sub(t.uv[0]), du2 = t.uv[2].clone().sub(t.uv[0]);
  const d11 = e1.dot(e1), d12 = e1.dot(e2), d22 = e2.dot(e2), det = d11 * d22 - d12 * d12;
  const toUv = (d: THREE.Vector3) => { // d in-plane 3D vector -> uv delta
    const a = (d22 * d.dot(e1) - d12 * d.dot(e2)) / det, b = (d11 * d.dot(e2) - d12 * d.dot(e1)) / det;
    return du1.clone().multiplyScalar(a).add(du2.clone().multiplyScalar(b));
  };
  const nrm = t.n;
  const flat = (v: THREE.Vector3) => v.clone().addScaledVector(nrm, -v.dot(nrm)).normalize();
  const uvHit = t.uv[0].clone().add(toUv(hit.clone().sub(t.p[0])));
  const R = toUv(flat(right)), U = toUv(flat(up));
  // canvas: px = u*N, py = (1-v)*N; drawing +x = right, +y = down (= -up)
  return { a: R.x * N, b: -R.y * N, c: -U.x * N, d: U.y * N, e: uvHit.x * N, f: (1 - uvHit.y) * N };
}

function roundel(g: CanvasRenderingContext2D, r: number) {
  // Czech roundel: blue sector at the hoist side (left), white upper right, red lower right
  const sector = (a0: number, a1: number, col: string) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r, a0, a1); g.closePath(); g.fill(); };
  sector(Math.PI * 2 / 3, Math.PI * 4 / 3, CZ_BLUE);
  sector(Math.PI * 4 / 3, Math.PI * 2, '#f4f4f4');
  sector(0, Math.PI * 2 / 3, CZ_RED);
}
function finFlash(g: CanvasRenderingContext2D, w: number) {
  const h = w * 2 / 3;
  g.fillStyle = '#f4f4f4'; g.fillRect(-w / 2, -h / 2, w, h / 2);
  g.fillStyle = CZ_RED; g.fillRect(-w / 2, 0, w, h / 2);
  g.fillStyle = CZ_BLUE; g.beginPath(); g.moveTo(-w / 2, -h / 2); g.lineTo(0, 0); g.lineTo(-w / 2, h / 2); g.closePath(); g.fill();
}

export function makeMilitaryLivery(base: HTMLImageElement, root: THREE.Object3D, serial: string) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !SKIP.has(m.name) && m.geometry.attributes.uv) { const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial; if (mat.map && (mat.userData.livery || (mat.map.image as HTMLImageElement)?.width === 2048) && !mat.transparent) meshes.push(m); } });
  const tris = triangles(meshes);

  const src = document.createElement('canvas'); src.width = src.height = N;
  const sg = src.getContext('2d', { willReadFrequently: true })!; sg.drawImage(base, 0, 0, N, N);
  const orig = sg.getImageData(0, 0, N, N).data;

  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(base, 0, 0, N, N);
  // 1) two-tone grey by surface orientation (upper surfaces darker), painted triangle by triangle
  const light = [168, 175, 180], dark = [104, 111, 117];
  const mask = document.createElement('canvas'); mask.width = mask.height = N;
  const mg = mask.getContext('2d', { willReadFrequently: true })!; mg.fillStyle = '#fff';
  for (const t of tris) {
    const k = THREE.MathUtils.smoothstep(t.n.y, -0.15, 0.55);
    const col = light.map((l, i) => Math.round(l + (dark[i] - l) * k));
    const P = t.uv.map((u) => [u.x * N, (1 - u.y) * N]);
    for (const ctx of [g, mg]) {
      ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); ctx.lineTo(P[1][0], P[1][1]); ctx.lineTo(P[2][0], P[2][1]); ctx.closePath();
      if (ctx === g) { g.fillStyle = `rgb(${col})`; g.strokeStyle = `rgb(${col})`; g.lineWidth = 2.5; g.fill(); g.stroke(); } else { mg.fill(); mg.lineWidth = 2.5; mg.strokeStyle = '#fff'; mg.stroke(); }
    }
  }
  // 2) matte anti-glare panel on top of the nose ahead of the windscreen
  for (const t of tris) {
    if (t.name !== 'fuselage') continue;
    const cz = (t.p[0].z + t.p[1].z + t.p[2].z) / 3;
    if (cz < -3.5 || cz > -1.85 || t.n.y < 0.45) continue;
    const P = t.uv.map((u) => [u.x * N, (1 - u.y) * N]);
    g.beginPath(); g.moveTo(P[0][0], P[0][1]); g.lineTo(P[1][0], P[1][1]); g.lineTo(P[2][0], P[2][1]); g.closePath();
    g.fillStyle = '#2b2e31'; g.strokeStyle = '#2b2e31'; g.lineWidth = 2; g.fill(); g.stroke();
  }
  // 3) markings placed in 3D
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const draw = (pt: THREE.Vector3, n: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, fn: (g: CanvasRenderingContext2D) => void, only?: string[]) => {
    const f = decalFrame(tris, pt, n, right, up, only);
    if (!f) return;
    g.save(); g.setTransform(f.a, f.b, f.c, f.d, f.e, f.f); fn(g); g.restore();
  };
  const text = (s: string, h: number, col = '#16181a', font = '700') => (gg: CanvasRenderingContext2D) => {
    gg.fillStyle = col; gg.font = `${font} ${h}px "Arial Narrow", Arial, sans-serif`; gg.textAlign = 'center'; gg.textBaseline = 'middle'; gg.fillText(s, 0, 0);
  };
  for (const s of [-1, 1]) {
    const side = V(s, 0, 0), right = V(0, 0, s < 0 ? 1 : -1), up = V(0, 1, 0);
    const fwd = (fn: (gg: CanvasRenderingContext2D) => void) => (gg: CanvasRenderingContext2D) => { if (s > 0) gg.scale(-1, 1); fn(gg); }; // hoist side forward on both sides
    draw(V(s * 0.7, 0.15, 2.55), side, right, up, fwd((gg) => roundel(gg, 0.3)), ['fuselage']);           // fuselage roundel
    draw(V(s * 0.12, 0.95, 4.35), side, right, up, fwd((gg) => finFlash(gg, 0.42)), ['fuselage']);         // fin flash
    draw(V(s * 0.12, 0.5, 4.25), side, right, up, text(serial, 0.22), ['fuselage']);                   // serial on the fin
    draw(V(s * 0.95, -0.45, -1.55), side, right, up, text('VZDUŠNÉ SÍLY AČR', 0.085, '#1b1d1f', '700'), ['fuselage']);
    draw(V(s * 0.9, -0.2, 0.35), side, right, up, text('NO STEP', 0.05, '#2a2c2e', '600'), ['fuselage']);
    // wing roundels: upper surface and underside, outboard of the engines
    draw(V(s * 4.1, 1.3, 0.3), V(0, 1, 0), V(1, 0, 0), V(0, 0, -1), (gg) => roundel(gg, 0.42), ['ailes']);
    draw(V(s * 4.1, -0.1, 0.3), V(0, -1, 0), V(1, 0, 0), V(0, 0, 1), (gg) => roundel(gg, 0.42), ['ailes']);
    draw(V(s * 4.1, -0.1, 0.75), V(0, -1, 0), V(1, 0, 0), V(0, 0, 1), text(serial, 0.3), ['ailes']);
  }
  // 4) multiply by the baked shading of the white texture inside the painted mask
  const out = g.getImageData(0, 0, N, N), d = out.data, md = mg.getImageData(0, 0, N, N).data;
  for (let i = 0; i < d.length; i += 4) {
    if (md[i] < 128) { d[i] = orig[i]; d[i + 1] = orig[i + 1]; d[i + 2] = orig[i + 2]; continue; }
    const lum = 0.3 * orig[i] + 0.59 * orig[i + 1] + 0.11 * orig[i + 2];
    const shade = Math.min(1.08, Math.max(0.45, lum / 228));
    d[i] *= shade; d[i + 1] *= shade; d[i + 2] *= shade;
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

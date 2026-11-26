// "Hot Rod Flames" livery: gloss-white base with classic 90s/00s custom-paint
// flame licks (yellow → orange → red, thin dark-red pinstripe) on fuselage and wings.
// Flames are clipped to the model's own UV triangles so they never bleed onto other parts.
import * as THREE from 'three';

const N = 2048, K = N / 1932; // layout measured on a 1932-px preview of the atlas
const SKIP = new Set(['roueA', 'roueG', 'roueD', 'helice', 'propdisc', 'propblur', 'echappe', 'antennes', 'trous', 'troucacheA', 'troucacheG', 'troucacheD', 'axeA', 'marchepieds']);

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Path2D of mesh triangles (texture pixels) passing `keep(normal, centroid)`. */
function triPath(meshes: THREE.Mesh[], keep: (ny: number, cx: number) => boolean) {
  const p = new Path2D();
  for (const m of meshes) {
    const uv = m.geometry.attributes.uv, pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal;
    for (let i = 0; i + 2 < uv.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const ny = (nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2)) / 3;
      if (!keep(ny, cx)) continue;
      p.moveTo(uv.getX(i) * N, (1 - uv.getY(i)) * N);
      p.lineTo(uv.getX(i + 1) * N, (1 - uv.getY(i + 1)) * N);
      p.lineTo(uv.getX(i + 2) * N, (1 - uv.getY(i + 2)) * N);
      p.closePath();
    }
  }
  return p;
}

interface FlameSet { base: [number, number]; across: [number, number]; width: number; dir: [number, number]; count: number; len: [number, number]; seed: number }

/** Draw one set of flame licks rising from a baseline (all in 1932-px preview units). */
function flameSet(g: CanvasRenderingContext2D, f: FlameSet, clip: Path2D) {
  const R = rng(f.seed);
  const [dx, dy] = f.dir, [ax, ay] = f.across;
  const licks: Path2D[] = [];
  const lw = f.width / f.count;
  const at = (s: number, t: number, o: [number, number]): [number, number] => [(o[0] + dx * s + ax * t) * K, (o[1] + dy * s + ay * t) * K];
  for (let i = 0; i < f.count; i++) {
    const o: [number, number] = [f.base[0] + ax * lw * (i + 0.5), f.base[1] + ay * lw * (i + 0.5)];
    const L = f.len[0] + (f.len[1] - f.len[0]) * (0.35 + 0.65 * R()) * (i % 2 ? 0.8 : 1);
    const w = lw * (0.75 + 0.25 * R());
    const a = (R() - 0.5) * w * 1.9;      // S-curve swing
    const tip = (0.25 + R() * 0.9) * w * (R() < 0.5 ? -1 : 1); // tip curls to one side
    const p = new Path2D();
    p.moveTo(...at(-60, -w, o));
    p.lineTo(...at(0, -w, o));
    p.bezierCurveTo(...at(L * 0.35, -w + a, o), ...at(L * 0.7, tip - w * 0.8 - a * 0.6, o), ...at(L, tip, o));
    p.bezierCurveTo(...at(L * 0.78, tip + w * 0.15 - a * 0.4, o), ...at(L * 0.45, w + a * 0.7, o), ...at(0, w, o));
    p.lineTo(...at(-60, w, o));
    p.closePath();
    licks.push(p);
  }
  g.save();
  g.clip(clip);
  const s0 = at(0, 0, f.base), s1 = at(f.len[1] * 0.9, 0, f.base);
  const grad = g.createLinearGradient(s0[0], s0[1], s1[0], s1[1]);
  grad.addColorStop(0, '#ffe04a'); grad.addColorStop(0.22, '#ffb21a'); grad.addColorStop(0.48, '#ff6a10');
  grad.addColorStop(0.75, '#dd2410'); grad.addColorStop(1, '#a00c0c');
  // flame body, slightly soft-edged like airbrushed paint
  g.filter = `blur(${1.1 * K}px)`;
  g.fillStyle = grad; licks.forEach((p) => g.fill(p));
  g.filter = 'none';
  // thin pinstripe on the OUTER outline only (stroke, then erase the interior)
  const o = document.createElement('canvas'); o.width = o.height = N;
  const og = o.getContext('2d')!;
  og.lineJoin = 'round'; og.strokeStyle = '#7d0a12'; og.lineWidth = 5 * K;
  licks.forEach((p) => og.stroke(p));
  og.globalCompositeOperation = 'destination-out';
  licks.forEach((p) => og.fill(p));
  g.drawImage(o, 0, 0);
  g.restore();
}

export function makeFlameLivery(base: HTMLImageElement | ImageBitmap, root: THREE.Object3D, reg: string) {
  const baseTex = (m: THREE.Mesh) => {
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
    return mats.some((mm) => mm.map && (mm.map.image === base || mm.userData.livery));
  };
  const ext: THREE.Mesh[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !SKIP.has(m.name) && baseTex(m)) ext.push(m); });
  const byName = (...n: string[]) => ext.filter((m) => n.includes(m.name));

  // original texture (for shading) + paint mask
  const src = document.createElement('canvas'); src.width = src.height = N;
  const sg = src.getContext('2d')!; sg.drawImage(base, 0, 0, N, N);
  const orig = sg.getImageData(0, 0, N, N).data;
  const maskC = document.createElement('canvas'); maskC.width = maskC.height = N;
  const mg = maskC.getContext('2d')!;
  mg.fillStyle = '#fff'; mg.strokeStyle = '#fff'; mg.lineWidth = 3;
  const all = triPath(ext, () => true);
  mg.fill(all); mg.stroke(all);
  const mask = mg.getImageData(0, 0, N, N).data;

  // paint layer: candy base + flames + lettering (unshaded colours)
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, N, N); // gloss white base

  const fus = byName('fuselage');
  const sideA = triPath(fus, (_ny, cx) => cx < 0), sideB = triPath(fus, (_ny, cx) => cx > 0);
  const wingTop = triPath(byName('ailes', 'aileronG', 'aileronD', 'voletG', 'voletD'), (ny) => ny > 0.25);
  const pants = triPath(byName('cacheA', 'cacheG', 'cacheD'), () => true);
  // fuselage: from the nose back past the cockpit, drifting with the fuselage taper
  flameSet(g, { base: [175, 285], across: [0, 1], width: 250, dir: [0.996, -0.085], count: 9, len: [560, 980], seed: 7 }, sideA);
  flameSet(g, { base: [1755, 585], across: [0, 1], width: 255, dir: [-0.996, -0.08], count: 9, len: [560, 980], seed: 7 }, sideB);
  // wings: licks run chordwise from the leading edge, across the whole span
  flameSet(g, { base: [60, 790], across: [1, 0], width: 690, dir: [-0.38, 0.92], count: 8, len: [200, 340], seed: 21 }, wingTop);
  flameSet(g, { base: [690, 790], across: [1, 0], width: 690, dir: [0.38, 0.92], count: 8, len: [200, 340], seed: 34 }, wingTop);
  // wheel pants: small flames from the front
  flameSet(g, { base: [1380, 1235], across: [0, 1], width: 195, dir: [1, 0], count: 4, len: [120, 200], seed: 5 }, pants);

  // registration in chrome-silver with a dark outline
  g.save();
  g.font = `700 ${56 * K}px "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#1d1d22';
  for (const [x, y] of [[1530, 368], [440, 706]] as const) g.fillText(reg, x * K, y * K);
  g.restore();

  // combine: paint × baked shading inside the mask; keep dark details (canopy, swoosh lines) as original
  const out = g.getImageData(0, 0, N, N), d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = orig[i], gg = orig[i + 1], b = orig[i + 2];
    const lum = 0.3 * r + 0.59 * gg + 0.11 * b;
    const px = (i >> 2) % N / K, py = Math.floor((i >> 2) / N) / K;
    const canopy = (px > 440 && px < 925 && py > 175 && py < 352) || (px > 995 && px < 1495 && py > 510 && py < 692);
    if (mask[i] < 128 || (lum < 45 && canopy)) { d[i] = r; d[i + 1] = gg; d[i + 2] = b; continue; }
    const blue = b > r + 60 && b > gg + 40;
    const shade = lum < 45 ? 0.95 : Math.min(1.12, Math.max(0.45, blue ? b / 205 : lum / 222));
    d[i] = Math.min(255, d[i] * shade); d[i + 1] = Math.min(255, d[i + 1] * shade); d[i + 2] = Math.min(255, d[i + 2] * shade);
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

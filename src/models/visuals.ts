// Aircraft visuals the user can choose between: detailed FlightGear P2002 or the original simple model.
import * as THREE from 'three';
import { parseAC, buildAC } from './ac3d';
import { buildP2002Model, animateModel } from '../sim/p2002';
import { Controls } from '../sim/fdm';
import { makeSchoolLivery } from './livery';
import { makeFlameLivery } from './flames';

export interface AircraftVisual {
  root: THREE.Object3D;
  eye: THREE.Vector3;
  animate(c: Controls, rpm: number, dt: number, groundSpeed: number, cockpit: boolean, extra?: { gearPos?: number; rpms?: number[] }): void;
  setLivery(name: string, reg?: string): void;
  clone(livery?: string): AircraftVisual;
}

export const VISUAL_OPTIONS = [
  { id: 'detailed', label: 'Tecnam P2002 Sierra' },
  { id: 'simple', label: 'Tecnam P2002 (simple model)' },
  { id: 'p2006t', label: 'Tecnam P2006T twin' },
] as const;
export type VisualId = typeof VISUAL_OPTIONS[number]['id'];

/** Registration painted on the LKBE school livery. */
export const livreg = { reg: 'OK-SIM', military: '0731' };
export const SCHOOL = 'LKBE-School';
export const FLAMES = 'Hot-Rod-Flames';
export const LIVERIES = [SCHOOL, FLAMES, 'Default', 'Classic-Red', 'Classic-Blue', 'Blue-Yellow', 'orange', 'White'];

// ---------- simple (original) ----------
const SIMPLE_LIVERY: Record<string, { body: number; stripe: number; stripe2: number }> = {
  Default: { body: 0xf4f4f2, stripe: 0xc8102e, stripe2: 0x1d3b8a },
  'LKBE-School': { body: 0xf6f6f4, stripe: 0x11457e, stripe2: 0xd7141a },
  'Hot-Rod-Flames': { body: 0xf4f4f2, stripe: 0xff6a10, stripe2: 0xffb21a },
  'Classic-Red': { body: 0xf4f4f2, stripe: 0xc8102e, stripe2: 0x888888 },
  'Classic-Blue': { body: 0xf4f4f2, stripe: 0x1d3b8a, stripe2: 0x999999 },
  'Blue-Yellow': { body: 0xf2f2f2, stripe: 0x1d3b8a, stripe2: 0xf2c500 },
  orange: { body: 0xfbfbfb, stripe: 0xff8f00, stripe2: 0x333333 },
  White: { body: 0xf6f6f6, stripe: 0xdddddd, stripe2: 0xbbbbbb },
};
export function simpleVisual(livery = 'Default'): AircraftVisual {
  const root = buildP2002Model(SIMPLE_LIVERY[livery] ?? SIMPLE_LIVERY.Default);
  const glare = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.42), new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.9 }));
  glare.position.set(0, 0.1, -0.9);
  root.add(glare);
  const v: AircraftVisual = {
    root, eye: new THREE.Vector3(-0.3, 0.42, -0.15),
    animate(c, rpm, dt, _gs, cockpit) {
      animateModel(root, c, rpm, dt);
      glare.visible = cockpit;
      if (cockpit) root.getObjectByName('disc')!.visible = false;
    },
    setLivery() { /* simple model: livery picked at build time */ },
    clone: (l) => simpleVisual(l ?? livery),
  };
  return v;
}

// ---------- detailed (FlightGear P2002 Sierra by helijah, GPL) ----------
const BASE = import.meta.env.BASE_URL + 'models/p2002/';
const SHIFT = 1.35; // FG model origin -> sim CG (m, aft)

interface Loaded { ext: ReturnType<typeof parseAC>; int: ReturnType<typeof parseAC>; panel: ReturnType<typeof parseAC>; seat: ReturnType<typeof parseAC>; tex: Map<string, THREE.Texture> }
let loaded: Promise<Loaded> | null = null;

function loadAll() {
  if (loaded) return loaded;
  const tl = new THREE.TextureLoader();
  const tex = async (file: string) => {
    const t = await tl.loadAsync(BASE + file);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  };
  const txt = (f: string) => fetch(BASE + f).then((r) => { if (!r.ok) throw new Error(f); return r.text(); });
  loaded = (async () => {
    const [ext, int, panel, seat, tx, ti, tp, ts] = await Promise.all([
      txt('p2002.ac'), txt('interior.ac'), txt('panel.ac'), txt('seat.ac'),
      tex('texture.png'), tex('interior.png'), tex('panel.png'), tex('seat.png'),
    ]);
    const map = new Map([['texture.png', tx], ['interior.png', ti], ['panel.png', tp], ['seat.png', ts]]);
    return { ext: parseAC(ext), int: parseAC(int), panel: parseAC(panel), seat: parseAC(seat), tex: map };
  })();
  return loaded;
}

const liveryCache = new Map<string, Promise<THREE.Texture>>();
function liveryTexture(name: string, fallback: THREE.Texture) {
  if (name === 'Default') return Promise.resolve(fallback);
  if (name === SCHOOL) return Promise.resolve(makeSchoolLivery(fallback.image as HTMLImageElement, livreg.reg));
  let p = liveryCache.get(name);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(`${BASE}liveries/${name}.png`).then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; });
    liveryCache.set(name, p);
  }
  return p;
}

/** FG point (x aft, y right, z up) -> sim body coordinates. */
const fg = (x: number, y: number, z: number) => new THREE.Vector3(y, z, x + SHIFT);

/** Move a mesh under a pivot at `center`, rotating about `axis` (sim coords). */
function pivot(root: THREE.Object3D, names: string[], center: THREE.Vector3, axis: THREE.Vector3) {
  const p = new THREE.Group();
  p.position.copy(center);
  p.userData.axis = axis.clone().normalize();
  root.add(p);
  for (const n of names) {
    const m = root.getObjectByName(n);
    if (!m) continue;
    root.remove(m); m.position.sub(center); p.add(m);
  }
  return p;
}
const hinge = (a: THREE.Vector3, b: THREE.Vector3) => ({ c: a.clone(), ax: b.clone().sub(a) });

export async function detailedVisual(livery = 'Default'): Promise<AircraftVisual> {
  const L = await loadAll();
  const textures = (n: string) => L.tex.get(n) ?? null;
  const skipExt = (n: string) => n.startsWith('HDR') || n.startsWith('lampe');
  const root = new THREE.Group();
  root.add(buildAC(L.ext, { textures, offset: new THREE.Vector3(SHIFT, 0, 0), skip: skipExt }));
  const cabin = new THREE.Group();
  cabin.add(buildAC(L.int, { textures, offset: new THREE.Vector3(SHIFT, 0, 0), skip: (n) => n.startsWith('HDR') || n.includes('vitre') }));
  cabin.add(buildAC(L.panel, { textures, offset: new THREE.Vector3(SHIFT - 1.65272, 0, 0.14395) }));
  for (const y of [-0.26, 0.26]) cabin.add(buildAC(L.seat, { textures, offset: new THREE.Vector3(SHIFT - 0.9, y, 0.1) }));
  root.add(cabin);
  // flatten: make every named mesh a direct child of root so pivots can grab them
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const ext = root.children[0];
  for (const m of meshes) if (m.parent === ext) { ext.remove(m); root.add(m); }

  // Animated parts (centres/axes from the FlightGear p2002.xml)
  const prop = pivot(root, ['propdisc', 'propblur', 'helice', 'bol'], fg(-3.06552, 0, -0.04161), fg(-1, 0, 0).sub(fg(0, 0, 0)));
  const elev = pivot(root, ['profondeur'], fg(3.02911, 0, 0.00235), new THREE.Vector3(1, 0, 0));
  const r = hinge(fg(2.72887, 0, 0.07532), fg(3.02306, 0, 1.10819)); const rud = pivot(root, ['direction'], r.c, r.ax);
  const al = hinge(fg(-0.625, -4.0269, -0.1506), fg(-0.53622, -2.64012, -0.25318)); const ailL = pivot(root, ['aileronG'], al.c, al.ax);
  const ar = hinge(fg(-0.53622, 2.64012, -0.25318), fg(-0.625, 4.0269, -0.1506)); const ailR = pivot(root, ['aileronD'], ar.c, ar.ax);
  const fl = hinge(fg(-0.64796, -2.55988, -0.36671), fg(-0.56739, -0.67626, -0.52044)); const flL = pivot(root, ['voletG'], fl.c, fl.ax);
  const fr = hinge(fg(-0.56739, 0.67626, -0.52044), fg(-0.64796, 2.55988, -0.36671)); const flR = pivot(root, ['voletD'], fr.c, fr.ax);
  const nose = pivot(root, ['cacheA', 'troucacheA', 'roueA'], fg(-2.61159, 0, -1.04376), new THREE.Vector3(0, 1, 0));
  const noseWheel = nose.getObjectByName('roueA');
  const wheelG = pivot(root, ['roueG'], fg(-0.97304, -0.94418, -1.02095), new THREE.Vector3(1, 0, 0));
  const wheelD = pivot(root, ['roueD'], fg(-0.97304, 0.94418, -1.02095), new THREE.Vector3(1, 0, 0));
  // nose wheel spins inside the steering pivot
  let noseSpin: THREE.Group | null = null;
  if (noseWheel) {
    noseSpin = new THREE.Group();
    const c = new THREE.Vector3(0, 0, 0); // roueA already relative to the nose pivot centre (wheel axle)
    noseSpin.position.copy(c); nose.remove(noseWheel); noseSpin.add(noseWheel); nose.add(noseSpin);
  }
  root.traverse((o) => { o.castShadow = (o as THREE.Mesh).isMesh && !(((o as THREE.Mesh).material as THREE.MeshStandardMaterial).transparent); });

  const set = (p: THREE.Object3D, deg: number) => p.quaternion.setFromAxisAngle(p.userData.axis as THREE.Vector3, THREE.MathUtils.degToRad(deg));
  let spin = 0, roll = 0, flapPos = 0;
  const parts = (n: string) => root.getObjectByName(n);
  const v: AircraftVisual = {
    root, eye: new THREE.Vector3(-0.26, 0.54, 0.22),
    animate(c, rpm, dt, gs, cockpit) {
      set(elev, -c.elevator * 15 - c.trim * 3);
      set(rud, c.rudder * 15);
      set(ailL, c.aileron * 15); set(ailR, -c.aileron * 15);
      flapPos += (([0, 15, 40][c.flaps] / 40) - flapPos) * Math.min(1, dt * 1.2);
      set(flL, flapPos * 40); set(flR, flapPos * 40);
      set(nose, -c.rudder * 25);
      spin += (rpm / 60) * 360 * dt; roll += (gs / 0.17) * 57.3 * dt;
      set(prop, spin % 360);
      set(wheelG, -roll % 360); set(wheelD, -roll % 360);
      if (noseSpin) noseSpin.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(-roll % 360));
      parts('helice')!.visible = rpm < 1500;
      parts('propblur')!.visible = rpm >= 600 && rpm < 1500;
      parts('propdisc')!.visible = rpm >= 1500 && !cockpit;
      cabin.visible = true;
    },
    setLivery(name) {
      const base = L.tex.get('texture.png')!;
      const tex = name === FLAMES ? Promise.resolve(makeFlameLivery(base.image as HTMLImageElement, root, livreg.reg)) : liveryTexture(name, base);
      tex.then((t) => {
        root.traverse((o) => {
          const m = (o as THREE.Mesh).material;
          for (const mm of (Array.isArray(m) ? m : m ? [m] : []) as THREE.MeshStandardMaterial[]) {
            if (mm.map === base || mm.userData.livery) { mm.map = t; mm.userData.livery = true; mm.needsUpdate = true; }
          }
        });
      });
    },
    clone: () => { throw new Error('use detailedVisual()'); },
  };
  if (livery !== 'Default') v.setLivery(livery);
  return v;
}

export async function makeVisual(id: VisualId, livery: string): Promise<AircraftVisual> {
  if (id === 'p2006t') {
    const { p2006tVisual } = await import('./p2006t-visual');
    return p2006tVisual(livery, livreg.military);
  }
  if (id === 'detailed') {
    try { return await detailedVisual(livery); } catch (e) { console.warn('detailed model failed, using simple', e); }
  }
  return simpleVisual(livery);
}

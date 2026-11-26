// Detailed Tecnam P2006T (MMA) from the FlightGear model by helijah (GPL):
// twin props, control surfaces, retractable gear with doors, optional mission equipment.
import * as THREE from 'three';
import { parseAC, buildAC } from './ac3d';
import type { AircraftVisual } from './visuals';
import { P2006T, P2006T_SHIFT as SHIFT } from '../sim/p2006t';
import { makeMilitaryLivery } from './military';

const BASE = import.meta.env.BASE_URL + 'models/p2006t/';
export const P2006T_LIVERIES = ['CZ-Military', 'Default', 'Full_White', 'AMI', 'P2006T_MMA', 'SpainGC', 'TecnamDemo'];
const MISSION_LIVERIES = new Set(['CZ-Military', 'P2006T_MMA']);

/** FG point (x aft, y right, z up) -> sim body coordinates; dir: same without shift. */
const fg = (x: number, y: number, z: number) => new THREE.Vector3(y, z, x + SHIFT);
const fgDir = (x: number, y: number, z: number) => new THREE.Vector3(y, z, x).normalize();

let loaded: Promise<{ ext: ReturnType<typeof parseAC>; int: ReturnType<typeof parseAC>; panel: ReturnType<typeof parseAC>; seat: ReturnType<typeof parseAC>; tex: Map<string, THREE.Texture> }> | null = null;
function loadAll() {
  if (loaded) return loaded;
  const tl = new THREE.TextureLoader();
  const tex = async (f: string) => { const t = await tl.loadAsync(BASE + f); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const txt = (f: string) => fetch(BASE + f).then((r) => { if (!r.ok) throw new Error(f); return r.text(); });
  loaded = (async () => {
    const [ext, int, panel, seat, t0, ti, tp, ts] = await Promise.all([
      txt('p2006t.ac'), txt('interior.ac'), txt('panel.ac'), txt('seat.ac'),
      tex('texture.png'), tex('interior.png'), tex('panel.png'), tex('Seat.png'),
    ]);
    return { ext: parseAC(ext), int: parseAC(int), panel: parseAC(panel), seat: parseAC(seat), tex: new Map([['texture.png', t0], ['interior.png', ti], ['panel.png', tp], ['Seat.png', ts]]) };
  })();
  return loaded;
}
const liveryCache = new Map<string, Promise<THREE.Texture>>();
function liveryTex(name: string) {
  let p = liveryCache.get(name);
  if (!p) { p = new THREE.TextureLoader().loadAsync(`${BASE}liveries/${name}.png`).then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }); liveryCache.set(name, p); }
  return p;
}

/** A pivot group at `center` (sim coords) that rotates about `axis`, nested under `parent`. */
function pivot(root: THREE.Object3D, parent: THREE.Object3D & { userData: { c?: THREE.Vector3 } }, names: string[], center: THREE.Vector3, axis: THREE.Vector3) {
  const p = new THREE.Group();
  const pc = (parent.userData.c as THREE.Vector3 | undefined) ?? new THREE.Vector3();
  p.position.copy(center).sub(pc);
  p.userData.c = center.clone();
  p.userData.axis = axis.clone().normalize();
  parent.add(p);
  for (const n of names) {
    const m = root.getObjectByName(n);
    if (!m) continue;
    m.parent?.remove(m);
    m.position.copy(center).multiplyScalar(-1); // mesh vertices are baked in model coords
    p.add(m);
  }
  return p;
}
const hinge = (a: THREE.Vector3, b: THREE.Vector3) => ({ c: a.clone(), ax: b.clone().sub(a) });
const set = (p: THREE.Object3D, deg: number) => p.quaternion.setFromAxisAngle(p.userData.axis as THREE.Vector3, THREE.MathUtils.degToRad(deg));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export async function p2006tVisual(livery = 'CZ-Military', reg = '0731'): Promise<AircraftVisual> {
  const L = await loadAll();
  const textures = (n: string) => L.tex.get(n) ?? null;
  const root = new THREE.Group();
  const ext = buildAC(L.ext, { textures, offset: new THREE.Vector3(SHIFT, 0, 0), skip: (n) => n.startsWith('HDR') });
  for (const m of [...ext.children]) root.add(m);
  const cabin = new THREE.Group();
  cabin.add(buildAC(L.int, { textures, offset: new THREE.Vector3(SHIFT, 0, 0), skip: (n) => n.startsWith('HDR') || n.toLowerCase().includes('vitre') }));
  cabin.add(buildAC(L.panel, { textures, offset: new THREE.Vector3(SHIFT - 2.74446, 0, -0.13289) }));
  for (const [x, y] of [[-2.08, -0.29], [-2.08, 0.29], [-0.92, -0.29], [-0.92, 0.29]]) cabin.add(buildAC(L.seat, { textures, offset: new THREE.Vector3(SHIFT + x, y, -0.39) }));
  root.add(cabin);

  // propellers
  const propL = pivot(root, root, ['heliceG', 'bolG', 'propdiscG', 'propblurG'], fg(-1.76661, -1.60207, 0.27557), fgDir(-1, 0, 0));
  const propR = pivot(root, root, ['heliceD', 'bolD', 'propdiscD', 'propblurD'], fg(-1.76661, 1.60207, 0.27557), fgDir(-1, 0, 0));
  // control surfaces
  const elev = pivot(root, root, ['ailes2'], fg(3.7488, 0, -0.32347), fgDir(0, 1, 0));
  const r = hinge(fg(3.57064, 0, -0.10757), fg(4.07946, 0, 1.32138)); const rud = pivot(root, root, ['direction'], r.c, r.ax);
  const al = hinge(fg(-0.56164, -4.99758, 0.38802), fg(-0.21309, -3.19415, 0.30736)); const ailL = pivot(root, root, ['aileronG'], al.c, al.ax);
  const ar = hinge(fg(-0.21309, 3.19415, 0.30736), fg(-0.56164, 4.99758, 0.38802)); const ailR = pivot(root, root, ['aileronD'], ar.c, ar.ax);
  const fl = hinge(fg(-0.18978, -3.1891, 0.20302), fg(-0.18978, -0.57164, 0.16739)); const flL = pivot(root, root, ['voletG'], fl.c, fl.ax);
  const fr = hinge(fg(-0.18978, 0.57164, 0.16739), fg(-0.18978, 3.1891, 0.20302)); const flR = pivot(root, root, ['voletD'], fr.c, fr.ax);
  // landing gear: retraction > steering > wheel spin
  const noseLeg = pivot(root, root, ['axeAH', 'axeAB', 'roueA'], fg(-3.44014, 0, -0.85695), fgDir(0, 1, 0));
  const ns = hinge(fg(-3.47009, 0, -1.06613), fg(-3.45444, 0, -0.95248)); const noseSteer = pivot(root, noseLeg, ['axeAB', 'roueA'], ns.c, ns.ax);
  const noseWheel = pivot(root, noseSteer, ['roueA'], fg(-3.49659, 0, -1.25857), new THREE.Vector3(1, 0, 0));
  const legL = pivot(root, root, ['axeGH', 'axeGB', 'roueG'], fg(-0.79439, -0.82529, -0.68454), fgDir(1, 0, 0));
  const legR = pivot(root, root, ['axeDH', 'axeDB', 'roueD'], fg(-0.79439, 0.82529, -0.68454), fgDir(1, 0, 0));
  const wheelL = pivot(root, legL, ['roueG'], fg(-0.5578, -0.97436, -1.18836), new THREE.Vector3(1, 0, 0));
  const wheelR = pivot(root, legR, ['roueD'], fg(-0.5578, 0.97436, -1.18836), new THREE.Vector3(1, 0, 0));
  const doorN = pivot(root, root, ['porteA'], fg(-4.06057, 0, -0.86307), fgDir(0, 1, 0));
  const dl = hinge(fg(-3.86363, -0.10727, -0.90494), fg(-3.59243, -0.10727, -0.92692)); const doorNL = pivot(root, root, ['porteAG'], dl.c, dl.ax);
  const dr = hinge(fg(-3.86363, 0.10727, -0.90494), fg(-3.59243, 0.10727, -0.92692)); const doorNR = pivot(root, root, ['porteAD'], dr.c, dr.ax);
  const doorL = pivot(root, root, ['portetrainG'], fg(-0.75798, -0.91251, -0.73393), fgDir(-1, 0, 0));
  const doorR = pivot(root, root, ['portetrainD'], fg(-0.75798, 0.91251, -0.73393), fgDir(-1, 0, 0));

  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial; m.castShadow = !mat.transparent; } });
  const part = (n: string) => root.getObjectByName(n);
  const mission = ['turretbase', 'turretball', 'FLIRvitre', 'SATCOM', 'Seaspray'].map(part).filter(Boolean) as THREE.Object3D[];
  let spinL = 0, spinR = 0, roll = 0, flapPos = 0, gearShown = 1;

  const base = L.tex.get('texture.png')!;
  const v: AircraftVisual & { gear: (g: number) => void } = {
    root, eye: P2006T.eye.clone(),
    gear(g: number) { gearShown = g; },
    animate(c, rpm, dt, gs, cockpit, extra) {
      const g = extra?.gearPos ?? gearShown;
      set(elev, -c.elevator * 15 - c.trim * 3);
      set(rud, c.rudder * 15);
      set(ailL, c.aileron * 15); set(ailR, -c.aileron * 15);
      flapPos += (([0, 15, 35][c.flaps] / 35) - flapPos) * Math.min(1, dt * 0.8);
      set(flL, flapPos * 35); set(flR, flapPos * 35);
      // gear retraction (g: 1 down, 0 up) and doors
      set(noseLeg, 105 * (1 - g)); set(legL, 90 * (1 - g)); set(legR, -90 * (1 - g));
      set(doorN, 60 * clamp01(g / 0.1)); set(doorNL, -100 * clamp01(g / 0.1)); set(doorNR, 100 * clamp01(g / 0.1));
      set(doorL, 110 * g); set(doorR, -110 * g);
      set(noseSteer, -c.rudder * 25 * g);
      roll += (gs / 0.22) * 57.3 * dt;
      set(noseWheel, -roll % 360); set(wheelL, -roll % 360); set(wheelR, -roll % 360);
      const rL = extra?.rpms?.[0] ?? rpm, rR = extra?.rpms?.[1] ?? rpm;
      spinL += (rL / 60) * 360 * dt; spinR -= (rR / 60) * 360 * dt;
      set(propL, spinL % 360); set(propR, spinR % 360);
      for (const [s, rr] of [['G', rL], ['D', rR]] as const) {
        part('helice' + s)!.visible = rr < 1500;
        part('propblur' + s)!.visible = rr >= 600 && rr < 1500;
        part('propdisc' + s)!.visible = rr >= 1500 && !cockpit;
      }
    },
    setLivery(name: string, regOverride?: string) {
      for (const m of mission) m.visible = MISSION_LIVERIES.has(name);
      const t = name === 'Default' ? Promise.resolve(base)
        : name === 'CZ-Military' ? liveryTex('Full_White').then((w) => makeMilitaryLivery(w.image as HTMLImageElement, root, regOverride ?? reg))
        : liveryTex(name);
      t.then((tx) => root.traverse((o) => {
        const mm = (o as THREE.Mesh).material;
        for (const x of (Array.isArray(mm) ? mm : mm ? [mm] : []) as THREE.MeshStandardMaterial[]) {
          if (x.map === base || x.userData.livery) { x.map = tx; x.userData.livery = true; x.needsUpdate = true; }
        }
      }));
    },
    clone: () => { throw new Error('use p2006tVisual()'); },
  };
  v.setLivery(livery);
  return v;
}

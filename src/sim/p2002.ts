// Tecnam P2002 Sierra-like parameters (approximate, from public POH figures) + low-poly model.
import * as THREE from 'three';
import type { AircraftParams } from './fdm';

const kgear = 42000, cgear = 4200;
export const P2002: AircraftParams = {
  name: 'Tecnam P2002',
  mass: 560,                 // kg (2 pilots, ~half fuel; MTOW 600)
  S: 11.5, b: 8.6, c: 1.34,  // wing area m², span m, chord m
  inertia: [950, 1350, 700], // body x(pitch), y(yaw), z(roll) kg·m²
  // engine: Rotax 912 S, 100 hp
  engines: [{ pos: [0, 0, -1.8], power: 73500, propEff: 0.72, staticThrust: 1750, idleRpm: 1500, maxRpm: 5500, torqueYaw: 0.04 }],
  propWash: 0.32, retractable: false, gearDrag: 0, gearTime: 1,
  // lift / drag
  cl0: 0.28, clAlpha: 4.9, clMax: 1.42, cd0: 0.031, k: 0.064, cyBeta: -0.55,
  flaps: [
    { deg: 0, dCL: 0, dCLmax: 0, dCD: 0, dCm: 0 },
    { deg: 15, dCL: 0.25, dCLmax: 0.22, dCD: 0.012, dCm: -0.02 },
    { deg: 40, dCL: 0.5, dCLmax: 0.5, dCD: 0.045, dCm: -0.04 },
  ],
  // stability & control derivatives
  cm0: 0.04, cmAlpha: -1.1, cmq: -18, cmDe: 0.3,
  clBeta: -0.075, clp: -0.5, clr: 0.09, clDa: 0.055,
  cnBeta: 0.075, cnr: -0.13, cnp: -0.035, cnDr: 0.022, cnDa: -0.004,
  // ground
  noseSteer: 0.3, rollFriction: 0.045, brakeFriction: 0.55, sideFriction: 0.6,
  gear: [
    { name: 'nose', p: [0, -1.22, -1.45], k: kgear * 0.7, c: cgear * 0.7 },
    { name: 'left main', p: [-0.95, -1.2, 0.38], k: kgear, c: cgear },
    { name: 'right main', p: [0.95, -1.2, 0.38], k: kgear, c: cgear },
  ],
  structure: [
    { name: 'Propeller', p: [0, -1.0, -2.05] },
    { name: 'Tail', p: [0, -0.35, 4.6] },
    { name: 'Left wingtip', p: [-4.3, -0.45, 0.2] },
    { name: 'Right wingtip', p: [4.3, -0.45, 0.2] },
    { name: 'Belly', p: [0, -0.72, 0.6] },
  ],
  restHeight: 1.16, restPitch: 0,
  eye: new THREE.Vector3(-0.3, 0.42, -0.15),
  speeds: { vs0: 42, vs1: 47, vr: 50, vx: 60, vy: 66, vfe: 70, vno: 110, vne: 145, approach: 60, whiteTop: 70 },
};

/** Procedural low-poly P2002 Sierra (low wing, fixed tricycle gear, bubble canopy). */
export function buildP2002Model(livery = { body: 0xf4f4f2, stripe: 0xc8102e, stripe2: 0x1d3b8a }) {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: livery.body, roughness: 0.45, metalness: 0.05 });
  const red = new THREE.MeshStandardMaterial({ color: livery.stripe, roughness: 0.5 });
  const blue = new THREE.MeshStandardMaterial({ color: livery.stripe2, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc6e0, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh;
  };
  // Fuselage: lathe profile along z (nose -z).
  const prof: [number, number][] = [[0.02, -2.0], [0.32, -1.9], [0.46, -1.55], [0.56, -0.9], [0.6, -0.2], [0.58, 0.5], [0.45, 1.5], [0.3, 2.6], [0.18, 3.6], [0.1, 4.4]];
  const lathe = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 20).rotateX(-Math.PI / 2).rotateX(Math.PI);
  lathe.scale(1, 0.95, 1);
  const fus = add(lathe, white, 0, -0.35, 0);
  fus.scale.set(1.0, 1.0, 1);
  // cheat line stripes
  add(new THREE.BoxGeometry(1.2, 0.08, 4.4), red, 0, -0.3, 1.0).scale.set(1.0, 1, 1);
  add(new THREE.BoxGeometry(1.0, 0.05, 3.6), blue, 0, -0.42, 1.5);
  // Canopy bubble
  const can = new THREE.SphereGeometry(0.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.95, 0.75, 1.55);
  add(can, glass, 0, 0.18, -0.15);
  add(new THREE.TorusGeometry(0.58, 0.03, 6, 20, Math.PI).rotateY(Math.PI / 2).scale(1, 0.75, 1), dark, 0, 0.18, -0.15).rotation.set(0, Math.PI / 2, 0);
  // Low rectangular wing with slight dihedral
  for (const s of [-1, 1]) {
    const w = add(new THREE.BoxGeometry(4.0, 0.16, 1.34), white, s * 2.25, -0.62, 0.1);
    w.rotation.z = s * 0.05;
    add(new THREE.BoxGeometry(0.6, 0.165, 1.36), red, s * 4.0, -0.52, 0.1).rotation.z = s * 0.05; // tip
    const fl = add(new THREE.BoxGeometry(1.9, 0.06, 0.32), white, s * 1.5, -0.66, 0.92);
    fl.name = s < 0 ? 'flapL' : 'flapR';
    const ail = add(new THREE.BoxGeometry(1.6, 0.06, 0.32), white, s * 3.4, -0.56, 0.92);
    ail.name = s < 0 ? 'ailL' : 'ailR';
  }
  // Tail: fin + rudder, stabilator
  const fin = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.1, 0), new THREE.Vector2(1.25, 1.15), new THREE.Vector2(0.75, 1.15)]);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.08, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.04, 0, 0);
  add(finGeo, white, 0, -0.25, 3.25);
  const rud = add(new THREE.BoxGeometry(0.06, 1.1, 0.35), red, 0, 0.35, 4.55);
  rud.name = 'rudder';
  const stab = add(new THREE.BoxGeometry(2.9, 0.06, 0.7), white, 0, -0.22, 4.2);
  stab.name = 'stab';
  // Gear: legs, wheel pants
  const wheel = new THREE.CylinderGeometry(0.19, 0.19, 0.13, 14).rotateZ(Math.PI / 2);
  const pant = new THREE.SphereGeometry(0.22, 12, 8).scale(0.7, 0.9, 2.0);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.06, 0.06, 0.06).scale(15, 1, 1.5), dark, s * 0.5, -0.72, 0.38).rotation.z = s * 0.55;
    add(wheel, dark, s * 0.95, -1.01, 0.38);
    add(pant, red, s * 0.95, -0.98, 0.36);
  }
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 6), dark, 0, -0.82, -1.45);
  add(wheel, dark, 0, -1.03, -1.45);
  add(pant, white, 0, -1.0, -1.47);
  // Spinner + propeller (disc when spinning)
  add(new THREE.ConeGeometry(0.17, 0.4, 14).rotateX(-Math.PI / 2), white, 0, -0.35, -2.15);
  const prop = new THREE.Group(); prop.name = 'prop'; prop.position.set(0, -0.35, -2.05);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.03), dark); blade.castShadow = true;
  prop.add(blade);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.76, 32), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  disc.name = 'disc'; disc.visible = false;
  prop.add(disc);
  g.add(prop);
  return g;
}

/** Animate control surfaces and propeller. */
export function animateModel(m: THREE.Object3D, c: { elevator: number; aileron: number; rudder: number; flaps: number }, rpm: number, dt: number) {
  const o = (n: string) => m.getObjectByName(n);
  const fl = [0, 0.26, 0.7][c.flaps];
  o('flapL')!.rotation.x = -fl; o('flapR')!.rotation.x = -fl;
  o('ailL')!.rotation.x = c.aileron * 0.35; o('ailR')!.rotation.x = -c.aileron * 0.35;
  o('rudder')!.rotation.y = -c.rudder * 0.45;
  o('stab')!.rotation.x = c.elevator * 0.25;
  const prop = o('prop')!;
  prop.rotation.z += (rpm / 2.43 / 60) * Math.PI * 2 * dt;
  (prop.children[0] as THREE.Mesh).visible = rpm < 900;
  o('disc')!.visible = rpm >= 900;
}

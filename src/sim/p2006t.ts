// Tecnam P2006T: high-wing light twin, 2 × Rotax 912 S (100 hp), constant-speed props,
// retractable gear. Geometry from the FlightGear model (helijah), body frame: nose -z, up +y,
// right +x, CG ~0.4 m ahead of the main wheels. Performance roughly per POH:
// Vso 54, Vs1 62, Vr 65, Vy 83, Vyse 82 (blue line), Vmc 62 (red line), cruise ~140 kt.
import * as THREE from 'three';
import type { AircraftParams } from './fdm';

const SHIFT = 0.96; // FG model x (aft) -> sim z
const kg = 70000, cg = 7500;
const eng = (x: number) => ({ pos: [x, 0.276, -1.767 + SHIFT] as const, power: 73500, propEff: 0.78, staticThrust: 1650, idleRpm: 1500, maxRpm: 5500, torqueYaw: 0.01 });

export const P2006T: AircraftParams = {
  name: 'Tecnam P2006T',
  mass: 1150, S: 14.76, b: 11.4, c: 1.3,
  inertia: [2400, 4300, 2600],
  engines: [eng(-1.602), eng(1.602)],
  propWash: 0.06, // props sit on the wings, little wash over the tail
  cl0: 0.3, clAlpha: 5.0, clMax: 1.33, cd0: 0.021, k: 0.048, cyBeta: -0.6,
  flaps: [
    { deg: 0, dCL: 0, dCLmax: 0, dCD: 0, dCm: 0 },
    { deg: 15, dCL: 0.22, dCLmax: 0.2, dCD: 0.01, dCm: -0.02 },
    { deg: 35, dCL: 0.45, dCLmax: 0.42, dCD: 0.04, dCm: -0.04 },
  ],
  cm0: 0.04, cmAlpha: -1.1, cmq: -20, cmDe: 0.3,
  clBeta: -0.09, clp: -0.5, clr: 0.1, clDa: 0.05,
  cnBeta: 0.08, cnr: -0.14, cnp: -0.03, cnDr: 0.032, cnDa: -0.004,
  noseSteer: 0.3, rollFriction: 0.035, brakeFriction: 0.55, sideFriction: 0.6,
  gear: [
    { name: 'nose', p: [0, -1.44, -3.497 + SHIFT], k: kg * 0.6, c: cg * 0.6 },
    { name: 'left main', p: [-0.974, -1.41, -0.558 + SHIFT], k: kg, c: cg },
    { name: 'right main', p: [0.974, -1.41, -0.558 + SHIFT], k: kg, c: cg },
  ],
  structure: [
    { name: 'Nose', p: [0, -0.75, -4.2 + SHIFT] },
    { name: 'Belly', p: [0, -0.95, -1.2 + SHIFT] },
    { name: 'Belly', p: [0, -0.9, 0.6 + SHIFT] },
    { name: 'Tail', p: [0, -0.2, 4.3 + SHIFT] },
    { name: 'Left wingtip', p: [-5.6, 0.25, -0.6 + SHIFT] },
    { name: 'Right wingtip', p: [5.6, 0.25, -0.6 + SHIFT] },
    { name: 'Left propeller', p: [-1.602, -0.6, -1.767 + SHIFT] },
    { name: 'Right propeller', p: [1.602, -0.6, -1.767 + SHIFT] },
  ],
  retractable: true, gearDrag: 0.014, gearTime: 6,
  restHeight: 1.35, restPitch: 0,
  eye: new THREE.Vector3(-0.29, 0.5, -1.95 + SHIFT),
  speeds: { vs0: 54, vs1: 62, vr: 65, vx: 74, vy: 83, vfe: 93, vno: 138, vne: 171, approach: 75, vmc: 62, vyse: 82, whiteTop: 93 },
};
export const P2006T_SHIFT = SHIFT;

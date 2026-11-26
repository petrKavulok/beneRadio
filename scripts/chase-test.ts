import * as THREE from 'three';
import { PoliceChase } from '../src/world/police';
for (const [label, gsKt, onGround, startDist] of [['parked aircraft', 0, true, 40], ['taxiing away at 10 kt', 10, true, 300], ['fleeing at 40 kt', 40, true, 200], ['airborne 600 ft overhead', 80, false, 1000]] as const) {
  const car = new THREE.Object3D();
  const ch = new PoliceChase(car, () => 400);
  ch.park(0, 0, 0);
  let ax = startDist, az = 0, t = 0, caught = false;
  for (; t < 120 && !caught; t += 1 / 60) {
    ax += (gsKt * 0.5144) / 60; // aircraft moves east
    caught = ch.update(1 / 60, { x: ax, z: az, aglFt: onGround ? 0 : 600, onGround, gsKt });
  }
  console.log(`${label.padEnd(26)} ${caught ? `BUSTED after ${t.toFixed(1)} s` : `not caught in 120 s (gap ${ch.distanceTo(ax, az).toFixed(0)} m, car ${(ch.speed * 3.6).toFixed(0)} km/h)`}`);
}

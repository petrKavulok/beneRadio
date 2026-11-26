import * as THREE from 'three';
import { Aircraft, Env, Controls } from '../src/sim/fdm';
const STEP = 1 / 240, clamp = THREE.MathUtils.clamp;
const env: Env = { heightAt: () => 400, surfaceAt: () => 400, hitsBuilding: () => false, wind: new THREE.Vector3() };
const ctl = (o: Partial<Controls> = {}): Controls => ({ elevator: 0, aileron: 0, rudder: 0, throttle: 0.6, brakeL: 0, brakeR: 0, parking: false, flaps: 0, trim: 0, ...o });
const ballUnits = (a: Aircraft) => (a.ball / 0.26).toFixed(2); // ±1 = full deflection
function air(name: string, bankCmd: number, rudder: (a: Aircraft) => number) {
  const a = new Aircraft(); a.place(0, 0, 0, env); a.pos.y = 1000; a.vel.set(0, 0, -48); a.running = true; a.rpm = 4500; a.onGround = false;
  const c = ctl();
  let h0 = 0;
  for (let t = 0; t < 30; t += STEP) {
    const e = a.euler(), bank = -e.z * 57.3;
    c.aileron = clamp((bankCmd - bank) * 0.04 - (-a.omega.z) * 0.4, -1, 1);
    c.elevator = clamp(-a.vs * 0.15 + 0.03 + (1000 - a.pos.y) * 0.01, -1, 1);
    c.rudder = rudder(a);
    a.step(STEP, c, env);
    if (Math.abs(t - 20) < STEP / 2) h0 = a.heading();
  }
  const real = ((a.heading() - h0 + 540) % 360 - 180) / 10;
  console.log(`${name.padEnd(34)} bank ${(-a.euler().z * 57.3).toFixed(0)}°  TC ${a.turnGyro.toFixed(1)}°/s (actual ${real.toFixed(1)})  ball ${ballUnits(a)}  beta ${(a.beta * 57.3).toFixed(1)}°`);
}
air('straight & level', 0, () => 0);
air('bank 15° (aileron only)', 15, () => 0);
air('bank 15° coordinated (rudder on ball)', 15, (a) => clamp(a.beta * 4 - a.omega.y * 0, -1, 1));
air('bank 30° coordinated (rudder on ball)', 30, (a) => clamp(a.beta * 4 - a.omega.y * 0, -1, 1));
air('wings level + right rudder (skid)', 0, () => 0.5);
// taxi turn on ground
const a = new Aircraft(); a.place(0, 0, 0, env); a.running = true; a.rpm = 1500;
const c = ctl({ throttle: 0.35 });
for (let t = 0; t < 12; t += STEP) { c.rudder = t > 6 ? 1 : 0; a.step(STEP, c, env); }
console.log(`taxi right turn ${(Math.hypot(a.vel.x, a.vel.z) * 1.944).toFixed(0)} kt              TC ${a.turnGyro.toFixed(1)}°/s  ball ${ballUnits(a)}`);
const b = new Aircraft(); b.place(0, 0, 0, env);
for (let t = 0; t < 3; t += STEP) b.step(STEP, ctl({ throttle: 0, parking: true }), env);
console.log(`parked, level                         TC ${b.turnGyro.toFixed(1)}°/s  ball ${ballUnits(b)}`);

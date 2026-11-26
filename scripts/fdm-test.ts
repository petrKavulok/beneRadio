// Headless flight-model checks: node --import tsx scripts/fdm-test.ts [--landing]
import * as THREE from 'three';
import { Aircraft, Env, Controls, AircraftParams } from '../src/sim/fdm';
import { P2002 } from '../src/sim/p2002';
import { P2006T } from '../src/sim/p2006t';
const TYPE: AircraftParams = process.argv.includes('--twin') ? P2006T : P2002;

const STEP = 1 / 240;
const clamp = THREE.MathUtils.clamp;
function mkEnv(windFromDeg = 0, kt = 0): Env {
  const to = (windFromDeg + 180) * Math.PI / 180;
  return {
    heightAt: () => 400, surfaceAt: () => 400, hitsBuilding: () => false,
    wind: new THREE.Vector3(Math.sin(to), 0, -Math.cos(to)).multiplyScalar(kt * 0.5144),
  };
}
const ctl = (o: Partial<Controls> = {}): Controls => ({ elevator: 0, aileron: 0, rudder: 0, throttle: 0, brakeL: 0, brakeR: 0, parking: false, flaps: 0, trim: 0, ...o });
const kt = (a: Aircraft) => (a.ias * 1.944).toFixed(0);
const agl = (a: Aircraft) => ((a.pos.y - 400 - TYPE.restHeight) * 3.281).toFixed(0);
const e = (a: Aircraft) => a.euler();
const pitchDeg = (a: Aircraft) => e(a).x * 57.3;
/** attitude-hold pilot */
const holdPitch = (a: Aircraft, cmd: number) => clamp((cmd - pitchDeg(a)) * 0.06 - a.omega.x * 0.8 + 0.05, -1, 1);
const levelWings = (a: Aircraft) => clamp(e(a).z * 57.3 * 0.05 + a.omega.z * 0.5, -1, 1);
const hdgErr = (a: Aircraft, h: number) => ((h - a.heading() + 540) % 360) - 180;
const line = (t: number, a: Aircraft) => `t=${t.toFixed(0)} ias=${kt(a)} agl=${agl(a)} vs=${(a.vs * 196.85).toFixed(0)} p=${pitchDeg(a).toFixed(1)} b=${(-e(a).z * 57.3).toFixed(1)} h=${a.heading().toFixed(0)} ${a.onGround ? 'G' : 'A'}`;

function takeoff(name: string, env: Env, secs = 40) {
  const a = new Aircraft(TYPE); a.place(0, 0, 240, env); a.running = true; a.rpm = 1500;
  const c = ctl({ throttle: 1, flaps: 1, trim: 0.15 });
  let t = 0, lift = -1;
  const p0 = a.pos.clone(), log: string[] = [];
  while (t < secs && !a.crashed) {
    c.elevator = a.ias * 1.944 > TYPE.speeds.vr ? holdPitch(a, 8) : 0;
    c.aileron = levelWings(a);
    c.rudder = a.onGround ? clamp(hdgErr(a, 240) * 0.15, -1, 1) : 0;
    a.step(STEP, c, env); t += STEP;
    if (!a.onGround && lift < 0) lift = a.pos.distanceTo(p0);
    if (Math.abs(t % 4) < STEP) log.push(line(t, a));
  }
  console.log(`\n== take-off ${name}: liftoff after ${lift.toFixed(0)} m ${a.crashed ?? ''}`);
  console.log(log.join('\n'));
}

function cruise(throttle: number) {
  const env = mkEnv();
  const a = new Aircraft(TYPE); a.place(0, 0, 0, env);
  a.pos.y = 1000; a.vel.set(0, 0, TYPE.engines.length > 1 ? -70 : -50); a.running = true; a.rpm = 5000; a.onGround = false;
  if (TYPE.retractable) a.gearPos = 0;
  const c = ctl({ throttle, gearDown: false });
  for (let t = 0; t < 90; t += STEP) {
    c.elevator = holdPitch(a, clamp(-a.vs * 1.5 + (1000 - a.pos.y) * 0.3, -10, 10));
    c.aileron = levelWings(a);
    a.step(STEP, c, env);
  }
  console.log(`cruise thr=${throttle}: ias=${kt(a)} kt rpm=${a.rpm.toFixed(0)} pitch=${pitchDeg(a).toFixed(1)} vs=${(a.vs * 196.85).toFixed(0)}`);
}

function stall(flaps: number) {
  const env = mkEnv();
  const a = new Aircraft(TYPE); a.place(0, 0, 0, env);
  a.pos.y = 1500; a.vel.set(0, 0, TYPE.engines.length > 1 ? -45 : -35); a.running = true; a.rpm = 1500; a.onGround = false;
  const c = ctl({ throttle: 0, flaps });
  let warn = 0, minIas = 999;
  for (let t = 0; t < 40; t += STEP) {
    c.elevator = Math.min(1, t * 0.05); // slowly pull back
    c.aileron = levelWings(a);
    a.step(STEP, c, env);
    const ias = a.ias * 1.944;
    if (a.stall && !warn) warn = ias;
    minIas = Math.min(minIas, ias);
  }
  console.log(`stall flaps=${flaps}: warning at ${warn.toFixed(0)} kt, min ias ${minIas.toFixed(0)} kt`);
}

function landing(windKt: number) {
  const env = mkEnv(240, windKt);
  const a = new Aircraft(TYPE); a.place(0, 0, 240, env);
  const to = 240 * Math.PI / 180, dir = new THREE.Vector3(Math.sin(to), 0, -Math.cos(to));
  const g = Math.tan(3 * Math.PI / 180);
  a.pos.addScaledVector(dir, -1000); a.pos.y = 400 + TYPE.restHeight + 1000 * g;
  const vapp = TYPE.speeds.approach * 0.5144; a.vel.copy(dir).multiplyScalar(vapp); a.vel.y = -vapp * g;
  a.quat.setFromEuler(new THREE.Euler(0.0, -to, 0, 'YXZ'));
  a.running = true; a.rpm = 2600; a.onGround = false;
  const c = ctl({ throttle: 0.3, flaps: 2, trim: 0.3 });
  let td = '', t = 0;
  const log: string[] = [];
  while (t < 70 && !a.crashed) {
    const h = a.pos.y - 400 - TYPE.restHeight;
    const wantVs = h > 6 ? -1.6 : -0.25 - h * 0.18;
    if (h < 6) c.throttle = 0;
    else c.throttle = clamp(0.3 + (vapp - a.ias) * 0.05, 0, 1);
    c.elevator = a.onGround ? 0.2 : holdPitch(a, clamp(-1 + (wantVs - a.vs) * 3, -6, 9));
    c.aileron = levelWings(a);
    c.rudder = clamp(hdgErr(a, 240) * 0.1, -1, 1);
    if (a.onGround && !td) td = `touchdown ${(a.touchdownVs * 196.85).toFixed(0)} fpm at ${kt(a)} kt pitch ${pitchDeg(a).toFixed(1)}`;
    if (a.onGround) c.brakeL = c.brakeR = 0.6;
    a.step(STEP, c, env); t += STEP;
    if (Math.abs(t % 3) < STEP) log.push(line(t, a));
  }
  console.log(`\n== landing wind ${windKt}: ${td} → gs=${(Math.hypot(a.vel.x, a.vel.z) * 1.944).toFixed(1)} kt ${a.crashed ?? 'OK'}`);
  console.log(log.join('\n'));
}

if (!process.argv.includes('--landing')) {
  takeoff('no wind', mkEnv());
  takeoff('wind 260/09', mkEnv(260, 9), 14);
  takeoff('crosswind 330/12', mkEnv(330, 12), 14);
  cruise(0.75); cruise(1); cruise(0.55);
  stall(0); stall(2);
}
landing(0); landing(8);

// ---- twin only: single-engine climb at Vyse and Vmc controllability ----
function singleEngine() {
  if (TYPE.engines.length < 2) return;
  const env = mkEnv();
  const a = new Aircraft(TYPE); a.place(0, 0, 0, env);
  a.pos.y = 800; a.vel.set(0, 0, -TYPE.speeds.vyse! * 0.5144); a.onGround = false; a.gearPos = 0;
  a.eng.forEach((e) => { e.running = true; e.rpm = 5400; });
  a.toggleFailure(0); // left engine fails
  const c = ctl({ throttle: 1, gearDown: false });
  let t = 0;
  for (; t < 60; t += STEP) {
    // hold Vyse with pitch, wings ~level (3° into the live engine), heading with rudder
    c.elevator = holdPitch(a, clamp((a.ias * 1.944 - TYPE.speeds.vyse!) * 0.8, -5, 12));
    c.aileron = clamp((e(a).z * 57.3 + 3) * 0.05 + a.omega.z * 0.5, -1, 1); // 3° bank towards the live (right) engine
    c.rudder = clamp(hdgErr(a, 0) * 0.08 + a.omega.y * 1.5, -1, 1);
    a.step(STEP, c, env);
  }
  console.log(`single engine (left failed, gear up, Vyse): ias ${kt(a)} kt, vs ${(a.vs * 196.85).toFixed(0)} fpm, rudder ${c.rudder.toFixed(2)}, hdg ${a.heading().toFixed(0)}`);
  // Vmc: full power on the right engine, slow down until the rudder can no longer hold heading
  const b = new Aircraft(TYPE); b.place(0, 0, 0, env);
  b.pos.y = 1500; b.vel.set(0, 0, -45); b.onGround = false; b.gearPos = 0;
  b.eng.forEach((e) => { e.running = true; e.rpm = 5400; }); b.toggleFailure(0);
  let lost = 0;
  for (let tt = 0; tt < 90; tt += STEP) {
    const target = 80 - tt * 0.5;
    c.elevator = holdPitch(b, clamp((b.ias * 1.944 - target) * 0.8, -5, 20));
    c.aileron = clamp((e(b).z * 57.3 + 5) * 0.05 + b.omega.z * 0.5, -1, 1);
    c.rudder = clamp(hdgErr(b, 0) * 0.15 + b.omega.y * 2, -1, 1);
    b.step(STEP, c, env);
    if (!lost && Math.abs(hdgErr(b, 0)) > 15) lost = b.ias * 1.944;
    if (b.ias * 1.944 < 50) break;
  }
  console.log(`Vmc: heading lost at ${lost ? lost.toFixed(0) + ' kt' : 'below the stall (controllable down to stall)'}`);
}
singleEngine();

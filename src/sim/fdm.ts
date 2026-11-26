// Simplified rigid-body flight model, parameterised per aircraft type (P2002, P2006T).
// Body frame: nose = -z, up = +y, right = +x. "Fun-realistic": numbers follow the POHs
// roughly, not certified data. Engines push at their real positions, so a failed engine on
// a twin yaws the aircraft by itself; retractable gear only carries load when down.
import * as THREE from 'three';

export interface Controls {
  elevator: number;  // -1..1, + = stick back (nose up)
  aileron: number;   // -1..1, + = roll right
  rudder: number;    // -1..1, + = yaw right / steer right
  throttle: number;  // 0..1 (both engines)
  brakeL: number; brakeR: number; // 0..1
  parking: boolean;
  flaps: number;     // 0, 1 (T/O), 2 (LDG)
  trim: number;      // -1..1, + = nose up
  gearDown?: boolean; // retractable gear selector
}

export interface Env {
  heightAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): number;
  hitsBuilding(x: number, z: number): boolean;
  wind: THREE.Vector3; // world m/s (air movement)
}

export interface EngineDef { pos: readonly [number, number, number]; power: number; propEff: number; staticThrust: number; idleRpm: number; maxRpm: number; torqueYaw: number }
export interface AircraftParams {
  name: string;
  mass: number; S: number; b: number; c: number;
  inertia: readonly [number, number, number];
  engines: readonly EngineDef[];
  propWash: number;          // share of thrust acting on the tail surfaces
  cl0: number; clAlpha: number; clMax: number; cd0: number; k: number; cyBeta: number;
  flaps: readonly { deg: number; dCL: number; dCLmax: number; dCD: number; dCm: number }[];
  cm0: number; cmAlpha: number; cmq: number; cmDe: number;
  clBeta: number; clp: number; clr: number; clDa: number;
  cnBeta: number; cnr: number; cnp: number; cnDr: number; cnDa: number;
  noseSteer: number; rollFriction: number; brakeFriction: number; sideFriction: number;
  gear: readonly { name: string; p: readonly number[]; k: number; c: number }[];
  structure: readonly { name: string; p: readonly number[] }[];
  retractable: boolean; gearDrag: number; gearTime: number;
  restHeight: number; restPitch: number;
  eye: THREE.Vector3;
  speeds: { vs0: number; vs1: number; vr: number; vx: number; vy: number; vfe: number; vno: number; vne: number; approach: number; vmc?: number; vyse?: number; whiteTop: number };
}

export interface EngineState { rpm: number; running: boolean; starting: number; failed: boolean; thrust: number }

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
const qInv = new THREE.Quaternion(), qTmp = new THREE.Quaternion();
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export class Aircraft {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  quat = new THREE.Quaternion();
  omega = new THREE.Vector3(); // body rad/s
  eng: EngineState[];
  gearPos = 1;       // 0 = up, 1 = down
  crashed: string | null = null;
  onGround = true;
  wheelLoad: number[];
  // telemetry
  ias = 0; alpha = 0; beta = 0; stall = false; vs = 0; gForce = 1; touchdownVs = 0;
  /** inclinometer ball angle (rad, + = ball right), damped like the liquid-filled tube */
  ball = 0;
  /** turn coordinator gyro output (deg/s, + = right), canted 30° so it also senses roll rate */
  turnGyro = 0;
  private eulerTmp = new THREE.Euler();
  private wasOnGround = true;
  private force = new THREE.Vector3();
  private torque = new THREE.Vector3(); // body

  constructor(public A: AircraftParams) {
    this.eng = A.engines.map(() => ({ rpm: 0, running: false, starting: 0, failed: false, thrust: 0 }));
    this.wheelLoad = A.gear.map(() => 0);
  }

  // aggregate engine helpers (single-engine code paths)
  get rpm() { return Math.max(...this.eng.map((e) => e.rpm)); }
  set rpm(v: number) { this.eng.forEach((e) => (e.rpm = v)); }
  get running() { return this.eng.some((e) => e.running); }
  set running(v: boolean) { this.eng.forEach((e) => { e.running = v && !e.failed; if (!v) e.starting = 0; }); }
  get starting() { return Math.max(...this.eng.map((e) => e.starting)); }

  place(x: number, z: number, hdgDeg: number, env: Env) {
    this.pos.set(x, env.heightAt(x, z) + this.A.restHeight, z);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.quat.setFromEuler(new THREE.Euler(this.A.restPitch, -hdgDeg * Math.PI / 180, 0, 'YXZ'));
    this.crashed = null;
    this.gearPos = 1;
    this.eng.forEach((e) => { e.failed = false; });
    this.onGround = true; this.wasOnGround = true;
  }

  heading() { // degrees true
    const f = v1.set(0, 0, -1).applyQuaternion(this.quat);
    return (Math.atan2(f.x, -f.z) * 180 / Math.PI + 360) % 360;
  }
  euler() { return new THREE.Euler().setFromQuaternion(this.quat, 'YXZ'); } // x pitch, z bank(-)

  step(dt: number, c: Controls, env: Env) {
    if (this.crashed) return;
    const A = this.A;
    this.force.set(0, -A.mass * 9.81, 0);
    this.torque.set(0, 0, 0);
    qInv.copy(this.quat).invert();

    const air = v1.copy(this.vel).sub(env.wind);
    const vb = air.applyQuaternion(qInv); // body-frame airflow velocity (aircraft rel. air)
    const V = vb.length();

    // ---- engines ----
    let thrustSum = 0, torqueYaw = 0;
    A.engines.forEach((d, i) => {
      const e = this.eng[i];
      if (e.starting > 0) {
        e.starting -= dt;
        e.rpm += (800 - e.rpm) * dt * 2;
        if (e.starting <= 0) e.running = !e.failed;
      }
      const target = e.running ? d.idleRpm + c.throttle * (d.maxRpm - d.idleRpm) + V * 8 : e.starting > 0 ? 800 : V * 25;
      e.rpm += (Math.min(target, 5800) - e.rpm) * Math.min(1, dt * (e.running ? 3 : 1));
      const pwr = e.running ? clamp((e.rpm - d.idleRpm) / (d.maxRpm - d.idleRpm), 0, 1) : 0;
      const t = pwr * Math.min(d.staticThrust, (d.power * d.propEff) / Math.max(V, 1)) - (e.running ? 0 : 0.6 * V);
      e.thrust = t;
      this.addBodyForce(0, 0, -t, d.pos[0], d.pos[1], d.pos[2]);
      thrustSum += Math.max(t, 0);
      if (e.running) torqueYaw += d.torqueYaw * t;
    });

    // ---- retractable gear ----
    if (A.retractable) {
      const want = c.gearDown === false && !this.onGround ? 0 : 1;
      this.gearPos += clamp(want - this.gearPos, -dt / A.gearTime, dt / A.gearTime);
    }
    const gearOut = A.retractable ? this.gearPos : 1;

    // ---- aerodynamics ----
    const rho = 1.225 * Math.pow(Math.max(0, 1 - 2.256e-5 * this.pos.y), 4.256);
    const qbar = 0.5 * rho * V * V;
    const alpha = Math.atan2(-vb.y, -vb.z);
    const beta = V > 1 ? Math.asin(clamp(vb.x / V, -1, 1)) : 0;
    this.alpha = alpha; this.beta = beta;
    const fl = A.flaps[c.flaps];
    const cl0 = A.cl0 + fl.dCL, clMax = A.clMax + fl.dCLmax;
    const aStall = (clMax - cl0) / A.clAlpha;
    let CL: number;
    if (alpha > aStall) CL = Math.max(clMax - (alpha - aStall) * 3.2, 1.05 * Math.sin(2 * alpha), 0.55 * Math.sin(2 * alpha));
    else if (alpha < -0.22) CL = Math.min(cl0 - 0.22 * A.clAlpha + (alpha + 0.22) * 2.5, 1.05 * Math.sin(2 * alpha));
    else CL = cl0 + A.clAlpha * alpha;
    this.stall = alpha > aStall - 0.035 && V > 8;
    const CD = A.cd0 + fl.dCD + A.gearDrag * gearOut + A.k * CL * CL + 1.1 * Math.sin(alpha) ** 2;
    const CY = A.cyBeta * beta;
    if (V > 0.5) {
      const vh = v2.copy(vb).divideScalar(V);
      const liftDir = v3.set(1, 0, 0).cross(vh).normalize();
      const L = qbar * A.S * CL, D = qbar * A.S * CD, Y = qbar * A.S * CY;
      this.addBodyForce(liftDir.x * L - vh.x * D + Y, liftDir.y * L - vh.y * D, liftDir.z * L - vh.z * D, 0, 0, 0);
    }
    // moments (aviation sign conventions), with prop wash on tail surfaces
    const Vm = Math.max(V, 5);
    const p = -this.omega.z, q = this.omega.x, r = -this.omega.y;
    const ph = p * A.b / (2 * Vm), qh = q * A.c / (2 * Vm), rh = r * A.b / (2 * Vm);
    const qTail = qbar + A.propWash * thrustSum;
    const stalledRoll = this.stall && !this.onGround ? 0.06 * Math.sign(beta || 0.01) + 0.02 * Math.sin(performance.now() / 300) : 0;
    const Cl = A.clBeta * beta + A.clp * ph + A.clr * rh + A.clDa * c.aileron + stalledRoll;
    const Cm = A.cm0 + fl.dCm + A.cmAlpha * clamp(alpha, -0.5, 0.5) + A.cmq * qh;
    const CmCtl = A.cmDe * (c.elevator + c.trim * 0.35);
    const Cn = A.cnBeta * beta + A.cnr * rh + A.cnp * ph + A.cnDa * c.aileron;
    const CnCtl = A.cnDr * c.rudder;
    const Lm = qbar * A.S * A.b * Cl;
    const Mm = qbar * A.S * A.c * Cm + qTail * A.S * A.c * CmCtl;
    const Nm = qbar * A.S * A.b * Cn + qTail * A.S * A.b * CnCtl - torqueYaw;
    this.torque.x += Mm; this.torque.y += -Nm; this.torque.z += -Lm;
    this.torque.addScaledVector(this.omega, -60); // tiny structural damping

    // ---- ground contact ----
    let contact = false;
    if (gearOut > 0.97) {
      const gsp = Math.hypot(this.vel.x, this.vel.z);
      A.gear.forEach((g, i) => {
        const brake = i === 0 ? 0 : (c.parking ? 1 : i === 1 ? c.brakeL : c.brakeR);
        const steer = i === 0 ? c.rudder * A.noseSteer * clamp(1.15 - gsp / 14, 0.2, 1) : 0;
        const n = this.wheel(g.p, g.k, g.c, brake, steer, env, dt);
        this.wheelLoad[i] = n;
        if (n > 0) contact = true;
      });
    } else this.wheelLoad.fill(0);
    // ---- crash checks ----
    for (const s of A.structure) {
      const w = v4.set(s.p[0], s.p[1], s.p[2]).applyQuaternion(this.quat).add(this.pos);
      if (w.y < env.heightAt(w.x, w.z) - 0.02) {
        this.crash(gearOut < 0.97 && (s.name === 'Belly' || s.name === 'Nose') ? 'Gear-up landing – belly slide' : s.name + ' struck the ground');
        return;
      }
    }
    const top = env.surfaceAt(this.pos.x, this.pos.z), ground = env.heightAt(this.pos.x, this.pos.z);
    if (top - ground > 5 && this.pos.y < top - 1) { this.crash('Flew into trees'); return; }
    if (this.pos.y - ground < 6 && env.hitsBuilding(this.pos.x, this.pos.z)) { this.crash('Hit a building'); return; }

    // ---- instruments: specific force (everything except gravity) in body frame ----
    const fb = v3.copy(this.force).setY(this.force.y + A.mass * 9.81).applyQuaternion(qInv);
    const ballTarget = Math.atan2(-fb.x, Math.max(fb.y, 0.2 * A.mass * 9.81));
    this.ball += (ballTarget - this.ball) * Math.min(1, dt / 0.35);
    // calibrated turn coordinator: true turn rate + roll-rate lead (canted gyro)
    const eu = this.eulerTmp.setFromQuaternion(this.quat, 'YXZ');
    const bankR = -eu.z, qR = this.omega.x, rR = -this.omega.y, pR = -this.omega.z;
    const tcRaw = ((qR * Math.sin(bankR) + rR * Math.cos(bankR)) / Math.max(0.2, Math.cos(eu.x)) + 0.5 * pR) * 57.2958;
    this.turnGyro += (tcRaw - this.turnGyro) * Math.min(1, dt / 0.25);

    // ---- integrate ----
    const acc = v2.copy(this.force).divideScalar(A.mass);
    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);
    const I = A.inertia, w = this.omega;
    const Iw = v3.set(I[0] * w.x, I[1] * w.y, I[2] * w.z);
    const gyro = v4.copy(w).cross(Iw);
    w.x += ((this.torque.x - gyro.x) / I[0]) * dt;
    w.y += ((this.torque.y - gyro.y) / I[1]) * dt;
    w.z += ((this.torque.z - gyro.z) / I[2]) * dt;
    qTmp.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0);
    qTmp.premultiply(this.quat); // q * (0, w dt/2)
    this.quat.set(this.quat.x + qTmp.x, this.quat.y + qTmp.y, this.quat.z + qTmp.z, this.quat.w + qTmp.w).normalize();

    // telemetry
    this.ias = Math.max(0, -vb.z) * Math.sqrt(rho / 1.225);
    this.vs = this.vel.y;
    this.gForce = acc.y / 9.81 + 1;
    if (contact && !this.wasOnGround) this.touchdownVs = -this.vel.y;
    this.onGround = contact;
    this.wasOnGround = contact;
  }

  private addBodyForce(fx: number, fy: number, fz: number, px: number, py: number, pz: number) {
    const f = v4.set(fx, fy, fz);
    // torque in body = r x F (body)
    this.torque.x += py * fz - pz * fy;
    this.torque.y += pz * fx - px * fz;
    this.torque.z += px * fy - py * fx;
    this.force.add(f.applyQuaternion(this.quat));
  }

  /** Spring-damper wheel with rolling, braking and side friction. Returns normal load (N). */
  private wheel(p: readonly number[], k: number, cdamp: number, brake: number, steer: number, env: Env, _dt: number) {
    const A = this.A;
    const rw = new THREE.Vector3(p[0], p[1], p[2]).applyQuaternion(this.quat);
    const pw = rw.clone().add(this.pos);
    const h = env.heightAt(pw.x, pw.z);
    const pen = h - pw.y;
    if (pen <= 0) return 0;
    const e = 0.6;
    const nrm = new THREE.Vector3(env.heightAt(pw.x - e, pw.z) - env.heightAt(pw.x + e, pw.z), 2 * e, env.heightAt(pw.x, pw.z - e) - env.heightAt(pw.x, pw.z + e)).normalize();
    const wWorld = this.omega.clone().applyQuaternion(this.quat);
    const vp = this.vel.clone().add(wWorld.cross(rw));
    const vn = vp.dot(nrm);
    let N = k * Math.min(pen, 0.4) - cdamp * vn;
    if (pen > 0.35 && vn < -3.2 && !this.crashed) this.crash('Hard landing – gear collapsed');
    N = clamp(N, 0, 120000);
    const fwd = new THREE.Vector3(Math.sin(steer), 0, -Math.cos(steer)).applyQuaternion(this.quat);
    fwd.addScaledVector(nrm, -fwd.dot(nrm)).normalize();
    const side = fwd.clone().cross(nrm).normalize();
    const vf = vp.dot(fwd), vs = vp.dot(side);
    const mu = A.rollFriction + brake * A.brakeFriction;
    const Ff = -mu * N * clamp(vf / 0.25, -1, 1);
    const Fs = -A.sideFriction * N * clamp(vs / 0.12, -1, 1);
    const F = nrm.multiplyScalar(N).addScaledVector(fwd, Ff).addScaledVector(side, Fs);
    this.force.add(F);
    const tWorld = rw.cross(F);
    this.torque.add(tWorld.applyQuaternion(qInv));
    return N;
  }

  crash(why: string) {
    this.crashed = why;
    this.vel.set(0, 0, 0); this.omega.set(0, 0, 0);
    this.running = false;
  }

  startEngine() { this.eng.forEach((e, i) => { if (!e.running && e.starting <= 0 && !e.failed) e.starting = 1.6 + i * 1.4; }); }
  stopEngine() { this.running = false; }
  /** Toggle an engine failure (training): failed engines stop and cannot be restarted until fixed. */
  toggleFailure(i: number) {
    const e = this.eng[i]; if (!e) return;
    e.failed = !e.failed;
    if (e.failed) { e.running = false; e.starting = 0; }
    else if (this.running) e.starting = 1.6;
  }
}

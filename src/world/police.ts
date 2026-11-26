// Czech-style police car (silver, blue + fluorescent yellow-green side stripes, "POLICIE"),
// with flashing blue roof lights. Appears on the apron when the Tisem granny follows through.
import * as THREE from 'three';

function stripeTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#1f3f9e' : '#d4ff2a'; g.fillRect(i * 32, 0, 32, 64); }
  g.fillStyle = '#1f3f9e'; g.fillRect(120, 6, 272, 52);
  g.fillStyle = '#fff'; g.font = 'bold 40px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('POLICIE', 256, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildPoliceCar() {
  const car = new THREE.Group();
  const silver = new THREE.MeshStandardMaterial({ color: 0xd9dcdf, metalness: 0.6, roughness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2430, metalness: 0.3, roughness: 0.1 });
  const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; car.add(mesh); return mesh;
  };
  // body (length along x), cabin, bonnet slope
  add(new THREE.BoxGeometry(4.6, 0.72, 1.8), silver, 0, 0.7, 0);
  add(new THREE.BoxGeometry(2.5, 0.62, 1.62), glass, -0.25, 1.37, 0);
  add(new THREE.BoxGeometry(2.3, 0.06, 1.6), silver, -0.25, 1.7, 0);
  // side stripes with POLICIE
  const tex = stripeTexture();
  const stripeMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
  for (const s of [-1, 1]) {
    const p = add(new THREE.PlaneGeometry(4.4, 0.36), stripeMat, 0, 0.74, s * 0.905);
    p.rotation.y = s > 0 ? 0 : Math.PI;
  }
  // wheels
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 16).rotateX(Math.PI / 2);
  for (const x of [-1.45, 1.45]) for (const z of [-0.82, 0.82]) add(wheel, black, x, 0.33, z);
  // light bar
  add(new THREE.BoxGeometry(0.3, 0.1, 1.2), black, -0.25, 1.78, 0);
  const blueA = new THREE.MeshBasicMaterial({ color: 0x2a5cff }), blueB = new THREE.MeshBasicMaterial({ color: 0x2a5cff });
  add(new THREE.BoxGeometry(0.28, 0.14, 0.5), blueA, -0.25, 1.88, -0.32);
  add(new THREE.BoxGeometry(0.28, 0.14, 0.5), blueB, -0.25, 1.88, 0.32);
  // headlights
  const head = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  for (const z of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.05, 0.14, 0.32), head, 2.31, 0.85, z);

  const glow = new THREE.PointLight(0x3366ff, 0, 25, 2);
  glow.position.set(-0.25, 2.2, 0);
  car.add(glow);
  car.visible = false;

  const off = new THREE.Color(0x0a1440), on = new THREE.Color(0x4f7dff);
  function update(t: number) {
    if (!car.visible) return;
    const phase = Math.floor(t * 6) % 4; // double flash, alternating sides
    const a = phase === 0 || phase === 1 ? (Math.floor(t * 12) % 2 === 0) : false;
    const b = phase === 2 || phase === 3 ? (Math.floor(t * 12) % 2 === 0) : false;
    blueA.color.copy(a ? on : off); blueB.color.copy(b ? on : off);
    glow.intensity = a || b ? 6 : 0;
  }
  return { car, update };
}

/**
 * Police pursuit at LKBE: the car drives over the terrain towards the aircraft's ground
 * position (max ~110 km/h), slowing down as it closes in. Caught = car within a few metres
 * of a slow aircraft on the ground.
 */
export class PoliceChase {
  active = false;
  speed = 0;
  private heading = 0;
  private home = new THREE.Vector3();
  private up = new THREE.Vector3(); private fwd = new THREE.Vector3(); private side = new THREE.Vector3(); private m = new THREE.Matrix4();

  constructor(private car: THREE.Object3D, private heightAt: (x: number, z: number) => number) {}

  /** Park the car at its spawn point (also used on reset). */
  park(x: number, z: number, heading: number) {
    this.home.set(x, 0, z);
    this.heading = heading; this.speed = 0; this.active = false;
    this.pose(x, z);
  }

  /** Distance from the car to a point on the ground (m). */
  distanceTo(x: number, z: number) { return Math.hypot(this.car.position.x - x, this.car.position.z - z); }

  /** Advance the chase; returns true when the aircraft is caught. */
  update(dt: number, ac: { x: number; z: number; aglFt: number; onGround: boolean; gsKt: number }) {
    const homeDist = Math.hypot(ac.x - this.home.x, ac.z - this.home.z);
    // start (or keep) chasing when the aircraft is back around LKBE, on the ground or low
    if (!this.active && homeDist < 3000 && (ac.onGround || ac.aglFt < 1200)) this.active = true;
    if (!this.active) return false;
    const p = this.car.position;
    const dx = ac.x - p.x, dz = ac.z - p.z, d = Math.hypot(dx, dz);
    // steer towards the target with a turn-rate limit
    const want = Math.atan2(-dz, dx);
    let dh = want - this.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const maxTurn = (this.speed < 8 ? 2.2 : 1.1) * dt;
    this.heading += Math.max(-maxTurn, Math.min(maxTurn, dh));
    const align = Math.cos(dh);
    const target = Math.min(31, Math.max(0, (d - 7) * 0.9)) * (align > 0.2 ? 1 : 0.35); // pull up ~7 m away
    this.speed += Math.max(-9 * dt, Math.min(5.5 * dt, target - this.speed));
    p.x += Math.cos(this.heading) * this.speed * dt;
    p.z += -Math.sin(this.heading) * this.speed * dt;
    this.pose(p.x, p.z);
    return ac.onGround && ac.gsKt < 15 && d < 11;
  }

  /** Put the car on the terrain, aligned with the slope. */
  private pose(x: number, z: number) {
    const e = 1.5, h = this.heightAt(x, z);
    this.up.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
    this.fwd.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
    this.side.crossVectors(this.fwd, this.up).normalize();
    this.m.makeBasis(this.fwd, this.up, this.side);
    this.car.quaternion.setFromRotationMatrix(this.m);
    this.car.position.set(x, h, z);
  }
}

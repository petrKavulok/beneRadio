// Camera rig: cockpit, chase and tower views.
import * as THREE from 'three';
import { P2002 } from './sim/p2002';

export type View = 'cockpit' | 'chase' | 'tower';
const VIEWS: View[] = ['cockpit', 'chase', 'tower'];

export class CameraRig {
  view: View = 'chase';
  yaw = 0; pitch = -0.12; dist = 13;
  eye = P2002.eye.clone();
  tower: { pos: [number, number]; height: number } = { pos: [30, 335], height: 9 };
  private chasePos = new THREE.Vector3();
  private first = true;

  constructor(public cam: THREE.PerspectiveCamera, private heightAt: (x: number, z: number) => number) {}

  next() {
    this.view = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length];
    this.yaw = 0; this.pitch = this.view === 'cockpit' ? -0.1 : -0.12; this.first = true;
    this.cam.fov = this.view === 'cockpit' ? 70 : 60; this.cam.updateProjectionMatrix();
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.003, -1.3, 1.0);
  }
  zoom(steps: number) {
    if (this.view === 'cockpit') this.cam.fov = THREE.MathUtils.clamp(this.cam.fov + steps * 3, 30, 90);
    else this.dist = THREE.MathUtils.clamp(this.dist * (1 + steps * 0.1), 6, 400);
    this.cam.updateProjectionMatrix();
  }

  update(dt: number, pos: THREE.Vector3, quat: THREE.Quaternion, hdgDeg: number) {
    const cam = this.cam;
    if (this.view === 'cockpit') {
      cam.position.copy(this.eye).applyQuaternion(quat).add(pos);
      cam.quaternion.copy(quat).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')));
      return;
    }
    if (this.view === 'chase') {
      const h = -hdgDeg * Math.PI / 180 + this.yaw;
      const off = new THREE.Vector3(0, 0, this.dist).applyEuler(new THREE.Euler(this.pitch, h, 0, 'YXZ'));
      const want = pos.clone().add(off);
      if (this.first) { this.chasePos.copy(want); this.first = false; }
      this.chasePos.lerp(want, 1 - Math.exp(-dt * 4));
      const gmin = this.heightAt(this.chasePos.x, this.chasePos.z) + 1.0;
      if (this.chasePos.y < gmin) this.chasePos.y = gmin;
      cam.position.copy(this.chasePos);
      cam.lookAt(pos.x, pos.y + 0.8, pos.z);
      if (cam.fov !== 60) { cam.fov = 60; cam.updateProjectionMatrix(); }
      return;
    }
    // tower
    const [tx, tz] = this.tower.pos;
    cam.position.set(tx, this.heightAt(tx, tz) + this.tower.height, tz);
    cam.lookAt(pos);
    const d = cam.position.distanceTo(pos);
    const fov = THREE.MathUtils.clamp(2 * Math.atan(18 / d) * 180 / Math.PI, 2, 60);
    if (Math.abs(fov - cam.fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
}

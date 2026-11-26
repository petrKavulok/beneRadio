// Screen-space overlay: village names, target marker, big centre messages.
import * as THREE from 'three';
import { Place } from './map';
import { GeoData } from '../world/data';
import { P2 } from '../airport/lkbe';
import { AcState } from '../lesson';
import type { NavInfo } from '../nav';

const v = new THREE.Vector3();

export class Hud {
  private g: CanvasRenderingContext2D;
  private heights = new Map<Place, number>();
  constructor(private cv: HTMLCanvasElement, private places: Place[], private geo: GeoData) {
    this.g = cv.getContext('2d')!;
  }
  private hOf(p: Place) {
    let h = this.heights.get(p);
    if (h === undefined) { h = this.geo.heightAt(p.x, p.z); if (h !== 400) this.heights.set(p, h); }
    return h;
  }

  /** Destination marker in the 3D view; an arrow at the screen edge when it's out of view. */
  private navMarker(cam: THREE.PerspectiveCamera, nav: NavInfo) {
    const g = this.g, W = innerWidth, H = innerHeight;
    const h = this.geo.heightAt(nav.to[0], nav.to[1]) + 60;
    const c = v.set(nav.to[0], h, nav.to[1]).applyMatrix4(cam.matrixWorldInverse); // camera space
    const behind = c.z > 0;
    v.set(nav.to[0], h, nav.to[1]).project(cam);
    let sx = (v.x + 1) / 2 * W, sy = (1 - v.y) / 2 * H;
    const label = `${nav.icao} ${nav.distNm.toFixed(1)} NM`;
    g.font = '700 13px system-ui'; g.textAlign = 'center'; g.textBaseline = 'bottom';
    const m = 40, inView = !behind && sx > m && sx < W - m && sy > m && sy < H * 0.75;
    if (inView) {
      g.strokeStyle = '#ff3df2'; g.lineWidth = 3;
      g.beginPath(); g.arc(sx, sy, 11, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(sx, sy + 11); g.lineTo(sx, sy + 30); g.stroke();
      g.fillStyle = '#000a'; g.fillText(label, sx + 1, sy - 15); g.fillStyle = '#ff7df5'; g.fillText(label, sx, sy - 16);
      return;
    }
    // direction from screen centre (flip if behind the camera)
    let dx = sx - W / 2, dy = sy - H / 2;
    if (behind) { dx = -dx; dy = -dy; }
    const ang = Math.atan2(dy, dx), rx = W / 2 - 60, ry = H * 0.32;
    sx = W / 2 + Math.cos(ang) * rx; sy = H * 0.42 + Math.sin(ang) * ry;
    g.save(); g.translate(sx, sy); g.rotate(ang);
    g.fillStyle = '#ff3df2'; g.beginPath(); g.moveTo(18, 0); g.lineTo(-10, -12); g.lineTo(-4, 0); g.lineTo(-10, 12); g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#000a'; g.fillText(label, sx + 1, sy - 17); g.fillStyle = '#ff7df5'; g.fillText(label, sx, sy - 18);
  }

  private project(cam: THREE.Camera, x: number, y: number, z: number) {
    v.set(x, y, z).project(cam);
    if (v.z > 1 || v.z < -1) return null;
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight] as const;
  }

  draw(cam: THREE.PerspectiveCamera, labels: boolean, target: P2 | null, a: AcState, nav: NavInfo | null = null) {
    const dpr = Math.min(devicePixelRatio, 2);
    if (this.cv.width !== innerWidth * dpr || this.cv.height !== innerHeight * dpr) { this.cv.width = innerWidth * dpr; this.cv.height = innerHeight * dpr; }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, innerWidth, innerHeight);
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    if (labels) {
      this.places.forEach((p) => {
        const d = Math.hypot(p.x - cam.position.x, p.z - cam.position.z);
        const maxD = p.t === 'town' ? 14000 : p.t === 'village' ? 8000 : 4000;
        if (d > maxD || d < 150) return;
        const s = this.project(cam, p.x, this.hOf(p) + 40, p.z);
        if (!s) return;
        const alpha = Math.min(1, (maxD - d) / 1500);
        g.font = `${p.t === 'town' ? 700 : 600} ${p.t === 'town' ? 15 : p.t === 'village' ? 13 : 11}px system-ui`;
        g.fillStyle = `rgba(0,0,0,${0.5 * alpha})`; g.fillText(p.n, s[0] + 1, s[1] + 1);
        g.fillStyle = `rgba(255,255,255,${alpha})`; g.fillText(p.n, s[0], s[1]);
      });
    }
    if (target) {
      const h = this.geo.heightAt(target[0], target[1]);
      const s = this.project(cam, target[0], h + 6, target[1]);
      if (s) {
        const d = Math.hypot(target[0] - a.x, target[1] - a.z);
        g.strokeStyle = '#ff3df2'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(s[0], s[1] - 12); g.lineTo(s[0] + 9, s[1]); g.lineTo(s[0], s[1] + 12); g.lineTo(s[0] - 9, s[1]); g.closePath(); g.stroke();
        g.font = '600 12px system-ui'; g.fillStyle = '#ff3df2'; g.fillText(`${Math.round(d)} m`, s[0], s[1] - 16);
      }
    }
    if (nav) this.navMarker(cam, nav);
    if (a.crashed) {
      g.font = '700 34px system-ui'; g.fillStyle = '#ff5040'; g.textBaseline = 'middle';
      g.fillText('CRASH', innerWidth / 2, innerHeight * 0.35);
      g.font = '500 18px system-ui'; g.fillStyle = '#fff'; g.fillText(a.crashed + ' – Backspace to restart', innerWidth / 2, innerHeight * 0.35 + 34);
    }
  }
}

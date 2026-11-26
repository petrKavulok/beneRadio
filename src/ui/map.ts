// Moving map: orthophoto tiles + airfield layout + route + aircraft.
import type { Airport, P2 } from '../airport/types';
import { NavInfo, fmtBrg } from '../nav';

export interface MapTile { img: CanvasImageSource; x0: number; z0: number; x1: number; z1: number; ring: number }
export interface Place { n: string; t: string; x: number; z: number }

export class MovingMap {
  private g: CanvasRenderingContext2D;
  big = false;
  mode = 0; // 0 small, 1 big, 2 big + wide range
  constructor(private cv: HTMLCanvasElement, private tiles: () => MapTile[], private places: Place[], private airports: Airport[]) { this.g = cv.getContext('2d')!; }

  toggle() { this.mode = (this.mode + 1) % 3; this.big = this.mode > 0; this.cv.classList.toggle('big', this.big); }

  draw(ac: { x: number; z: number; hdg: number }, onGround: boolean, route: P2[] | null, target: P2 | null, nav: NavInfo | null = null) {
    const dpr = Math.min(devicePixelRatio, 2);
    const css = this.cv.getBoundingClientRect();
    const W = Math.round(css.width * dpr), H = Math.round(css.height * dpr);
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    const g = this.g;
    const span = this.mode === 2 ? 60000 : this.big ? (onGround ? 1600 : 9000) : onGround ? 650 : 5000; // metres across
    const s = W / span;
    const home = this.airports.reduce((b, a) => (Math.hypot(a.centre[0] - ac.x, a.centre[1] - ac.z) < Math.hypot(b.centre[0] - ac.x, b.centre[1] - ac.z) ? a : b));
    const cx = this.mode === 1 && onGround ? home.centre[0] : ac.x, cz = this.mode === 1 && onGround ? home.centre[1] + 100 : ac.z;
    const X = (x: number) => (x - cx) * s + W / 2, Z = (z: number) => (z - cz) * s + H / 2;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#3d4a33'; g.fillRect(0, 0, W, H);
    // ortho tiles: prefer high-res where available
    for (const t of [...this.tiles()].sort((a, b) => b.ring - a.ring)) {
      if (X(t.x1) < 0 || X(t.x0) > W || Z(t.z1) < 0 || Z(t.z0) > H) continue;
      g.drawImage(t.img, X(t.x0), Z(t.z0), (t.x1 - t.x0) * s, (t.z1 - t.z0) * s);
    }
    g.fillStyle = '#0003'; g.fillRect(0, 0, W, H);
    for (const ap of this.airports) {
    if (X(ap.centre[0]) < -4000 * s || X(ap.centre[0]) > W + 4000 * s || Z(ap.centre[1]) < -4000 * s || Z(ap.centre[1]) > H + 4000 * s) continue;
    const RUNWAYS = ap.runways, TAXIWAYS = ap.taxiways, HOLDING_POINTS = ap.holds.filter((h) => Object.values(ap.hpFor).includes(h.id));
    // runways
    for (const r of RUNWAYS) {
      if (r.id > r.pair.split('/')[1]) continue;
      g.strokeStyle = r.lit ? '#fff' : '#e8e2c0'; g.lineWidth = Math.max(2, r.width * s * (span < 2500 ? 1 : 2)); g.lineCap = 'butt';
      g.beginPath(); g.moveTo(X(r.thr[0]), Z(r.thr[1])); g.lineTo(X(r.end[0]), Z(r.end[1])); g.stroke();
    }
    if (span < 2500) {
      g.lineCap = 'round';
      for (const t of TAXIWAYS) {
        g.strokeStyle = t.lit ? '#7fb0ff' : '#ffe680'; g.lineWidth = Math.max(1.5, 3 * dpr);
        g.beginPath(); t.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.stroke();
        if (t.name !== 'apron' && t.name !== 'TWY' && span < 1700) {
          const m = t.pts[Math.floor((t.pts.length - 1) / 2)], n = t.pts[Math.floor((t.pts.length - 1) / 2) + 1];
          this.label(t.name, X((m[0] + n[0]) / 2), Z((m[1] + n[1]) / 2), 12 * dpr, '#111', '#ffe680');
        }
      }
      for (const r of RUNWAYS) this.label(r.id, X(r.thr[0] + (r.thr[0] - r.end[0]) * 0.06), Z(r.thr[1] + (r.thr[1] - r.end[1]) * 0.06), 12 * dpr, '#fff', '#000a');
      for (const hp of HOLDING_POINTS) {
        g.fillStyle = '#f2c500'; g.beginPath(); g.arc(X(hp.pos[0]), Z(hp.pos[1]), 3.5 * dpr, 0, Math.PI * 2); g.fill();
      }
    } else {
      this.label(ap.icao, X(ap.centre[0]), Z(ap.centre[1]) - 14 * dpr, 11 * dpr, '#111', '#ffe680');
    }
    }
    if (span >= 2500) {
      g.font = `600 ${11 * dpr}px system-ui`; g.textAlign = 'center';
      for (const p of this.places) {
        const x = X(p.x), z = Z(p.z);
        if (x < -50 || x > W + 50 || z < -20 || z > H + 20) continue;
        if (p.t === 'hamlet' && span > 6000) continue;
        if (p.t !== 'town' && span > 20000) continue;
        g.fillStyle = '#fffd'; g.fillText(p.n, x, z);
      }
    }
    if (route && route.length > 1) {
      g.strokeStyle = '#ff3df2'; g.lineWidth = 3 * dpr; g.setLineDash([8 * dpr, 6 * dpr]);
      g.beginPath(); route.forEach((p, i) => (i ? g.lineTo(X(p[0]), Z(p[1])) : g.moveTo(X(p[0]), Z(p[1])))); g.stroke();
      g.setLineDash([]);
    }
    if (target) {
      g.strokeStyle = '#ff3df2'; g.lineWidth = 2.5 * dpr;
      g.beginPath(); g.arc(X(target[0]), Z(target[1]), 9 * dpr, 0, Math.PI * 2); g.stroke();
    }
    // direct-to course line and destination
    if (nav) {
      g.strokeStyle = '#ff3df2'; g.lineWidth = 3.5 * dpr; g.setLineDash([14 * dpr, 7 * dpr]);
      g.beginPath(); g.moveTo(X(ac.x), Z(ac.z)); g.lineTo(X(nav.to[0]), Z(nav.to[1])); g.stroke(); g.setLineDash([]);
      g.lineWidth = 3 * dpr; g.beginPath(); g.arc(X(nav.to[0]), Z(nav.to[1]), 12 * dpr, 0, Math.PI * 2); g.stroke();
      const txt = `→ ${nav.icao}  ${nav.distNm.toFixed(1)} NM  ${fmtBrg(nav.brgMag)}°${nav.eteMin !== null ? `  ETE ${Math.round(nav.eteMin)} min` : ''}`;
      g.font = `700 ${12 * dpr}px system-ui`; g.textAlign = 'left'; g.textBaseline = 'middle';
      const w = g.measureText(txt).width + 14 * dpr;
      g.fillStyle = '#000b'; g.beginPath(); g.roundRect(W - w - 8 * dpr, H - 30 * dpr, w, 22 * dpr, 6 * dpr); g.fill();
      g.fillStyle = '#ff7df5'; g.fillText(txt, W - w - 1 * dpr, H - 19 * dpr);
    }
    // aircraft
    g.save(); g.translate(X(ac.x), Z(ac.z)); g.rotate(ac.hdg * Math.PI / 180);
    g.fillStyle = '#ffdd00'; g.strokeStyle = '#000'; g.lineWidth = 1.5 * dpr;
    const k = 1.6 * dpr;
    g.beginPath(); g.moveTo(0, -8 * k); g.lineTo(6 * k, 6 * k); g.lineTo(0, 3 * k); g.lineTo(-6 * k, 6 * k); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // north arrow + scale
    this.label('N ↑', 22 * dpr, 16 * dpr, 12 * dpr, '#fff', '#0008');
    const bar = span > 30000 ? 10000 : span > 3000 ? 1000 : span > 1200 ? 200 : 100;
    g.fillStyle = '#fff'; g.fillRect(10 * dpr, H - 14 * dpr, bar * s, 3 * dpr);
    this.label(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, 10 * dpr + bar * s / 2, H - 24 * dpr, 10 * dpr, '#fff', '#0000');
  }

  private label(t: string, x: number, y: number, size: number, fg: string, bg: string) {
    const g = this.g;
    g.font = `700 ${size}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(t).width + size * 0.6;
    g.fillStyle = bg; g.beginPath(); g.roundRect(x - w / 2, y - size * 0.7, w, size * 1.4, size * 0.3); g.fill();
    g.fillStyle = fg; g.fillText(t, x, y);
  }
}

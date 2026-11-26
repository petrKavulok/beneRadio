// Analogue six-pack + engine/flap/trim gauges drawn on a 2D canvas.
export interface PanelData {
  iasKt: number; altFt: number; vsFpm: number; hdgMag: number; pitch: number; bank: number;
  turnRate: number; slip: number; rpm: number; throttle: number; flaps: number; trim: number;
  parking: boolean; brakes: boolean; running: boolean; stall: boolean; qnh: number;
  stick: { x: number; y: number; rudder: number };
  speeds: { vs0: number; vs1: number; whiteTop: number; vno: number; vne: number; vmc?: number; vyse?: number };
  rpms: number[];
  engOk: boolean[];
  gear: number | null; // null = fixed gear; else 0 (up) … 1 (down & locked)
  navBrg: number | null; // magnetic bearing to the direct-to destination
}

const TAU = Math.PI * 2, D2R = Math.PI / 180;

export class Panel {
  private g: CanvasRenderingContext2D;
  constructor(private cv: HTMLCanvasElement) { this.g = cv.getContext('2d')!; }

  draw(d: PanelData, heightFrac: number) {
    const dpr = Math.min(devicePixelRatio, 2);
    const H = Math.round(innerHeight * heightFrac), W = innerWidth;
    if (this.cv.width !== W * dpr || this.cv.height !== H * dpr) {
      this.cv.width = W * dpr; this.cv.height = H * dpr; this.cv.style.height = H + 'px';
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#2b2d31'); grad.addColorStop(1, '#17181b');
    g.fillStyle = grad;
    g.beginPath(); g.roundRect(0, 4, W, H, [18, 18, 0, 0]); g.fill();
    const r = Math.min(H * 0.42, W / 22);
    const cy = H / 2 + 4;
    const gap = r * 2.35;
    const x0 = W / 2 - gap * 2.4;
    this.asi(x0, cy, r, d.iasKt, d.speeds);
    this.ai(x0 + gap, cy, r, d.pitch, d.bank);
    this.alt(x0 + gap * 2, cy, r, d.altFt, d.qnh);
    this.tc(x0 + gap * 3, cy, r, d.turnRate, d.slip);
    this.hdg(x0 + gap * 4, cy, r, d.hdgMag, d.navBrg);
    this.vsi(x0 + gap * 5, cy, r, d.vsFpm);
    this.rpm(x0 - gap * 1.05, cy, r * 0.8, d.rpms);
    this.stick(x0 - gap * 1.95, cy, r * 0.62, d.stick);
    this.side(x0 + gap * 5.75, cy, r, d);
  }

  private bezel(x: number, y: number, r: number) {
    const g = this.g;
    g.fillStyle = '#0c0c0d'; g.beginPath(); g.arc(x, y, r * 1.08, 0, TAU); g.fill();
    g.fillStyle = '#121315'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  private ticks(x: number, y: number, r: number, a0: number, a1: number, n: number, len: number, w = 1.5) {
    const g = this.g; g.strokeStyle = '#eee'; g.lineWidth = w;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      g.beginPath(); g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.lineTo(x + Math.cos(a) * (r - len), y + Math.sin(a) * (r - len)); g.stroke();
    }
  }
  private needle(x: number, y: number, a: number, len: number, w = 3, col = '#fff') {
    const g = this.g; g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x - Math.cos(a) * len * 0.15, y - Math.sin(a) * len * 0.15); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    g.fillStyle = '#333'; g.beginPath(); g.arc(x, y, w * 1.4, 0, TAU); g.fill();
  }
  private text(t: string, x: number, y: number, size: number, col = '#eee', align: CanvasTextAlign = 'center') {
    const g = this.g; g.fillStyle = col; g.font = `600 ${size}px system-ui, sans-serif`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(t, x, y);
  }

  private asi(x: number, y: number, r: number, kt: number, sp: PanelData['speeds']) {
    this.bezel(x, y, r);
    const g = this.g;
    const max = Math.ceil((sp.vne + 25) / 10) * 10;
    const ang = (v: number) => -Math.PI / 2 + (Math.min(v, max) / max) * TAU * 0.92;
    const arc = (a: number, b: number, col: string, rr: number, w: number) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(x, y, rr, ang(a), ang(b)); g.stroke(); };
    const radial = (v: number, col: string) => { const a = ang(v); g.strokeStyle = col; g.lineWidth = r * 0.05; g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95); g.lineTo(x + Math.cos(a) * r * 0.74, y + Math.sin(a) * r * 0.74); g.stroke(); };
    arc(sp.vs0, sp.whiteTop, '#fff', r * 0.8, r * 0.06);
    arc(sp.vs1, sp.vno, '#2fbf4a', r * 0.88, r * 0.07);
    arc(sp.vno, sp.vne, '#f2c500', r * 0.88, r * 0.07);
    radial(sp.vne, '#e22');
    if (sp.vmc) radial(sp.vmc, '#e22');   // red line: minimum control speed (one engine out)
    if (sp.vyse) radial(sp.vyse, '#2f7fff'); // blue line: best single-engine rate of climb
    const step = max > 180 ? 20 : 10;
    for (let v = 0; v <= max - 10; v += step / 2) {
      const major = v % step === 0, a = ang(v); g.strokeStyle = '#eee'; g.lineWidth = major ? 2 : 1;
      g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95); g.lineTo(x + Math.cos(a) * r * (major ? 0.8 : 0.86), y + Math.sin(a) * r * (major ? 0.8 : 0.86)); g.stroke();
      if (v % (step * 2) === 0 && v >= 40) this.text(String(v), x + Math.cos(a) * r * 0.63, y + Math.sin(a) * r * 0.63, r * 0.17);
    }
    this.text('KNOTS', x, y + r * 0.35, r * 0.13, '#aaa');
    this.needle(x, y, ang(kt), r * 0.85);
  }

  private ai(x: number, y: number, r: number, pitch: number, bank: number) {
    const g = this.g;
    this.bezel(x, y, r);
    g.save(); g.beginPath(); g.arc(x, y, r * 0.96, 0, TAU); g.clip();
    g.translate(x, y); g.rotate(-bank);
    const py = (pitch / D2R) * r * 0.035;
    g.fillStyle = '#2f7fd0'; g.fillRect(-r * 2, -r * 3 + py, r * 4, r * 3);
    g.fillStyle = '#8a5a2b'; g.fillRect(-r * 2, py, r * 4, r * 3);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(-r * 2, py); g.lineTo(r * 2, py); g.stroke();
    g.lineWidth = 1.2;
    for (let p = -20; p <= 20; p += 5) {
      if (!p) continue;
      const yy = py - p * r * 0.035, w = p % 10 ? r * 0.15 : r * 0.3;
      g.beginPath(); g.moveTo(-w, yy); g.lineTo(w, yy); g.stroke();
    }
    g.restore();
    // bank scale
    g.save(); g.translate(x, y);
    for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const a = (b - 90) * D2R; g.strokeStyle = '#fff'; g.lineWidth = b % 30 ? 1.2 : 2.2;
      g.beginPath(); g.moveTo(Math.cos(a) * r * 0.96, Math.sin(a) * r * 0.96); g.lineTo(Math.cos(a) * r * (b % 30 ? 0.86 : 0.8), Math.sin(a) * r * (b % 30 ? 0.86 : 0.8)); g.stroke();
    }
    g.rotate(-bank); g.fillStyle = '#ffb000';
    g.beginPath(); g.moveTo(0, -r * 0.78); g.lineTo(-r * 0.07, -r * 0.66); g.lineTo(r * 0.07, -r * 0.66); g.fill();
    g.restore();
    // aircraft symbol
    g.strokeStyle = '#ffb000'; g.lineWidth = 3.5;
    g.beginPath(); g.moveTo(x - r * 0.55, y); g.lineTo(x - r * 0.18, y); g.lineTo(x - r * 0.08, y + r * 0.08); g.moveTo(x + r * 0.55, y); g.lineTo(x + r * 0.18, y); g.lineTo(x + r * 0.08, y + r * 0.08); g.stroke();
    g.fillStyle = '#ffb000'; g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fill();
  }

  private alt(x: number, y: number, r: number, ft: number, qnh: number) {
    this.bezel(x, y, r);
    this.ticks(x, y, r * 0.95, -Math.PI / 2, Math.PI * 1.5, 50, r * 0.06, 1);
    this.ticks(x, y, r * 0.95, -Math.PI / 2, Math.PI * 1.5, 10, r * 0.14, 2);
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * TAU; this.text(String(i), x + Math.cos(a) * r * 0.68, y + Math.sin(a) * r * 0.68, r * 0.2); }
    this.text(`${qnh} hPa`, x + r * 0.32, y + r * 0.02, r * 0.11, '#9cf');
    this.text('ALT FT', x, y + r * 0.36, r * 0.12, '#aaa');
    this.needle(x, y, -Math.PI / 2 + ((ft / 10000) % 1) * TAU, r * 0.45, 5);
    this.needle(x, y, -Math.PI / 2 + ((ft / 1000) % 1) * TAU, r * 0.85, 2.6);
  }

  private tc(x: number, y: number, r: number, rate: number, slip: number) {
    const g = this.g;
    this.bezel(x, y, r);
    this.text('L', x - r * 0.72, y + r * 0.28, r * 0.15); this.text('R', x + r * 0.72, y + r * 0.28, r * 0.15);
    this.text('2 MIN', x, y + r * 0.62, r * 0.12, '#aaa');
    for (const s of [-1, 1]) { const a = s * 20 * D2R; g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.8 * s, y + Math.sin(a) * r * 0.8); g.lineTo(x + Math.cos(a) * r * 0.95 * s, y + Math.sin(a) * r * 0.95); g.stroke(); }
    g.save(); g.translate(x, y); g.rotate(Math.max(-1.2, Math.min(1.2, (rate / 3) * 20 * D2R)));
    g.strokeStyle = '#fff'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(-r * 0.62, 0); g.lineTo(r * 0.62, 0); g.moveTo(0, 0); g.lineTo(0, -r * 0.2); g.stroke();
    g.restore();
    // inclinometer
    g.fillStyle = '#ddd'; g.beginPath(); g.roundRect(x - r * 0.45, y + r * 0.3, r * 0.9, r * 0.18, r * 0.09); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - r * 0.1, y + r * 0.3); g.lineTo(x - r * 0.1, y + r * 0.48); g.moveTo(x + r * 0.1, y + r * 0.3); g.lineTo(x + r * 0.1, y + r * 0.48); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.arc(x + Math.max(-0.36, Math.min(0.36, slip)) * r, y + r * 0.39, r * 0.075, 0, TAU); g.fill();
  }

  private hdg(x: number, y: number, r: number, hdg: number, brg: number | null = null) {
    const g = this.g;
    this.bezel(x, y, r);
    g.save(); g.translate(x, y); g.rotate(-hdg * D2R);
    for (let a = 0; a < 360; a += 5) {
      g.save(); g.rotate(a * D2R); g.strokeStyle = '#eee'; g.lineWidth = a % 10 ? 1 : 2;
      g.beginPath(); g.moveTo(0, -r * 0.95); g.lineTo(0, -r * (a % 10 ? 0.87 : 0.82)); g.stroke();
      if (a % 30 === 0) {
        const lab = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[a] ?? String(a / 10);
        g.fillStyle = a % 90 ? '#eee' : '#ffb000'; g.font = `700 ${r * 0.2}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(lab, 0, -r * 0.66);
      }
      g.restore();
    }
    g.restore();
    g.strokeStyle = '#ffb000'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(x, y - r * 0.4); g.lineTo(x, y + r * 0.35); g.moveTo(x - r * 0.25, y - r * 0.08); g.lineTo(x + r * 0.25, y - r * 0.08); g.moveTo(x - r * 0.1, y + r * 0.3); g.lineTo(x + r * 0.1, y + r * 0.3); g.stroke();
    g.fillStyle = '#ffb000'; g.beginPath(); g.moveTo(x, y - r * 0.97); g.lineTo(x - r * 0.06, y - r * 1.06); g.lineTo(x + r * 0.06, y - r * 1.06); g.fill();
    this.text(String(Math.round(hdg) % 360).padStart(3, '0'), x, y + r * 0.55, r * 0.16, '#ffb000');
    if (brg !== null) {
      // magenta bearing pointer (head = direction to the destination)
      const a = ((brg - hdg) * D2R) - Math.PI / 2;
      const cs = Math.cos(a), sn = Math.sin(a);
      g.strokeStyle = '#ff3df2'; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x - cs * r * 0.75, y - sn * r * 0.75); g.lineTo(x + cs * r * 0.62, y + sn * r * 0.62); g.stroke();
      g.fillStyle = '#ff3df2'; g.beginPath();
      g.moveTo(x + cs * r * 0.86, y + sn * r * 0.86); g.lineTo(x + cs * r * 0.6 - sn * r * 0.1, y + sn * r * 0.6 + cs * r * 0.1); g.lineTo(x + cs * r * 0.6 + sn * r * 0.1, y + sn * r * 0.6 - cs * r * 0.1); g.fill();
      this.text(String(Math.round(brg) % 360 || 360).padStart(3, '0'), x, y - r * 0.24, r * 0.13, '#ff7df5');
    }
  }

  private vsi(x: number, y: number, r: number, fpm: number) {
    this.bezel(x, y, r);
    const ang = (v: number) => Math.PI + (Math.max(-2000, Math.min(2000, v)) / 2000) * Math.PI * 0.9;
    for (let v = -2000; v <= 2000; v += 500) {
      const a = ang(v); const g = this.g; g.strokeStyle = '#eee'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95); g.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8); g.stroke();
      if (v % 1000 === 0) this.text(String(Math.abs(v / 100)), x + Math.cos(a) * r * 0.64, y + Math.sin(a) * r * 0.64, r * 0.18);
    }
    this.text('UP', x - r * 0.35, y - r * 0.3, r * 0.12, '#aaa'); this.text('DN', x - r * 0.35, y + r * 0.3, r * 0.12, '#aaa');
    this.text('FPM ×100', x + r * 0.25, y, r * 0.1, '#aaa');
    this.needle(x, y, ang(fpm), r * 0.85);
  }

  private rpm(x: number, y: number, r: number, rpms: number[]) {
    const g = this.g;
    this.bezel(x, y, r);
    const ang = (v: number) => Math.PI * 0.75 + (Math.min(v, 7000) / 7000) * Math.PI * 1.5;
    const arc = (a: number, b: number, col: string) => { g.strokeStyle = col; g.lineWidth = r * 0.1; g.beginPath(); g.arc(x, y, r * 0.86, ang(a), ang(b)); g.stroke(); };
    arc(1400, 5500, '#2fbf4a'); arc(5500, 5800, '#f2c500'); arc(5800, 5900, '#e22');
    for (let v = 0; v <= 7; v++) this.text(String(v), x + Math.cos(ang(v * 1000)) * r * 0.6, y + Math.sin(ang(v * 1000)) * r * 0.6, r * 0.2);
    this.text('RPM ×1000', x, y + r * 0.45, r * 0.12, '#aaa');
    if (rpms.length > 1) {
      this.needle(x, y, ang(rpms[0]), r * 0.85, 3, '#fff'); this.needle(x, y, ang(rpms[1]), r * 0.7, 3, '#ffb000');
      this.text('L', x - r * 0.25, y + r * 0.72, r * 0.16, '#fff'); this.text('R', x + r * 0.25, y + r * 0.72, r * 0.16, '#ffb000');
    } else this.needle(x, y, ang(rpms[0] ?? 0), r * 0.85);
  }

  /** Control position indicator: stick (box) and rudder (bar). */
  private stick(x: number, y: number, r: number, s: PanelData['stick']) {
    const g = this.g;
    g.fillStyle = '#121315'; g.strokeStyle = '#555'; g.lineWidth = 1;
    g.beginPath(); g.roundRect(x - r, y - r * 1.05, r * 2, r * 2, 4); g.fill(); g.stroke();
    g.strokeStyle = '#333'; g.beginPath(); g.moveTo(x - r, y - r * 0.05); g.lineTo(x + r, y - r * 0.05); g.moveTo(x, y - r * 1.05); g.lineTo(x, y + r * 0.95); g.stroke();
    g.fillStyle = '#36d16a'; g.beginPath(); g.arc(x + s.x * r * 0.85, y - r * 0.05 + s.y * r * 0.85, Math.max(3, r * 0.13), 0, TAU); g.fill();
    g.fillStyle = '#333'; g.fillRect(x - r, y + r * 1.12, r * 2, r * 0.18);
    g.fillStyle = '#ffb000'; g.fillRect(x + s.rudder * r * 0.9 - 2, y + r * 1.08, 4, r * 0.26);
    this.text('STICK', x, y - r * 1.25, r * 0.22, '#aaa');
  }

  private side(x: number, y: number, r: number, d: PanelData) {
    const g = this.g;
    const lamp = (t: string, on: boolean, col: string, yy: number) => {
      g.fillStyle = on ? col : '#2a2b2e'; g.beginPath(); g.roundRect(x - r * 0.1, yy - r * 0.13, r * 1.15, r * 0.26, 4); g.fill();
      this.text(t, x + r * 0.47, yy, r * 0.14, on ? '#111' : '#666');
    };
    lamp('STALL', d.stall, '#ff4040', y - r * 0.75);
    lamp('PARK BRK', d.parking, '#ffb000', y - r * 0.42);
    lamp('BRAKES', d.brakes, '#ffb000', y - r * 0.09);
    if (d.engOk.length > 1) {
      const half = (t: string, ok: boolean, xx: number) => { g.fillStyle = ok ? '#36d16a' : '#ff6a3a'; g.beginPath(); g.roundRect(xx, y + r * 0.11, r * 0.55, r * 0.26, 4); g.fill(); this.text(t, xx + r * 0.275, y + r * 0.24, r * 0.13, '#111'); };
      half(d.engOk[0] ? 'L ENG' : 'L OFF', d.engOk[0], x - r * 0.1); half(d.engOk[1] ? 'R ENG' : 'R OFF', d.engOk[1], x + r * 0.5);
    } else lamp(d.running ? 'ENGINE' : 'ENG OFF', true, d.running ? '#36d16a' : '#ff6a3a', y + r * 0.24);
    if (d.gear !== null) {
      // three gear lights: green = down & locked, red = in transit, off = up
      const col = d.gear > 0.98 ? '#36d16a' : d.gear > 0.02 ? '#ff4040' : '#2a2b2e';
      this.text('GEAR', x + r * 0.47, y + r * 0.55, r * 0.12, '#aaa');
      for (const [dx, dy] of [[0, 0], [-0.22, 0.24], [0.22, 0.24]]) { g.fillStyle = col; g.beginPath(); g.arc(x + r * (0.47 + dx), y + r * (0.72 + dy), r * 0.08, 0, TAU); g.fill(); }
    }
    // flaps / trim / throttle bars
    const bx = x + r * 1.35;
    this.text('FLAP', bx, y - r * 0.85, r * 0.12, '#aaa');
    this.text(['UP', 'T/O', 'LDG'][d.flaps], bx, y - r * 0.62, r * 0.16, '#fff');
    this.text('TRIM', bx, y - r * 0.32, r * 0.12, '#aaa');
    g.fillStyle = '#333'; g.fillRect(bx - 3, y - r * 0.2, 6, r * 0.5);
    g.fillStyle = '#ffb000'; g.fillRect(bx - 9, y + r * 0.05 - d.trim * r * 0.25 - 2, 18, 4);
    this.text('THR', bx, y + r * 0.5, r * 0.12, '#aaa');
    g.fillStyle = '#333'; g.fillRect(bx - r * 0.35, y + r * 0.65, r * 0.7, 8);
    g.fillStyle = '#36d16a'; g.fillRect(bx - r * 0.35, y + r * 0.65, r * 0.7 * d.throttle, 8);
  }
}

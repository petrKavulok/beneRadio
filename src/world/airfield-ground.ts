// Painted ground for an aerodrome (replaces the aerial photo inside the boundary, so parked
// aircraft/vehicles from the photo don't show). Grass fields: mown strips, worn tracks.
// Paved fields: asphalt/concrete with ICAO-style markings. Drawn in world metres, blended softly.
import * as THREE from 'three';
import type { Airport, P2, Runway } from '../airport/types';
import { isPaved, rwyLength } from '../airport/types';
import type { Bld } from './buildings';

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const css = (c: number[], a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
type Photo = { img: CanvasImageSource; x0: number; z0: number; x1: number; z1: number };

function sampleGrass(photo: Photo | undefined, spots: P2[]) {
  const fallback = [104, 124, 74];
  if (!photo) return fallback;
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(photo.img, 0, 0, 512, 512);
  const acc = [0, 0, 0]; let n = 0;
  for (const [x, z] of spots) {
    const px = ((x - photo.x0) / (photo.x1 - photo.x0)) * 512, py = ((z - photo.z0) / (photo.z1 - photo.z0)) * 512;
    if (px < 4 || py < 4 || px > 508 || py > 508) continue;
    const d = g.getImageData(Math.round(px) - 3, Math.round(py) - 3, 7, 7).data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (gg > r && gg > b && gg - b > 10) { acc[0] += r; acc[1] += gg; acc[2] += b; n++; } // grass-like pixels only
    }
  }
  return n > 20 ? acc.map((v) => v / n) : fallback;
}

const polyline = (g: CanvasRenderingContext2D, pts: P2[]) => { g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z))); };
function frame(r: Runway) { const L = rwyLength(r), ux = (r.end[0] - r.thr[0]) / L, uz = (r.end[1] - r.thr[1]) / L; return { L, ux, uz, nx: -uz, nz: ux }; }
function rwRect(g: CanvasRenderingContext2D, a: P2, b: P2, width: number) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz * width / 2, nz = ux * width / 2;
  g.beginPath(); g.moveTo(a[0] + nx, a[1] + nz); g.lineTo(b[0] + nx, b[1] + nz); g.lineTo(b[0] - nx, b[1] - nz); g.lineTo(a[0] - nx, a[1] - nz); g.closePath();
}
/** filled rectangle in runway coordinates (s along, t across), from threshold r.thr */
function rrect(g: CanvasRenderingContext2D, r: Runway, s0: number, s1: number, t0: number, t1: number) {
  const f = frame(r), P = (s: number, t: number): P2 => [r.thr[0] + f.ux * s + f.nx * t, r.thr[1] + f.uz * s + f.nz * t];
  const a = P(s0, t0), b = P(s1, t0), c = P(s1, t1), d = P(s0, t1);
  g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.lineTo(...c); g.lineTo(...d); g.closePath(); g.fill();
}

function blotches(g: CanvasRenderingContext2D, box: Airport['groundBox'], cell: number, cols: number[][], alpha: number, seed: number) {
  const R = rng(seed);
  const w = Math.ceil((box.x1 - box.x0) / cell) + 2, h = Math.ceil((box.z1 - box.z0) / cell) + 2;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cg = c.getContext('2d')!;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { cg.fillStyle = css(cols[Math.floor(R() * cols.length)], alpha * (0.3 + 0.7 * R())); cg.fillRect(x, y, 1, 1); }
  g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(c, box.x0 - cell, box.z0 - cell, w * cell, h * cell);
  g.restore();
}

/** Runway designator text, upright for an aircraft landing on it. */
function designator(g: CanvasRenderingContext2D, r: Runway, at: number) {
  const f = frame(r);
  const [x, z] = [r.thr[0] + f.ux * at, r.thr[1] + f.uz * at];
  g.save();
  g.translate(x, z);
  g.rotate(Math.atan2(f.uz, f.ux) + Math.PI / 2); // text "up" points along the landing direction
  const m = r.id.match(/^(\d+)([LRC]?)$/);
  g.fillStyle = 'rgba(240,240,236,0.92)'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${Math.min(18, r.width * 0.42)}px "Arial Narrow", Arial, sans-serif`;
  if (m) {
    g.save(); g.scale(1, 1.55);
    g.fillText(m[1], 0, 0);
    if (m[2]) g.fillText(m[2], 0, Math.min(18, r.width * 0.42) * 0.9);
    g.restore();
  }
  g.restore();
}

export function paintAirportGround(ap: Airport, blds: Bld[], photo?: Photo) {
  const box = ap.groundBox;
  const W0 = box.x1 - box.x0, H0 = box.z1 - box.z0;
  const RES = Math.max(0.5, Math.max(W0, H0) / 4096); // m per px, capped canvas size
  const W = Math.round(W0 / RES), H = Math.round(H0 / RES);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.setTransform(1 / RES, 0, 0, 1 / RES, -box.x0 / RES, -box.z0 / RES); // draw in world metres

  // grass sampled from the photo between runways
  const spots: P2[] = [];
  for (const r of ap.runways) { const f = frame(r); for (const k of [0.2, 0.5, 0.8]) for (const s of [-1, 1]) spots.push([r.thr[0] + f.ux * f.L * k + f.nx * s * (r.strip * 0.4 + 15), r.thr[1] + f.uz * f.L * k + f.nz * s * (r.strip * 0.4 + 15)]); }
  const base = sampleGrass(photo, spots);
  const light = mix(base, [150, 160, 95], 0.35), dark = mix(base, [55, 75, 40], 0.4), dry = mix(base, [165, 150, 100], 0.45);
  g.fillStyle = css(base); g.fillRect(box.x0, box.z0, W0, H0);
  blotches(g, box, 40, [light, dark, dry], 0.35, 1);
  blotches(g, box, 12, [light, dark], 0.25, 2);
  if (RES <= 1) blotches(g, box, 4, [light, dark, dry], 0.18, 3);

  const once = ap.runways.filter((r) => r.id <= r.pair.split('/')[1]);
  // mown runway strips
  for (const r of once) {
    const f = frame(r);
    g.save();
    rwRect(g, r.thr, r.end, Math.min(r.strip, isPaved(r.surface) ? 150 : r.strip) * 0.9);
    g.fillStyle = css(mix(base, [130, 150, 85], 0.25), 0.5); g.fill(); g.clip();
    const half = r.strip / 2;
    for (let k = -half, i = 0; k < half; k += 6, i++) {
      const a: P2 = [r.thr[0] + f.nx * (k + 3) - f.ux * 60, r.thr[1] + f.nz * (k + 3) - f.uz * 60];
      g.strokeStyle = i % 2 ? css(light, 0.2) : css(dark, 0.12); g.lineWidth = 6;
      polyline(g, [a, [a[0] + f.ux * (f.L + 120), a[1] + f.uz * (f.L + 120)]]); g.stroke();
    }
    g.restore();
  }
  // aprons
  for (const a of ap.aprons) { polyline(g, a.pts); g.closePath(); g.fillStyle = a.paved ? '#a3a4a0' : css(dry, 0.5); g.fill(); }
  // taxiways
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const t of ap.taxiways) {
    polyline(g, t.pts);
    if (t.paved) { g.strokeStyle = '#6e7072'; g.lineWidth = (t.width ?? 18) + 3; g.stroke(); polyline(g, t.pts); g.strokeStyle = '#5d5f61'; g.lineWidth = t.width ?? 18; g.stroke(); }
    else { g.strokeStyle = css(mix(base, [150, 160, 105], 0.35), 0.6); g.lineWidth = t.width ?? 11; g.stroke(); polyline(g, t.pts); g.strokeStyle = css([150, 132, 98], 0.3); g.lineWidth = 2.2; g.stroke(); }
  }
  // runways
  for (const r of once) {
    const f = frame(r);
    if (isPaved(r.surface)) {
      rwRect(g, r.thr, r.end, r.width + 1.5); g.fillStyle = r.surface.includes('concrete') ? '#8e8f8c' : '#4f5153'; g.fill();
      // tyre rubber near touchdown zones
      for (const [s0, s1] of [[150, 900], [f.L - 900, f.L - 150]]) { g.fillStyle = 'rgba(35,35,35,0.28)'; rrect(g, r, s0, s1, -r.width * 0.22, r.width * 0.22); }
      g.fillStyle = 'rgba(244,244,240,0.95)';
      // edge lines
      rrect(g, r, 0, f.L, r.width / 2 - 1.8, r.width / 2 - 0.9); rrect(g, r, 0, f.L, -r.width / 2 + 0.9, -r.width / 2 + 1.8);
      // centre line dashes 30 m / 20 m gap
      for (let s = 120; s < f.L - 120; s += 50) rrect(g, r, s, s + 30, -0.45, 0.45);
      // both ends: piano keys, designator, aiming point, touchdown zone bars
      for (const d of ap.runways.filter((q) => q.pair === r.pair)) {
        const keys = r.width >= 45 ? 12 : r.width >= 30 ? 8 : 6, kw = 1.8, span = r.width - 6;
        for (let i = 0; i < keys; i++) {
          const t = -span / 2 + (i + 0.5) * (span / keys);
          g.fillStyle = 'rgba(244,244,240,0.95)'; rrect(g, d, 6, 36, t - kw / 2, t + kw / 2);
        }
        designator(g, d, 60);
        if (f.L > 1200) {
          rrect(g, d, 400, 445, -r.width * 0.3, -r.width * 0.3 + 6); rrect(g, d, 400, 445, r.width * 0.3 - 6, r.width * 0.3);
          for (const s of [150, 300, 600, 750]) for (const sg of [-1, 1]) for (let k = 0; k < (s < 450 ? 3 : 2); k++) rrect(g, d, s, s + 22, sg * (4 + k * 3), sg * (4 + k * 3 + 1.8));
        }
      }
    } else {
      const reinforced = r.surface.includes('reinforced');
      rwRect(g, r.thr, r.end, r.width);
      g.fillStyle = css(reinforced ? mix(dry, [175, 170, 130], 0.3) : mix(base, [160, 175, 110], 0.4), reinforced ? 0.75 : 0.6); g.fill();
      for (const off of [-1.6, 0, 1.6]) {
        g.strokeStyle = css([150, 130, 95], reinforced ? 0.35 : 0.18); g.lineWidth = off ? 0.8 : 1.4;
        polyline(g, [[r.thr[0] + f.nx * off + f.ux * 30, r.thr[1] + f.nz * off + f.uz * 30], [r.end[0] + f.nx * off - f.ux * 30, r.end[1] + f.nz * off - f.uz * 30]]); g.stroke();
      }
      g.strokeStyle = css(dark, 0.18); g.lineWidth = 0.6; rwRect(g, r.thr, r.end, r.width); g.stroke();
    }
  }
  // paved taxiway centre lines (yellow) on top
  for (const t of ap.taxiways) if (t.paved) { polyline(g, t.pts); g.strokeStyle = 'rgba(232,190,40,0.9)'; g.lineWidth = Math.max(0.3, RES * 0.8); g.stroke(); }
  // grass parking at fields without paved aprons
  if (!ap.aprons.length) { polyline(g, ap.parking); g.closePath(); g.fillStyle = css(dry, 0.45); g.fill(); }
  // roads
  for (const r of ap.roads) {
    const paved = r.s === 'asphalt' || ['tertiary', 'secondary', 'primary', 'residential', 'unclassified', 'trunk', 'motorway'].includes(r.t);
    const width = ({ motorway: 14, trunk: 10, primary: 8, secondary: 7, tertiary: 6.5, service: 4, residential: 5 } as Record<string, number>)[r.t] ?? 3;
    polyline(g, r.pts); g.strokeStyle = paved ? '#5b5d60' : r.s === 'grass' ? css(mix(base, [150, 140, 100], 0.3), 0.7) : '#9c8a6c'; g.lineWidth = width; g.stroke();
  }
  // concrete pads under buildings
  g.fillStyle = '#8c8d8a'; g.strokeStyle = '#8c8d8a'; g.lineWidth = 2.5;
  for (const b of blds) {
    const p = b.p;
    if (p[0] < box.x0 || p[0] > box.x1 || p[1] < box.z0 || p[1] > box.z1) continue;
    g.beginPath(); for (let i = 0; i < p.length; i += 2) (i ? g.lineTo(p[i], p[i + 1]) : g.moveTo(p[i], p[i + 1])); g.closePath(); g.fill(); g.stroke();
  }

  // fine grain + alpha mask (aerodrome boundary, feathered)
  g.setTransform(1, 0, 0, 1, 0, 0);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const R = rng(9);
  for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 12; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.7; }
  const m = document.createElement('canvas'); m.width = W; m.height = H;
  const mg = m.getContext('2d', { willReadFrequently: true })!;
  mg.setTransform(1 / RES, 0, 0, 1 / RES, -box.x0 / RES, -box.z0 / RES);
  mg.filter = `blur(${8 / RES}px)`;
  mg.fillStyle = '#fff';
  const boundary = ap.boundary.length > 3 ? ap.boundary : [[box.x0 + 60, box.z0 + 60], [box.x1 - 60, box.z0 + 60], [box.x1 - 60, box.z1 - 60], [box.x0 + 60, box.z1 - 60]] as P2[];
  polyline(mg, boundary); mg.closePath(); mg.fill();
  const md = mg.getImageData(0, 0, W, H).data;
  for (let i = 0; i < d.length; i += 4) d[i + 3] = md[i];
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { canvas: c, texture: tex, box };
}

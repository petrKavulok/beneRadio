// 3D airfield furniture: runway lights/markers, TWY C lights, holding point signs, windsocks.
import * as THREE from 'three';
import { GeoData } from '../world/data';
import type { Airport, P2 } from './types';

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: THREE.Matrix4[]) {
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((mx, i) => m.setMatrixAt(i, mx));
  m.castShadow = true;
  return m;
}
const at = (geo: GeoData, x: number, z: number, dy = 0, rotY = 0) =>
  new THREE.Matrix4().makeRotationY(rotY).setPosition(x, geo.heightAt(x, z) + dy, z);

function signTexture(lines: { text: string; bg: string; fg: string }[]) {
  const c = document.createElement('canvas');
  c.width = 128 * lines.length; c.height = 128;
  const g = c.getContext('2d')!;
  lines.forEach((l, i) => {
    g.fillStyle = l.bg; g.fillRect(i * 128, 0, 128, 128);
    g.fillStyle = l.fg; g.font = `bold ${l.text.length > 3 ? 42 : 72}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(l.text, i * 128 + 64, 68);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Thin ribbon draped on the terrain (holding position markings). */
function drapedStrip(geo: GeoData, a: P2, b: P2, width: number, color: number, dashed = false) {
  const g = new THREE.Group();
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  const nx = -dz / L * width / 2, nz = dx / L * width / 2;
  const segs = Math.max(2, Math.ceil(L / 1.5));
  const pos: number[] = [];
  for (let i = 0; i < segs; i++) {
    if (dashed && i % 2) continue;
    const t0 = i / segs, t1 = (i + 1) / segs;
    const p = (t: number, s: number) => {
      const x = a[0] + dx * t + nx * s, z = a[1] + dz * t + nz * s;
      return [x, geo.heightAt(x, z) + 0.06, z];
    };
    pos.push(...p(t0, -1), ...p(t1, -1), ...p(t1, 1), ...p(t0, -1), ...p(t1, 1), ...p(t0, 1));
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bg.computeVertexNormals();
  g.add(new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })));
  return g;
}

export function buildAirfield(geo: GeoData, ap: Airport) {
  const RUNWAYS = ap.runways, TAXIWAYS = ap.taxiways, WINDSOCKS = ap.windsocks;
  const HOLDING_POINTS = ap.holds.filter((h) => Object.values(ap.hpFor).includes(h.id));
  const group = new THREE.Group();
  group.name = 'airfield-' + ap.icao;
  const post = new THREE.CylinderGeometry(0.06, 0.06, 0.4, 6).translate(0, 0.2, 0);
  const lamp = new THREE.SphereGeometry(0.13, 8, 6).translate(0, 0.45, 0);
  const lights: Record<string, THREE.Matrix4[]> = { white: [], green: [], red: [], blue: [], post: [] };
  const boards: THREE.Matrix4[] = [];

  for (const r of RUNWAYS) {
    if (r.id > r.pair.split('/')[1]) continue; // each physical runway once
    const [ax, az] = r.thr, [bx, bz] = r.end;
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;
    const hw = r.width / 2 + 1.5;
    const yaw = Math.atan2(ux, uz);
    if (r.lit) {
      const n = Math.round(L / 60);
      for (let i = 0; i <= n; i++) for (const s of [-1, 1]) {
        const x = ax + ux * L * i / n + nx * hw * s, z = az + uz * L * i / n + nz * hw * s;
        lights.white.push(at(geo, x, z)); lights.post.push(at(geo, x, z));
      }
      // Threshold/end bars: alternating green (threshold) and red (end) lamps at both ends.
      for (const [px, pz] of [[ax - ux * 2, az - uz * 2], [bx + ux * 2, bz + uz * 2]]) {
        for (let k = -3; k <= 3; k++) {
          const x = px + nx * k * (hw / 3.2), z = pz + nz * k * (hw / 3.2);
          lights[k % 2 === 0 ? 'green' : 'red'].push(at(geo, x, z)); lights.post.push(at(geo, x, z));
        }
      }
    } else {
      const n = Math.round(L / 75);
      for (let i = 0; i <= n; i++) for (const s of [-1, 1]) {
        const x = ax + ux * L * i / n + nx * (r.strip / 2 - 2) * s, z = az + uz * L * i / n + nz * (r.strip / 2 - 2) * s;
        boards.push(at(geo, x, z, 0, yaw));
      }
    }
  }
  // TWY C edge lights (blue) every ~30 m.
  for (const t of TAXIWAYS.filter((t) => t.lit)) {
    for (let i = 0; i < t.pts.length - 1; i++) {
      const [ax, az] = t.pts[i], [bx, bz] = t.pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 30));
      const nx = -(bz - az) / L * 7, nz = (bx - ax) / L * 7;
      for (let k = 0; k < n; k++) for (const s of [-1, 1]) {
        const x = ax + (bx - ax) * k / n + nx * s, z = az + (bz - az) * k / n + nz * s;
        lights.blue.push(at(geo, x, z)); lights.post.push(at(geo, x, z));
      }
    }
  }
  const lm = (c: number) => new THREE.MeshBasicMaterial({ color: c });
  group.add(instanced(post, new THREE.MeshLambertMaterial({ color: 0x222222 }), lights.post));
  group.add(instanced(lamp, lm(0xfff8e0), lights.white));
  group.add(instanced(lamp, lm(0x2bff5a), lights.green));
  group.add(instanced(lamp, lm(0xff3030), lights.red));
  group.add(instanced(lamp, lm(0x3a6bff), lights.blue));
  // White/orange boundary boards for the grass 09/27 strip.
  const board = new THREE.BoxGeometry(1.6, 0.5, 0.12).translate(0, 0.25, 0);
  group.add(instanced(board, new THREE.MeshLambertMaterial({ color: 0xff7a1a }), boards));

  // Holding points: draped yellow markings + red/yellow sign.
  for (const hp of HOLDING_POINTS) {
    const [x, z] = hp.pos, [fx, fz] = hp.facing;
    const L = Math.hypot(fx - x, fz - z), ux = (fx - x) / L, uz = (fz - z) / L, nx = -uz, nz = ux;
    const w = 7;
    group.add(drapedStrip(geo, [x - nx * w, z - nz * w], [x + nx * w, z + nz * w], 0.3, 0xf2c500));
    group.add(drapedStrip(geo, [x - nx * w + ux * 0.6, z - nz * w + uz * 0.6], [x + nx * w + ux * 0.6, z + nz * w + uz * 0.6], 0.3, 0xf2c500));
    group.add(drapedStrip(geo, [x - nx * w + ux * 1.5, z - nz * w + uz * 1.5], [x + nx * w + ux * 1.5, z + nz * w + uz * 1.5], 0.3, 0xf2c500, true));
    group.add(drapedStrip(geo, [x - nx * w + ux * 2.1, z - nz * w + uz * 2.1], [x + nx * w + ux * 2.1, z + nz * w + uz * 2.1], 0.3, 0xf2c500, true));
    const rwText = [...new Set(hp.runways.map((r) => r.replace(/[LR]/, '')))].join('-');
    const tex = signTexture([{ text: hp.on, bg: '#111', fg: '#ffd400' }, { text: rwText, bg: '#c4161c', fg: '#fff' }]);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 0.12), [
      new THREE.MeshLambertMaterial({ color: 0x333333 }), new THREE.MeshLambertMaterial({ color: 0x333333 }),
      new THREE.MeshLambertMaterial({ color: 0x333333 }), new THREE.MeshLambertMaterial({ color: 0x333333 }),
      new THREE.MeshBasicMaterial({ map: tex }), new THREE.MeshBasicMaterial({ map: tex }),
    ]);
    // Sign on the left of the taxiway as seen by the holding aircraft, facing it.
    const sx = x - nx * (w + 3) - ux * 1, sz = z - nz * (w + 3) - uz * 1;
    sign.position.set(sx, geo.heightAt(sx, sz) + 0.9, sz);
    sign.rotation.y = Math.atan2(-ux, -uz);
    sign.castShadow = true;
    group.add(sign);
  }

  // Windsocks.
  const socks: THREE.Object3D[] = [];
  for (const [x, z] of WINDSOCKS) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6, 8).translate(0, 3, 0), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    pole.position.set(x, geo.heightAt(x, z), z);
    const pivot = new THREE.Object3D();
    pivot.position.y = 5.9;
    const sockGeo = new THREE.CylinderGeometry(0.22, 0.4, 3, 12, 5, true).rotateX(Math.PI / 2).translate(0, 0, 1.5);
    const cols: number[] = [];
    const pos = sockGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const band = Math.floor(pos.getZ(i) / 0.6001) % 2; cols.push(1, band ? 1 : 0.35, band ? 1 : 0.05); }
    sockGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const sock = new THREE.Mesh(sockGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    sock.castShadow = true;
    pivot.add(sock);
    pole.add(pivot);
    group.add(pole);
    socks.push(pivot);
  }
  /** windFrom: degrees true wind comes FROM; speed in kt. */
  function updateWindsocks(windFromDeg: number, kt: number, t: number) {
    for (const p of socks) {
      const to = (windFromDeg + 180) * Math.PI / 180 + Math.sin(t * 1.3) * 0.05;
      p.rotation.set(0, 0, 0);
      p.rotation.y = Math.atan2(Math.sin(to), -Math.cos(to));
      p.rotateX((1 - Math.min(kt / 15, 1)) * 1.2 + Math.sin(t * 3.1) * 0.03);
    }
  }
  return { group, updateWindsocks };
}

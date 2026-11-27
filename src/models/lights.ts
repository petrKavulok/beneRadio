// Exterior lights for the player's aircraft: red / green nav lights, white tail light, wingtip strobes,
// red beacon on the fin and a landing light in the nose. Positions are found from the model geometry,
// so the same code fits the P2002 (both models) and the P2006T.
import * as THREE from 'three';

let glowTex: THREE.Texture | null = null;
function glow() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, '#fff'); r.addColorStop(0.18, '#fffe'); r.addColorStop(0.4, '#fff5'); r.addColorStop(1, '#fff0');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** A light = small solid core (readable in daylight) + additive halo. */
function lamp(color: number, core: number, halo: number) {
  const g = new THREE.Group();
  const mk = (size: number, additive: boolean, opacity: number) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, transparent: true, opacity, depthWrite: false, toneMapped: false, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    s.scale.setScalar(size); s.renderOrder = 5; g.add(s); return s;
  };
  mk(core, false, 1); mk(halo, true, 0.7);
  return g;
}

interface Pts { left: THREE.Vector3; right: THREE.Vector3; finTop: THREE.Vector3; tail: THREE.Vector3; nose: THREE.Vector3 }

/** Extreme points of the exterior skin in the root's frame (forward −z, right +x, up +y). */
function findPoints(root: THREE.Object3D): Pts {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const v = new THREE.Vector3();
  const P = { left: new THREE.Vector3(Infinity), right: new THREE.Vector3(-Infinity), finTop: new THREE.Vector3(0, -Infinity), tail: new THREE.Vector3(0, 0, -Infinity), nose: new THREE.Vector3(0, 0, Infinity) };
  const meshes: [THREE.BufferAttribute, THREE.Matrix4][] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || /prop|helice|bol|disc|blur|spinner|vitre|glass/i.test(mesh.name)) return;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (pos) meshes.push([pos, new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld)]);
  });
  const each = (f: (v: THREE.Vector3) => void) => { for (const [pos, mm] of meshes) for (let i = 0; i < pos.count; i++) f(v.fromBufferAttribute(pos, i).applyMatrix4(mm)); };
  each((v) => {
    if (v.x < P.left.x) P.left.copy(v);
    if (v.x > P.right.x) P.right.copy(v);
    if (v.y > P.finTop.y && Math.abs(v.x) < 0.3) P.finTop.copy(v);
    if (v.z > P.tail.z && Math.abs(v.x) < 0.2) P.tail.copy(v);
    if (v.z < P.nose.z && Math.abs(v.x) < 0.3) P.nose.copy(v);
  });
  // nav lights sit at the leading edge of the wingtip: most forward vertex within 4 cm of the outermost one
  const xl = P.left.x, xr = P.right.x;
  each((v) => {
    if (v.x < xl + 0.04 && v.z < P.left.z) P.left.copy(v);
    if (v.x > xr - 0.04 && v.z < P.right.z) P.right.copy(v);
  });
  return P;
}

export interface LightState { running: boolean; onGround: boolean; gsKt: number; aglFt: number }
export interface AircraftLights { update(dt: number, s: LightState): void; dispose(): void }

export function addAircraftLights(root: THREE.Object3D): AircraftLights {
  const P = findPoints(root);
  const grp = new THREE.Group(); grp.name = 'extLights';
  const at = (o: THREE.Object3D, p: THREE.Vector3, dx = 0, dy = 0, dz = 0) => { o.position.set(p.x + dx, p.y + dy, p.z + dz); grp.add(o); return o; };
  // nav: red left, green right, white tail
  at(lamp(0xff2a2a, 0.16, 0.55), P.left, 0.02);
  at(lamp(0x2aff6a, 0.16, 0.55), P.right, -0.02);
  at(lamp(0xffffff, 0.13, 0.45), P.tail, 0, 0, 0.03);
  // strobes (white, wingtips) and beacon (red, fin top)
  const strobes = [at(lamp(0xffffff, 0.3, 1.6), P.left, 0.02, 0, 0.14), at(lamp(0xffffff, 0.3, 1.6), P.right, -0.02, 0, 0.14)];
  const beacon = at(lamp(0xff3020, 0.2, 0.9), P.finTop, 0, 0.05);
  // landing light: lamp in the lower nose + a spotlight that lights the ground ahead
  const llPos = new THREE.Vector3(P.nose.x, P.nose.y - 0.15, P.nose.z + 0.35);
  const ll = at(lamp(0xfff4dc, 0.22, 1.2), llPos);
  const spot = new THREE.SpotLight(0xfff1d6, 0, 300, THREE.MathUtils.degToRad(13), 0.45, 2);
  spot.position.copy(llPos);
  spot.target.position.set(llPos.x, llPos.y - 2.2, llPos.z - 30); // ~4° down
  grp.add(spot, spot.target);
  root.add(grp);

  let t = 0;
  return {
    update(dt, s) {
      t += dt;
      // beacon on with the engine running; strobes on the runway / in the air; landing light for take-off, approach and landing
      const moving = s.gsKt > 25 || !s.onGround;
      const beaconOn = s.running && (t % 1.2) < 0.12;
      beacon.visible = beaconOn;
      const ph = t % 1.1;
      const strobeOn = s.running && moving && (ph < 0.05 || (ph > 0.16 && ph < 0.21));
      for (const st of strobes) st.visible = strobeOn;
      const landing = s.running && (s.onGround ? s.gsKt > 3 : s.aglFt < 1500);
      ll.visible = landing;
      spot.intensity = landing ? 320 : 0;
    },
    dispose() { root.remove(grp); spot.dispose(); },
  };
}

import { LOW_MEM } from '../quality';
// Sky dome, sun, haze – with time-of-day presets.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export type TimeOfDay = 'day' | 'evening';
export const TIME_OPTIONS: { id: TimeOfDay; label: string }[] = [
  { id: 'day', label: '☀️ Midday' },
  { id: 'evening', label: '🌇 Summer evening' },
];

interface Preset {
  /** sun elevation / compass azimuth (deg, true) */
  elev: number; azim: number;
  turbidity: number; rayleigh: number; mie: number; mieG: number;
  fog: number; fogDensity: number;
  hemiSky: number; hemiGround: number; hemi: number;
  sun: number; sunI: number;
  exposure: number;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  day: {
    elev: 38, azim: 220, turbidity: 6, rayleigh: 1.6, mie: 0.004, mieG: 0.8,
    fog: 0xb4c6d8, fogDensity: 0.0001, hemiSky: 0xcfe3ff, hemiGround: 0x55603f, hemi: 1.25, sun: 0xfff2dd, sunI: 2.1, exposure: 0.9,
  },
  // late June around 20:30 CEST at Benešov: sun low in the WNW, golden light, warm haze, long shadows
  evening: {
    elev: 5, azim: 292, turbidity: 4, rayleigh: 2.4, mie: 0.009, mieG: 0.92,
    fog: 0xe3a676, fogDensity: 0.00015, hemiSky: 0xbdb3c4, hemiGround: 0x5b4a35, hemi: 1.1, sun: 0xffb36b, sunI: 2.3, exposure: 0.78,
  },
};

export function buildEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const sky = new Sky();
  sky.scale.setScalar(60000);
  const u = sky.material.uniforms;
  scene.add(sky);

  const fog = new THREE.FogExp2(0xb4c6d8, 0.0001);
  scene.fog = fog;

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x55603f, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(LOW_MEM ? 1024 : 2048);
  const s = sun.shadow.camera as THREE.OrthographicCamera;
  s.left = -60; s.right = 60; s.top = 60; s.bottom = -60; s.near = 1; s.far = 1500;
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3();
  let time: TimeOfDay = 'day';

  function setTime(t: TimeOfDay) {
    const p = PRESETS[t] ?? PRESETS.day;
    time = t;
    // compass azimuth A (from north, clockwise) → three.js spherical θ with +x east, +z south: θ = 180° − A
    sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - p.elev), THREE.MathUtils.degToRad(180 - p.azim));
    u.sunPosition.value.copy(sunDir);
    u.turbidity.value = p.turbidity; u.rayleigh.value = p.rayleigh;
    u.mieCoefficient.value = p.mie; u.mieDirectionalG.value = p.mieG;
    fog.color.setHex(p.fog); fog.density = p.fogDensity;
    hemi.color.setHex(p.hemiSky); hemi.groundColor.setHex(p.hemiGround); hemi.intensity = p.hemi;
    sun.color.setHex(p.sun); sun.intensity = p.sunI;
    // grazing light needs more bias against shadow acne
    sun.shadow.bias = p.elev < 15 ? -0.0008 : -0.0004;
    sun.shadow.normalBias = p.elev < 15 ? 0.04 : 0;
    renderer.toneMappingExposure = p.exposure;
    follow(sun.target.position);
  }

  /** Keep the shadow frustum centred on the focus point (the aircraft). */
  function follow(p: THREE.Vector3) {
    sun.target.position.copy(p);
    sun.position.copy(p).addScaledVector(sunDir, 500);
  }

  setTime((localStorage.getItem('lkbe.time') as TimeOfDay) || 'day');
  return { sun, sunDir, follow, sky, setTime, get time() { return time; } };
}

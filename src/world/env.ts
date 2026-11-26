// Sky dome, sun, haze.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export function buildEnvironment(scene: THREE.Scene) {
  const sky = new Sky();
  sky.scale.setScalar(60000);
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  const elev = THREE.MathUtils.degToRad(38), azim = THREE.MathUtils.degToRad(320);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elev, azim);
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  scene.fog = new THREE.FogExp2(0xb4c6d8, 0.0001);

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x55603f, 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.1);
  sun.position.copy(sunDir).multiplyScalar(500);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera as THREE.OrthographicCamera;
  s.left = -60; s.right = 60; s.top = 60; s.bottom = -60; s.near = 1; s.far = 1500;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  /** Keep the shadow frustum centred on the focus point (the aircraft). */
  function follow(p: THREE.Vector3) {
    sun.target.position.copy(p);
    sun.position.copy(p).addScaledVector(sunDir, 500);
  }
  return { sun, sunDir, follow, sky };
}

// Drop the CPU copy of a mesh's vertex data once it is on the GPU. three.js keeps every BufferAttribute's
// array after upload; for the baked terrain and buildings that is ~400 MB of RAM nobody reads again
// (physics uses the DEM grids, not the meshes). Bounds are computed first – frustum culling needs them.
import * as THREE from 'three';

function dropArray(this: THREE.BufferAttribute) { (this as unknown as { array: ArrayLike<number> | null }).array = null; }

export function freeAfterUpload(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const g = m.geometry;
    if (g.userData.freeOnUpload) return;
    g.userData.freeOnUpload = true;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingBox) g.computeBoundingBox();
    for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).onUpload(dropArray);
    g.index?.onUpload(dropArray);
  });
}

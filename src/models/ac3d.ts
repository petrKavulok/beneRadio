// Minimal AC3D (.ac) loader for FlightGear models.
// FlightGear frame (x aft, y right, z up) is stored in AC as (x, z_up→y, -y_right→z);
// we convert straight into the sim body frame: right = +x, up = +y, aft = +z (nose = -z).
import * as THREE from 'three';

interface AcMat { rgb: [number, number, number]; trans: number; shi: number; spec: number; emis: number }
interface AcSurf { flags: number; mat: number; refs: [number, number, number][] }
export interface AcObj { type: string; name: string; texture?: string; loc: number[]; rot?: number[]; crease: number; verts: number[]; surfs: AcSurf[]; kids: AcObj[] }

export function parseAC(text: string) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  const mats: AcMat[] = [];
  const num = (s: string) => parseFloat(s);
  const tok = (l: string) => l.trim().split(/\s+/);
  function readObject(): AcObj {
    const head = tok(lines[i++]);
    const o: AcObj = { type: head[1], name: '', loc: [0, 0, 0], crease: 61, verts: [], surfs: [], kids: [] };
    while (i < lines.length) {
      const t = tok(lines[i]);
      const k = t[0];
      if (k === 'name') { o.name = lines[i].trim().slice(5).replace(/^"|"$/g, ''); i++; }
      else if (k === 'data') { i += 2; }
      else if (k === 'texture') { o.texture = lines[i].trim().slice(8).replace(/^"|"$/g, ''); i++; }
      else if (k === 'loc') { o.loc = t.slice(1, 4).map(num); i++; }
      else if (k === 'rot') { o.rot = t.slice(1, 10).map(num); i++; }
      else if (k === 'crease') { o.crease = num(t[1]); i++; }
      else if (k === 'numvert') {
        const n = parseInt(t[1]); i++;
        for (let v = 0; v < n; v++, i++) { const p = tok(lines[i]); o.verts.push(num(p[0]), num(p[1]), num(p[2])); }
      } else if (k === 'numsurf') {
        const n = parseInt(t[1]); i++;
        for (let s = 0; s < n; s++) {
          const surf: AcSurf = { flags: parseInt(tok(lines[i++])[1]), mat: 0, refs: [] };
          while (i < lines.length) {
            const u = tok(lines[i]);
            if (u[0] === 'mat') { surf.mat = parseInt(u[1]); i++; }
            else if (u[0] === 'refs') {
              const r = parseInt(u[1]); i++;
              for (let q = 0; q < r; q++, i++) { const p = tok(lines[i]); surf.refs.push([parseInt(p[0]), num(p[1] ?? '0'), num(p[2] ?? '0')]); }
              break;
            } else break;
          }
          o.surfs.push(surf);
        }
      } else if (k === 'kids') {
        const n = parseInt(t[1]); i++;
        for (let c = 0; c < n; c++) o.kids.push(readObject());
        return o;
      } else i++;
    }
    return o;
  }
  while (i < lines.length && !lines[i].startsWith('OBJECT')) {
    const l = lines[i++];
    if (l.startsWith('MATERIAL')) {
      const g = (key: string, n: number) => { const m = l.match(new RegExp(`${key}\\s+([-\\d.e]+)` + (n === 3 ? '\\s+([-\\d.e]+)\\s+([-\\d.e]+)' : ''))); return m ? m.slice(1, n + 1).map(num) : [0, 0, 0]; };
      const rgb = g('rgb', 3) as [number, number, number];
      mats.push({ rgb, trans: g('trans', 1)[0], shi: g('shi', 1)[0], spec: g('spec', 3)[0], emis: g('emis', 3)[0] });
    }
  }
  return { mats, root: readObject() };
}

export interface BuildOpts {
  textures: (name: string) => THREE.Texture | null;
  offset: THREE.Vector3;          // added in FG coordinates (x aft, y right, z up)
  skip?: (name: string) => boolean;
}

/** Build one Mesh per named AC object, vertices baked in sim body coordinates. */
export function buildAC(ac: ReturnType<typeof parseAC>, opts: BuildOpts) {
  const out = new THREE.Group();
  const matCache = new Map<string, THREE.Material>();
  const material = (mi: number, tex: string | undefined, twoSided: boolean) => {
    const key = `${mi}|${tex}|${twoSided}`;
    let m = matCache.get(key);
    if (!m) {
      const a = ac.mats[mi] ?? ac.mats[0];
      const map = tex ? opts.textures(tex) : null;
      m = new THREE.MeshStandardMaterial({
        map, color: new THREE.Color(...a.rgb), roughness: a.trans > 0 ? 0.05 : THREE.MathUtils.clamp(1 - a.shi / 128, 0.25, 0.9),
        metalness: a.trans > 0 ? 0.3 : 0.05, transparent: a.trans > 0, opacity: 1 - a.trans,
        depthWrite: a.trans === 0, side: twoSided || a.trans > 0 ? THREE.DoubleSide : THREE.FrontSide,
      });
      matCache.set(key, m);
    }
    return m;
  };
  const walk = (o: AcObj, parent: THREE.Matrix4) => {
    // AC: v' = rot * v + loc, applied parent-first
    const local = new THREE.Matrix4();
    if (o.rot) { const r = o.rot; local.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1); }
    local.setPosition(o.loc[0], o.loc[1], o.loc[2]);
    const world = parent.clone().multiply(local);
    if (o.type === 'poly' && o.surfs.length && !(opts.skip?.(o.name))) out.add(buildPoly(o, world, opts.offset, material));
    for (const k of o.kids) walk(k, world);
  };
  walk(ac.root, new THREE.Matrix4());
  return out;
}

function buildPoly(o: AcObj, m: THREE.Matrix4, off: THREE.Vector3, material: (mi: number, tex: string | undefined, two: boolean) => THREE.Material) {
  // transform vertices: AC -> FG (x, -z, y) -> sim (FGy, FGz, FGx) i.e. sim = (-acz, acy, acx) + offset
  const v = new THREE.Vector3();
  const P: number[] = [];
  for (let i = 0; i < o.verts.length; i += 3) {
    v.set(o.verts[i], o.verts[i + 1], o.verts[i + 2]).applyMatrix4(m);
    P.push(-v.z + off.y, v.y + off.z, v.x + off.x);
  }
  // triangles grouped by material
  type Tri = { a: number[]; uv: number[]; smooth: boolean; key: string; mi: number; two: boolean };
  const tris: Tri[] = [];
  for (const s of o.surfs) {
    if ((s.flags & 0x0f) !== 0 || s.refs.length < 3) continue; // lines
    const smooth = (s.flags & 0x10) !== 0, two = (s.flags & 0x20) !== 0;
    for (let k = 1; k + 1 < s.refs.length; k++) {
      const r = [s.refs[0], s.refs[k], s.refs[k + 1]];
      tris.push({ a: r.map((x) => x[0]), uv: r.flatMap((x) => [x[1], x[2]]), smooth, key: `${s.mat}|${two}`, mi: s.mat, two });
    }
  }
  // face normals (winding flips because the axis swap is a proper rotation — keep AC order)
  const fn = tris.map((t) => {
    const p = (i: number) => new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    const A = p(t.a[0]), B = p(t.a[1]), C = p(t.a[2]);
    return B.sub(A).cross(C.sub(A)).normalize();
  });
  const incident = new Map<number, number[]>();
  tris.forEach((t, ti) => t.a.forEach((vi) => { let l = incident.get(vi); if (!l) incident.set(vi, (l = [])); l.push(ti); }));
  const cosCrease = Math.cos(THREE.MathUtils.degToRad(o.crease || 61));
  const groups = new Map<string, { pos: number[]; nor: number[]; uv: number[]; mi: number; two: boolean }>();
  tris.forEach((t, ti) => {
    let g = groups.get(t.key);
    if (!g) groups.set(t.key, (g = { pos: [], nor: [], uv: [], mi: t.mi, two: t.two }));
    t.a.forEach((vi, c) => {
      g!.pos.push(P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]);
      let n = fn[ti];
      if (t.smooth) {
        const s = new THREE.Vector3();
        for (const tj of incident.get(vi)!) if (fn[tj].dot(fn[ti]) >= cosCrease) s.add(fn[tj]);
        n = s.lengthSq() > 0 ? s.normalize() : fn[ti];
      }
      g!.nor.push(n.x, n.y, n.z);
      g!.uv.push(t.uv[c * 2], t.uv[c * 2 + 1]);
    });
  });
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], mats: THREE.Material[] = [];
  for (const g of groups.values()) {
    geo.addGroup(pos.length / 3, g.pos.length / 3, mats.length);
    mats.push(material(g.mi, o.texture, g.two));
    pos.push(...g.pos); nor.push(...g.nor); uv.push(...g.uv);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, mats.length === 1 ? mats[0] : mats);
  mesh.name = o.name;
  mesh.castShadow = !(mats[0] as THREE.MeshStandardMaterial).transparent;
  mesh.receiveShadow = true;
  return mesh;
}

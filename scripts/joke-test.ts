import { TisemGranny } from '../src/jokes';
import type { AcState } from '../src/lesson';
const log: string[] = [];
let police = false;
const g = new TisemGranny((...l) => log.push(...l), () => 'OK-SIM', () => { police = true; });
const st = (x: number, z: number, altFt: number, onGround = false, gs = 90): AcState => ({ x, z, hdg: 270, ias: gs, gs, altFt, aglFt: altFt - 1300, onGround, running: true, parking: false, touchdownVs: 0, crashed: null });
const fly = (from: [number, number], to: [number, number], alt: number, secs: number) => {
  for (let t = 0; t <= secs; t += 0.1) { const k = t / secs; g.update(st(from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, alt), 0.1, false); }
};
fly([-1200, -1700], [-4000, -1700], 2460, 60); console.log('circuit alt (2460 ft):    stage', g.stage);
fly([-4000, -1700], [-1200, -1700], 2000, 60); console.log('low pass #1 (2000 ft):    stage', g.stage);
fly([-1200, -1700], [-4000, -1700], 2000, 60); console.log('low pass #2:              stage', g.stage, 'police', police);
for (let t = 0; t < 3; t += 0.1) g.update(st(-170, 330, 1320, true, 0.5), 0.1, true);
console.log('parked on apron:          stage', g.stage);
g.reset(); police = false;
fly([-4000, -1700], [-1200, -1700], 2000, 60);
for (let t = 0; t < 50; t += 0.1) g.update(st(-2603 + Math.cos(t / 5) * 200, -1693 + Math.sin(t / 5) * 200, 2000), 0.1, false);
console.log('circling over Tisem 50 s: stage', g.stage, 'police', police);
console.log('\n' + log.join('\n'));

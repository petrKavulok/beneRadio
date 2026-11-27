// LKBE runway habits: 06/24 ~99 %, and with 24 in use the day's first take-off is from 27.
import { readFileSync } from 'node:fs';
import { lkbeAirport } from '../src/airport/lkbe';
import { Lesson, AcState } from '../src/lesson';
const ap = lkbeAirport(JSON.parse(readFileSync('public/data/airfield.json', 'utf8')));
const n: Record<string, number> = {};
for (let i = 0; i < 20000; i++) { const L = new Lesson([ap], ap); const k = `${L.inUse.id} dep ${L.rwy.id}`; n[k] = (n[k] ?? 0) + 1; }
for (const [k, v] of Object.entries(n).sort((a, b) => b[1] - a[1])) console.log(k.padEnd(14), (v / 200).toFixed(2) + ' %');
// a day with 24: first lesson departs 27R, after take-off the circuit is for 24; the next lesson departs 24
const L = new Lesson([ap], ap);
while (L.inUse.id !== '24') L.newWeather();
const st = (o: Partial<AcState>): AcState => ({ x: 0, z: 0, hdg: 0, ias: 70, gs: 70, altFt: 1500, aglFt: 100, onGround: false, running: true, parking: false, touchdownVs: 0, crashed: null, ...o });
console.log(`\nlesson 1: departure ${L.rwy.id} from ${L.hp.id}`);
L.phase = 'takeoff'; L.update(st({}), 0.1);
console.log(`airborne: phase ${L.phase}, circuit runway ${L.rwy.id}`);
L.reset();
console.log(`lesson 2 (same day): departure ${L.rwy.id} from ${L.hp.id}`);

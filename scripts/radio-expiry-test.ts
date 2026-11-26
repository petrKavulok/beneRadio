import { readFileSync } from 'node:fs';
import { lkbeAirport } from '../src/airport/lkbe';
import { Lesson, AcState } from '../src/lesson';
import { AtcMonitor } from '../src/atc-monitor';

const ap = lkbeAirport(JSON.parse(readFileSync('public/data/airfield.json', 'utf8')));
const L = new Lesson([ap], ap);
L.windFrom = 240; (L as unknown as { pickRunway(): void }).pickRunway();
const atc = new AtcMonitor(L);
let screen: { text: string; alpha: number; tag: string }[] = [];
L.onRadio = (l) => { screen = l; };
const st = (x: number, z: number, o: Partial<AcState> = {}): AcState => ({ x, z, hdg: 0, ias: 0, gs: 6, altFt: 1330, aglFt: 0, onGround: true, running: true, parking: false, touchdownVs: 0, crashed: null, ...o });
const show = (label: string) => console.log(`${label.padEnd(34)} ${screen.length ? screen.map((l) => `[${l.tag || 'msg'} ${l.alpha.toFixed(1)}] ${l.text.slice(0, 48)}`).join(' | ') : '(empty)'}`);
const run = (s: AcState, secs: number) => { for (let t = 0; t < secs; t += 0.1) { atc.update(s, 0.1); L.update(s, 0.1); L.tickRadio(0.1); } };

L.call(st(-205, 322));
const p = L.route![2];
show('after taxi clearance');
run(st(p[0], p[1]), 8); show('8 s later, on route');
run(st(p[0], p[1] + 80), 5); show('80 m off route');
run(st(p[0], p[1] + 80), 15); show('still off route 15 s later');
run(st(p[0], p[1]), 1); show('back on route (1 s)');
run(st(p[0], p[1]), 3); show('back on route (4 s)');
run(st(p[0], p[1]), 20); show('25 s later');

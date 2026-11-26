import { readFileSync } from 'node:fs';
import { lkbeAirport } from '../src/airport/lkbe';
import { Lesson, AcState, rwyFrame } from '../src/lesson';
import { AtcMonitor } from '../src/atc-monitor';
import { phraseology } from '../src/voice';
import { rwyHeading } from '../src/airport/types';

const ap = lkbeAirport(JSON.parse(readFileSync('public/data/airfield.json', 'utf8')));
const L = new Lesson([ap], ap);
// force runway 24 in use
L.windFrom = 240; L.windKt = 8; (L as unknown as { pickRunway(): void }).pickRunway();
const atc = new AtcMonitor(L);
const said: string[] = [];
L.onSay = (l) => said.push(l);
const st = (x: number, z: number, o: Partial<AcState> = {}): AcState => ({ x, z, hdg: 0, ias: 0, gs: 8, altFt: 1330, aglFt: 0, onGround: true, running: true, parking: false, touchdownVs: 0, crashed: null, ...o });
const run = (label: string, s: AcState, secs: number) => { const n0 = said.length; for (let t = 0; t < secs; t += 0.1) { atc.update(s, 0.1); L.update(s, 0.1); } console.log(`\n# ${label}\n` + (said.slice(n0).join('\n') || '(no call)')); };

L.call(st(-205, 322)); // request taxi
console.log(`runway ${L.rwy.id}, hold ${L.hp.label}, via ${L.routeNames.join(',')}`);
run('taxi on route', st(L.route![2][0], L.route![2][1]), 5);
run('taxi 80 m off route', st(L.route![2][0], L.route![2][1] + 80), 5);
run('taxi too fast', st(L.route![3][0], L.route![3][1], { gs: 25 }), 5);
const r24 = ap.runways.find((r) => r.id === '24')!;
const mid: [number, number] = [(r24.thr[0] + r24.end[0]) / 2, (r24.thr[1] + r24.end[1]) / 2];
run('entered runway 24 during taxi', st(mid[0], mid[1], { gs: 5 }), 3);
L.phase = 'lineup';
const r09 = ap.runways.find((r) => r.id === '09L')!;
run('lined up on 09L', st(r09.thr[0] + 20, r09.thr[1] - 1, { hdg: rwyHeading(r09), gs: 0 }), 4);
atc.reset(); const r06 = ap.runways.find((r) => r.id === '06')!; const h06 = rwyHeading(r06) * Math.PI / 180;
run('lined up on 06 (opposite)', st(r06.thr[0] + Math.sin(h06) * 60, r06.thr[1] - Math.cos(h06) * 60, { hdg: rwyHeading(r06), gs: 0 }), 4);
L.phase = 'circuit';
// right-hand circuit for 24 → downwind is on the right side (heading 060). Fly it on the LEFT side instead:
const f = { ux: (r24.end[0] - r24.thr[0]), uz: (r24.end[1] - r24.thr[1]) }; const len = Math.hypot(f.ux, f.uz); const ux = f.ux / len, uz = f.uz / len;
const leftSide: [number, number] = [mid[0] - (-uz) * 900, mid[1] - ux * 900];
run('downwind on the wrong side', st(leftSide[0], leftSide[1], { onGround: false, hdg: (rwyHeading(r24) + 180) % 360, altFt: 2460, aglFt: 1100, gs: 80 }), 10);
L.downwindCalled = true;
const rightSide: [number, number] = [mid[0] + (-uz) * 900, mid[1] + ux * 900];
run('downwind 500 ft low', st(rightSide[0], rightSide[1], { onGround: false, hdg: (rwyHeading(r24) + 180) % 360, altFt: 1950, aglFt: 600, gs: 80 }), 12);
run('leaving the circuit area', st(9000, 0, { onGround: false, altFt: 2500, aglFt: 1100, gs: 90 }), 2);
L.phase = 'final';
run('landed on 09L instead of 24', st(r09.thr[0] + 200 * Math.sin(rwyHeading(r09) * Math.PI / 180), r09.thr[1] - 200 * Math.cos(rwyHeading(r09) * Math.PI / 180), { hdg: rwyHeading(r09), gs: 50, touchdownVs: 1 }), 2);
console.log('\n# debrief\n' + L.score.join('\n'));
console.log('\n# spoken\n' + said.filter((l) => /^(RADIO|TOWER)/.test(l)).slice(0, 4).map((l) => phraseology(l.replace(/^\w+:\s*/, ''))).join('\n'));
void rwyFrame;

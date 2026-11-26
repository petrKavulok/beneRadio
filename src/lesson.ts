// Flight-school lesson: start-up → taxi to holding point → departure → circuit (or cross-country)
// → landing at any modelled airport → taxi to its apron. Uncontrolled fields use RADIO
// (information) phraseology, controlled ones (LKPR) use TOWER clearances.
import type { Airport, Runway, HoldingPoint, P2 } from './airport/types';
import { rwyHeading, inPoly, isPaved } from './airport/types';
import { TaxiGraph } from './airport/route';
import type { AircraftParams } from './sim/fdm';
import { P2002 } from './sim/p2002';

export { inPoly };
export type Phase = 'preflight' | 'started' | 'taxi' | 'holding' | 'lineup' | 'takeoff' | 'circuit' | 'final' | 'rollout' | 'vacate' | 'parked' | 'crashed';

export interface AcState { x: number; z: number; hdg: number; ias: number; gs: number; altFt: number; aglFt: number; onGround: boolean; running: boolean; parking: boolean; touchdownVs: number; crashed: string | null }

export function rwyFrame(r: Runway, x: number, z: number) {
  const L = Math.hypot(r.end[0] - r.thr[0], r.end[1] - r.thr[1]);
  const ux = (r.end[0] - r.thr[0]) / L, uz = (r.end[1] - r.thr[1]) / L;
  const dx = x - r.thr[0], dz = z - r.thr[1];
  return { along: dx * ux + dz * uz, right: dx * -uz + dz * ux, length: L };
}
const angDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

export class Lesson {
  phase: Phase = 'preflight';
  windFrom = 240; windKt = 8; qnh = 1015;
  ap!: Airport;
  rwy!: Runway; hp!: HoldingPoint;
  route: P2[] | null = null; target: P2 | null = null; routeNames: string[] = [];
  callsign = 'OK-SIM';
  aircraft: AircraftParams = P2002;
  /** on-screen radio log: each line expires after `ttl` seconds, or when its tag is cleared */
  private radioLog: { text: string; age: number; ttl: number; tag: string }[] = [];
  private radioRefresh = 0;
  private notes = '';
  private warnT = 0;
  downwindCalled = false;
  /** last landing: runway that was in use vs. the one actually used (read by the ATC monitor) */
  lastLanding: { planned: Runway; actual: Runway; ap: Airport; handled: boolean } | null = null;
  /** fired with each new radio line (for the controller voice) */
  onSay: (line: string) => void = () => {};
  private graphs = new Map<string, TaxiGraph>();
  score: string[] = [];
  onRadio: (lines: { text: string; alpha: number; tag: string }[]) => void = () => {};

  constructor(public airports: Airport[], start: Airport) { this.setAirport(start); }

  graph(ap = this.ap) {
    let g = this.graphs.get(ap.icao);
    if (!g) this.graphs.set(ap.icao, (g = new TaxiGraph(ap)));
    return g;
  }
  setAirport(ap: Airport) { this.ap = ap; this.newWeather(); }

  newWeather() {
    this.windFrom = Math.round((Math.random() < 0.7 ? 200 + Math.random() * 90 : 20 + Math.random() * 90) / 10) * 10;
    this.windKt = Math.round(3 + Math.random() * 10);
    this.qnh = Math.round(1008 + Math.random() * 16);
    this.pickRunway();
  }
  private pickRunway() {
    let best = -Infinity;
    for (const r of this.ap.runways) {
      if (!this.ap.hpFor[r.id]) continue;
      const head = Math.cos((angDiff(this.windFrom, rwyHeading(r))) * Math.PI / 180) + (r.lit ? 0.25 : 0) + Math.min(0.2, Math.hypot(r.end[0] - r.thr[0], r.end[1] - r.thr[1]) / 20000);
      if (head > best) { best = head; this.rwy = r; }
    }
    this.hp = this.ap.holds.find((h) => h.id === this.ap.hpFor[this.rwy.id])!;
  }

  reset() {
    this.phase = 'preflight'; this.route = null; this.target = null; this.radioLog = []; this.score = [];
    this.downwindCalled = false; this.lastLanding = null; this.onRadio([]);
  }

  radio(...lines: string[]) { this.radioTagged('', 20, ...lines); }

  /** Radio lines with a tag (e.g. an ATC warning kind) and a time-to-live in seconds. */
  radioTagged(tag: string, ttl: number, ...lines: string[]) {
    lines.forEach((l) => this.onSay(l));
    if (tag) this.radioLog = this.radioLog.filter((e) => e.tag !== tag); // a newer call replaces the older one
    this.radioLog.push(...lines.map((text) => ({ text, age: 0, ttl, tag })));
    this.radioLog = this.radioLog.slice(-4);
    this.renderRadio();
  }

  /** Remove lines with this tag (the situation they talk about is over). */
  expireRadio(tag: string) {
    for (const e of this.radioLog) if (e.tag === tag && e.ttl - e.age > 1.2) e.ttl = e.age + 1.2; // quick fade-out
  }
  hasRadio(tag: string) { return this.radioLog.some((e) => e.tag === tag && e.age < e.ttl); }

  /** Age the radio lines; call every frame (stops while paused). */
  tickRadio(dt: number) {
    if (!this.radioLog.length) return;
    let fading = false;
    for (const e of this.radioLog) { e.age += dt; if (e.ttl - e.age < 2) fading = true; }
    const before = this.radioLog.length;
    this.radioLog = this.radioLog.filter((e) => e.age < e.ttl);
    this.radioRefresh -= dt;
    if (before !== this.radioLog.length || (fading && this.radioRefresh <= 0)) { this.radioRefresh = 0.1; this.renderRadio(); }
  }
  private renderRadio() {
    this.onRadio(this.radioLog.map((e) => ({ text: e.text, tag: e.tag, alpha: Math.max(0, Math.min(1, (e.ttl - e.age) / 2)) })));
  }
  private windStr() { return `wind ${String(this.windFrom).padStart(3, '0')} degrees ${this.windKt} knots`; }
  private get st() { return this.ap.towered ? 'TOWER' : 'RADIO'; }
  private names(n: string[]) { const f = n.filter((x) => x && x !== 'TWY' && x !== 'apron'); return f.length ? f.join(', ') : 'the taxiway'; }

  /** Pilot pressed Enter (radio call). */
  call(a: AcState) {
    const cs = this.callsign, ap = this.ap, st = this.st;
    if (this.phase === 'started' || this.phase === 'preflight') {
      const r = this.graph().route([a.x, a.z], this.hp.pos);
      this.route = r.pts; this.target = this.hp.pos; this.routeNames = r.names;
      const type = this.aircraft.engines.length > 1 ? 'P2006T' : 'P2002';
      this.radio(`${cs}: ${ap.callName}, ${cs}, ${type} at the apron, ${ap.towered ? 'VFR, request taxi' : 'request taxi for circuits'}.`,
        ap.towered
          ? `${st}: ${cs}, runway ${this.rwy.id}, ${this.windStr()}, QNH ${this.qnh}, taxi to holding point ${this.hp.on} via ${this.names(r.names)}.`
          : `${st}: ${cs}, runway ${this.rwy.id} in use, ${this.windStr()}, QNH ${this.qnh}, taxi to holding point ${this.hp.on} runway ${this.rwy.id} via ${this.names(r.names)}.`);
      this.phase = 'taxi';
    } else if (this.phase === 'holding') {
      this.radio(`${cs}: ${cs}, holding point ${this.hp.on}, ready for departure runway ${this.rwy.id}.`,
        ap.towered ? `${st}: ${cs}, ${this.windStr()}, runway ${this.rwy.id} cleared for take-off.` : `${st}: ${cs}, runway ${this.rwy.id} free, ${this.windStr()}, report downwind.`);
      this.phase = 'lineup'; this.route = null; this.target = this.rwy.thr;
    } else if (this.phase === 'rollout' || this.phase === 'vacate') {
      this.taxiBack(a);
    }
  }

  private taxiBack(a: AcState) {
    const ap = this.ap, stand = ap.stands[Math.min(1, ap.stands.length - 1)];
    const r = this.graph().route([a.x, a.z], stand.pos);
    this.route = r.pts; this.target = stand.pos;
    this.radio(`${this.callsign}: ${this.callsign}, runway vacated${ap.towered ? '' : ', taxiing to the apron'}.`,
      ap.towered ? `${this.st}: ${this.callsign}, taxi to the apron via ${this.names(r.names)}.` : `${this.st}: ${this.callsign}, roger.`);
    this.phase = 'vacate';
  }

  /** Runway (any airport) whose surface contains the point, aligned with the heading. */
  private runwayAt(x: number, z: number, hdg: number, slack = 2) {
    for (const ap of this.airports) for (const r of ap.runways) {
      const f = rwyFrame(r, x, z);
      if (Math.abs(f.right) < r.width / 2 + slack && f.along > -30 && f.along < f.length + 30 && Math.abs(angDiff(hdg, rwyHeading(r))) < 60) return { ap, r, f };
    }
    return null;
  }

  update(a: AcState, dt: number) {
    this.warnT -= dt;
    const warn = (s: string) => { if (this.warnT <= 0) { this.notes = s; this.warnT = 4; } };
    if (this.warnT <= 0) this.notes = '';
    if (a.crashed && this.phase !== 'crashed') { this.phase = 'crashed'; this.score.push(a.crashed); }
    const f = rwyFrame(this.rwy, a.x, a.z);
    const rh = rwyHeading(this.rwy);
    const grass = !isPaved(this.rwy.surface);
    switch (this.phase) {
      case 'preflight': if (a.running) this.phase = 'started'; break;
      case 'holding':
        if (!a.onGround && a.aglFt > 30) { this.phase = 'circuit'; this.route = null; this.target = null; this.score.push('Departed without clearance ✗'); }
        break;
      case 'taxi': {
        if (!a.onGround && a.aglFt > 30) { this.phase = 'circuit'; this.route = null; this.target = null; this.score.push('Departed without clearance ✗'); break; }
        if (a.gs > (grass ? 14 : 20)) warn(`⚠️ Taxi slower – max ~${grass ? 10 : 15} kt.`);
        const d = Math.hypot(a.x - this.hp.pos[0], a.z - this.hp.pos[1]);
        if (d < 15 && a.gs < 2) { this.phase = 'holding'; this.route = null; this.score.push(`Reached holding point ${this.hp.on} ✓`); }
        break;
      }
      case 'lineup':
        if (Math.abs(f.right) < this.rwy.width / 2 + 3 && f.along > -15 && f.along < f.length * 0.7 && Math.abs(angDiff(a.hdg, rh)) < 12) { this.phase = 'takeoff'; this.target = null; if (f.along > 250) this.score.push(`Intersection departure (${Math.round(f.length - f.along)} m available)`); }
        break;
      case 'takeoff':
        if (!a.onGround && a.aglFt > 50) { this.phase = 'circuit'; this.score.push('Take-off ✓'); }
        break;
      case 'circuit': {
        const side = this.ap.circuit[this.rwy.id] === 'R' ? 1 : -1;
        if (!this.downwindCalled && Math.abs(angDiff(a.hdg, rh + 180)) < 35 && f.right * side > 400 && f.right * side < 3000 && Math.abs(f.along) < 4000 && a.aglFt > 500) {
          this.downwindCalled = true;
          this.radio(`${this.callsign}: ${this.callsign}, downwind runway ${this.rwy.id}.`, this.ap.towered ? `${this.st}: ${this.callsign}, number one, report final.` : `${this.st}: ${this.callsign}, runway ${this.rwy.id} free, ${this.windStr()}, report final.`);
        }
        // final for the home runway (after downwind) or for ANY runway of another airport (cross-country)
        for (const ap of this.airports) for (const r of ap.runways) {
          if (ap === this.ap && (r !== this.rwy || !this.downwindCalled)) continue;
          const g = rwyFrame(r, a.x, a.z);
          if (g.along < 0 && g.along > -4000 && Math.abs(g.right) < 220 && Math.abs(angDiff(a.hdg, rwyHeading(r))) < 25 && !a.onGround) {
            if (ap !== this.ap) { this.ap = ap; }
            this.rwy = r; this.phase = 'final';
            this.radio(`${this.callsign}: ${ap.callName}, ${this.callsign}, final runway ${r.id}.`, ap.towered ? `${ap.towered ? 'TOWER' : 'RADIO'}: ${this.callsign}, runway ${r.id}, ${this.windStr()}, cleared to land.` : `RADIO: ${this.callsign}, runway ${r.id} free, ${this.windStr()}.`);
            break;
          }
        }
        if (a.onGround && a.gs > 5) this.landed(a);
        break;
      }
      case 'final':
        if (a.onGround) this.landed(a);
        break;
      case 'rollout':
        if ((a.gs < 6 && Math.abs(f.right) > this.rwy.width / 2 + 10) || a.gs < 1) this.taxiBack(a);
        break;
      case 'vacate':
        if (a.gs > (grass ? 14 : 20)) warn(`⚠️ Taxi slower – max ~${grass ? 10 : 15} kt.`);
        if (inPoly([a.x, a.z], this.ap.parking) && a.gs < 1 && !a.running) {
          this.phase = 'parked'; this.route = null; this.target = null;
          this.score.push(`Engine shut down on the ${this.ap.icao} apron ✓`);
        }
        break;
    }
  }

  private landed(a: AcState) {
    const hit = this.runwayAt(a.x, a.z, a.hdg, 25);
    if (hit) {
      if (hit.ap === this.ap && hit.r !== this.rwy) this.lastLanding = { planned: this.rwy, actual: hit.r, ap: hit.ap, handled: false };
      this.ap = hit.ap; this.rwy = hit.r;
    }
    const f = rwyFrame(this.rwy, a.x, a.z);
    const fpm = Math.round(a.touchdownVs * 196.85);
    const onRwy = Math.abs(f.right) < this.rwy.width / 2 + 2 && f.along > -10 && f.along < f.length;
    const grade = fpm < 150 ? 'butter 🧈' : fpm < 300 ? 'good' : fpm < 500 ? 'firm' : 'hard';
    this.score.push(`Landing ${this.ap.icao} RWY ${this.rwy.id}: ${fpm} fpm (${grade}), ${onRwy ? `${Math.abs(f.right).toFixed(1)} m from centreline, ${Math.round(f.along)} m past threshold` : 'NOT on the runway'}`);
    this.phase = 'rollout';
  }

  text(a: AcState) {
    const ap = this.ap;
    const head = `<b>${ap.icao} ${ap.name}</b> · RWY ${this.rwy.id} in use · ${String(this.windFrom).padStart(3, '0')}/${this.windKt} kt · QNH ${this.qnh}`;
    const circ = ap.circuit[this.rwy.id] === 'R' ? 'right-hand' : 'left-hand';
    const others = this.airports.filter((x) => x !== ap).map((x) => x.icao).join(' or ');
    let step = '';
    switch (this.phase) {
      case 'preflight': step = 'Press <b>E</b> to start the engine.'; break;
      case 'started': step = `Engine running. Press <b>Enter</b> to call ${ap.callName} for taxi.`; break;
      case 'taxi': step = `Taxi to holding point <b>${this.hp.label}</b> via <b>${this.names(this.routeNames).replace(/, /g, ' → ')}</b> (magenta line on the map).\nRelease parking brake <b>P</b>, a little power <b>W</b>, steer with <b>A/D</b>, brake <b>Space</b>.\nDistance: ${Math.round(Math.hypot(a.x - this.hp.pos[0], a.z - this.hp.pos[1]))} m`; break;
      case 'holding': step = `Holding point ${this.hp.on} ✓  Stop before the yellow lines.\nRun-up done? Set flaps T/O (<b>F</b>), press <b>Enter</b> when ready for departure.`; break;
      case 'lineup': step = `Line up on runway <b>${this.rwy.id}</b> (heading ${Math.round((rwyHeading(this.rwy) - ap.magVar + 360) % 360)}°)${rwyFrame(this.rwy, this.hp.pos[0], this.hp.pos[1]).along > 250 ? ' – backtrack to the threshold or take off from the intersection' : ''}.`; break;
      case 'takeoff': { const sp = this.aircraft.speeds; step = `Full power (<b>0</b> or hold <b>W</b>). Rotate at <b>${sp.vr} kt</b> (Arrow ↓), climb at <b>Vy ${sp.vy} kt</b>.${this.aircraft.retractable ? `\nPositive climb → gear up (<b>Shift+G</b>). Engine failure? Keep <b>${sp.vyse} kt</b> (blue line), rudder on the live engine.` : ''}`; break; }
      case 'circuit': step = `Climb to circuit altitude <b>${ap.circuitFt} ft</b>, flaps up (<b>R</b>) above 300 ft AGL.\nFly a <b>${circ}</b> circuit for runway ${this.rwy.id}. ${this.downwindCalled ? 'Turn base, then final.' : 'Turn crosswind, then downwind.'}\nOr fly cross-country and land at ${others} – just line up on final there.${ap.icao === 'LKBE' ? '\nKeep clear of the villages (Tisem especially 😉).' : ''}`; break;
      case 'final': step = `Final runway ${this.rwy.id} at ${ap.icao}: ${this.aircraft.retractable ? '<b>gear down (Shift+G) – 3 greens</b>, ' : ''}flaps LDG (<b>F</b>), <b>${this.aircraft.speeds.approach} kt</b>, aim at the threshold, flare gently.`; break;
      case 'rollout': step = 'Brake gently (<b>Space</b>), vacate the runway, then press <b>Enter</b> for taxi.'; break;
      case 'vacate': step = 'Taxi to the apron (magenta line), set parking brake <b>P</b>, stop the engine <b>E</b>.'; break;
      case 'parked': step = '🎉 Flight complete! Press <b>K</b> for a new lesson (new wind).'; break;
      case 'crashed': step = `💥 ${a.crashed}. Press <b>Backspace</b> to restart.`; break;
    }
    const sc = this.score.length ? `\n\n${this.score.join('\n')}` : '';
    return `${head}\n\n${step}${this.notes ? '\n\n' + this.notes : ''}${sc}`;
  }
}

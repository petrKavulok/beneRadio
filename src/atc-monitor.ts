// ATC compliance monitor: compares what the pilot does with what the controller said and calls
// the aircraft on frequency when they deviate. Repeated violations escalate.
import type { Lesson, AcState } from './lesson';
import { rwyFrame } from './lesson';
import { rwyHeading, isPaved } from './airport/types';
import type { P2, Runway } from './airport/types';

type Kind = 'route' | 'speed' | 'incursion' | 'takeoff' | 'lineup' | 'side' | 'altitude' | 'leaving' | 'landing' | 'vacate';
const angDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

function distToRoute(p: P2, pts: P2[]) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz));
  }
  return best;
}
const onRunway = (r: Runway, x: number, z: number, slack = 2) => { const f = rwyFrame(r, x, z); return Math.abs(f.right) < r.width / 2 + slack && f.along > -5 && f.along < f.length + 5; };

export class AtcMonitor {
  violations: string[] = [];
  private last = new Map<Kind, number>();   // time of last call per kind
  private count = new Map<Kind, number>();  // calls per kind (for escalation)
  private timers = new Map<Kind, number>(); // how long a condition has persisted
  private t = 0;
  private escalated = false;
  private phaseSeen = '';
  onAlert: () => void = () => {};

  constructor(private lesson: Lesson) {}

  reset() { this.violations = []; this.last.clear(); this.count.clear(); this.timers.clear(); this.escalated = false; this.phaseSeen = ''; }

  private hold(k: Kind, cond: boolean, dt: number, secs: number) {
    const v = cond ? (this.timers.get(k) ?? 0) + dt : 0;
    this.timers.set(k, v);
    return v >= secs;
  }

  /** Make a call unless the same kind was called recently. Returns true if called. */
  private call(k: Kind, cooldown: number, msg: (n: number) => string, log: string) {
    const prev = this.last.get(k) ?? -1e9;
    if (this.t - prev < cooldown) return false;
    const n = (this.count.get(k) ?? 0) + 1;
    this.count.set(k, n);
    this.last.set(k, this.t);
    const L = this.lesson, st = L.ap.towered ? 'TOWER' : 'RADIO';
    const persistent = ['route', 'speed', 'incursion', 'lineup', 'side', 'altitude', 'vacate'].includes(k);
    L.radioTagged(k, persistent ? 60 : 25, `${st}: ${L.callsign}, ${L.ap.callName}, ${msg(n)}`);
    if (n === 1) { this.violations.push(log); L.score.push(`⚠️ ATC: ${log}`); }
    this.onAlert();
    const total = [...this.count.values()].reduce((a, b) => a + b, 0);
    if (total >= 4 && !this.escalated) {
      this.escalated = true;
      L.radioTagged('escalation', 25, `${st}: ${L.callsign}, that's several instructions not followed. Contact the duty instructor after landing.`);
    }
    return true;
  }

  /** Clear an on-screen warning once its condition has been false for a moment. */
  private resolve(k: Kind, active: boolean, dt: number) {
    const key = ('ok-' + k) as Kind;
    const v = active ? 0 : (this.timers.get(key) ?? 0) + dt;
    this.timers.set(key, v);
    if (v > 2 && this.lesson.hasRadio(k)) this.lesson.expireRadio(k);
  }

  update(a: AcState, dt: number) {
    this.t += dt;
    const L = this.lesson, ap = L.ap, phase = L.phase;
    if (phase === 'crashed' || phase === 'parked') return;
    if (phase !== this.phaseSeen) { this.timers.clear(); this.phaseSeen = phase; }
    const pos: P2 = [a.x, a.z];
    const grass = !isPaved(L.rwy.surface);

    // ---- taxi: stay on the cleared route, sensible speed ----
    if ((phase === 'taxi' || phase === 'vacate') && L.route && L.route.length > 1 && a.onGround) {
      const off = distToRoute(pos, L.route);
      if (this.hold('route', off > 35 && a.gs > 1, dt, 3)) {
        const via = L.routeNames.filter((n) => n && n !== 'TWY' && n !== 'apron').join(', ') || 'the cleared route';
        this.call('route', 30, (n) => n === 1 ? `you appear to be off your taxi route. Taxi via ${via}.`
          : n === 2 ? `again, you are not on the cleared route. Stop, and taxi via ${via}.` : `you are still off route. Hold position and advise when able.`, 'Left the cleared taxi route');
      }
      if (this.hold('speed', a.gs > (grass ? 15 : 22), dt, 3)) this.call('speed', 40, (n) => n === 1 ? 'reduce taxi speed.' : 'I say again, reduce taxi speed, walking pace on the apron.', 'Taxied too fast');
    }

    // ---- runway incursion: on the runway in use before reporting ready / without clearance ----
    if ((phase === 'taxi' || phase === 'holding') && a.onGround) {
      const routeUsesRwy = L.routeNames.some((n) => n === `RWY ${L.rwy.pair}`);
      const inUse = ap.runways.filter((r) => r.pair === L.rwy.pair);
      if (!routeUsesRwy && inUse.some((r) => onRunway(r, a.x, a.z, 1))) {
        this.call('incursion', 25, (n) => ap.towered
          ? (n === 1 ? `STOP IMMEDIATELY, you have entered runway ${L.rwy.id} without clearance. Hold position.` : `hold position! You are on an active runway without clearance.`)
          : (n === 1 ? `you are on runway ${L.rwy.id}. Hold short at ${L.hp.on} and report ready before entering.` : `you are still on the runway without reporting ready – vacate or report ready.`), 'Entered the runway without clearance');
      }
      // rolling fast on a runway without clearance = attempted take-off
      if (a.gs > 30 && ap.runways.some((r) => onRunway(r, a.x, a.z, 5))) {
        this.call('takeoff', 60, () => ap.towered ? 'STOP, STOP, STOP – you are not cleared for take-off!' : 'you are rolling on the runway without reporting ready. Traffic information not passed, abort if able.', 'Took off without clearance');
      }
    }
    if ((phase === 'taxi' || phase === 'holding') && !a.onGround && a.aglFt > 10) {
      this.call('takeoff', 60, () => ap.towered ? 'you departed without take-off clearance. Report on the downwind and call the tower by phone after landing.' : 'you departed without reporting ready. Report your intentions.', 'Took off without clearance');
    }

    // ---- line-up on the wrong runway / wrong direction ----
    if (phase === 'lineup' && a.onGround) {
      const wrong = ap.runways.find((r) => r !== L.rwy && onRunway(r, a.x, a.z, 1) && Math.abs(angDiff(a.hdg, rwyHeading(r))) < 15);
      if (wrong && this.hold('lineup', true, dt, 2)) {
        const opposite = wrong.pair === L.rwy.pair;
        this.call('lineup', 30, () => opposite ? `check your heading – you are lined up on runway ${wrong.id}, the runway in use is ${L.rwy.id}.` : `you are lined up on runway ${wrong.id}. The runway in use is ${L.rwy.id}.`, `Lined up on runway ${wrong.id} instead of ${L.rwy.id}`);
      } else if (!wrong) this.timers.set('lineup', 0);
    }

    // ---- circuit: side, altitude, leaving the area ----
    if (phase === 'circuit' && !a.onGround) {
      const f = rwyFrame(L.rwy, a.x, a.z), rh = rwyHeading(L.rwy);
      const side = ap.circuit[L.rwy.id] === 'R' ? 1 : -1;
      const onDownwindHeading = Math.abs(angDiff(a.hdg, rh + 180)) < 35 && Math.abs(f.along) < 3500;
      const wrongSide = onDownwindHeading && f.right * side < -400 && f.right * side > -3000;
      if (this.hold('side', wrongSide, dt, 6)) {
        this.call('side', 60, () => `circuits for runway ${L.rwy.id} are ${side > 0 ? 'right' : 'left'}-hand. You are on the wrong side – rejoin the ${side > 0 ? 'right' : 'left'}-hand circuit.`, 'Flew the circuit on the wrong side');
      }
      const inPattern = L.downwindCalled && Math.hypot(a.x - ap.centre[0], a.z - ap.centre[1]) < 4500;
      const altErr = a.altFt - ap.circuitFt;
      if (this.hold('altitude', inPattern && Math.abs(altErr) > 300 && a.aglFt > 300, dt, 8)) {
        this.call('altitude', 50, () => `check altitude – circuit altitude is ${ap.circuitFt} feet, you are ${Math.abs(Math.round(altErr / 50) * 50)} feet ${altErr > 0 ? 'high' : 'low'}.`, 'Deviated from circuit altitude');
      }
      const away = Math.hypot(a.x - ap.centre[0], a.z - ap.centre[1]);
      if (away > 7000 && !this.last.has('leaving')) {
        this.call('leaving', 1e9, () => 'you are leaving the circuit area. Report your intentions – and monitor the frequency of your destination.', 'Left the circuit without reporting');
      }
    }

    // ---- landing: wrong runway / opposite direction ----
    const ld = L.lastLanding;
    if (ld && !ld.handled) {
      ld.handled = true;
      const opposite = ld.planned.pair === ld.actual.pair;
      this.call('landing', 0, () => opposite ? `you landed on runway ${ld.actual.id}, opposite direction to the runway in use ${ld.planned.id}. Tailwind landings are not funny – report to the instructor.`
        : `you landed on runway ${ld.actual.id}, the runway in use was ${ld.planned.id}.`, `Landed on runway ${ld.actual.id} instead of ${ld.planned.id}`);
    }

    // ---- vacate the runway after landing ----
    const vacating = (phase === 'rollout' || phase === 'vacate') && a.onGround && ap.runways.some((r) => onRunway(r, a.x, a.z, 2));
    if ((phase === 'rollout' || phase === 'vacate') && a.onGround) {
      const onAny = ap.runways.some((r) => onRunway(r, a.x, a.z, 2));
      if (this.hold('vacate', onAny && a.gs < 15, dt, 40)) this.call('vacate', 40, (n) => n === 1 ? 'vacate the runway when able.' : 'vacate the runway NOW, traffic on final.', 'Did not vacate the runway');
    }

    // ---- clear warnings that are no longer relevant ----
    const taxiing = (phase === 'taxi' || phase === 'vacate') && a.onGround;
    const offRoute = taxiing && !!L.route && L.route.length > 1 && distToRoute(pos, L.route) > 20;
    const tooFast = taxiing && a.gs > (grass ? 13 : 20);
    const onRwyInUse = (phase === 'taxi' || phase === 'holding') && ap.runways.some((r) => r.pair === L.rwy.pair && onRunway(r, a.x, a.z, 3));
    const wrongLineup = phase === 'lineup' && ap.runways.some((r) => r !== L.rwy && onRunway(r, a.x, a.z, 2) && Math.abs(angDiff(a.hdg, rwyHeading(r))) < 25);
    let wrongSideNow = false, offAlt = false;
    if (phase === 'circuit' && !a.onGround) {
      const f = rwyFrame(L.rwy, a.x, a.z), side = ap.circuit[L.rwy.id] === 'R' ? 1 : -1;
      wrongSideNow = Math.abs(angDiff(a.hdg, rwyHeading(L.rwy) + 180)) < 60 && f.right * side < -300 && Math.abs(f.along) < 4000;
      offAlt = Math.abs(a.altFt - ap.circuitFt) > 150 && Math.hypot(a.x - ap.centre[0], a.z - ap.centre[1]) < 5000;
    }
    this.resolve('route', offRoute, dt);
    this.resolve('speed', tooFast, dt);
    this.resolve('incursion', onRwyInUse, dt);
    this.resolve('lineup', wrongLineup, dt);
    this.resolve('side', wrongSideNow, dt);
    this.resolve('altitude', offAlt, dt);
    this.resolve('vacate', vacating, dt);
  }

  summary() { return this.violations.length ? `ATC: ${this.violations.length} instruction${this.violations.length > 1 ? 's' : ''} not followed ✗ – ${this.violations.join('; ')}` : ''; }
}

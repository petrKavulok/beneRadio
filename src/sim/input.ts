// Keyboard + mouse input -> smoothed control positions.
import { Controls } from './fdm';

export type Action =
  | 'engine' | 'camera' | 'map' | 'labels' | 'reset' | 'help' | 'pause' | 'yoke' | 'ready' | 'nextStand' | 'lesson' | 'gear' | 'failL' | 'failR' | 'voice' | 'sound';

export class Input {
  c: Controls = { elevator: 0, aileron: 0, rudder: 0, throttle: 0, brakeL: 0, brakeR: 0, parking: true, flaps: 0, trim: 0 };
  /** neutral controls (for parked aircraft) */
  readonly c0: Controls = { elevator: 0, aileron: 0, rudder: 0, throttle: 0, brakeL: 0, brakeR: 0, parking: true, flaps: 0, trim: 0 };
  keys = new Set<string>();
  mouseYoke = false;
  mouse = { x: 0, y: 0, dragging: false, dx: 0, dy: 0, wheel: 0 };
  /** on-screen touch controls / tilt (src/ui/touch.ts); null = not in use */
  touch = { stick: null as null | { x: number; y: number }, tilt: null as null | { x: number; y: number }, rudder: null as null | number, brake: false, trim: 0 };
  private listeners: ((a: Action) => void)[] = [];
  private latch = new Map<string, number>();
  private held(code: string) { return this.keys.has(code) || (this.latch.get(code) ?? 0) > performance.now(); }

  constructor(el: HTMLElement) {
    addEventListener('keydown', (e) => {
      const tgt = e.target as HTMLElement;
      if (tgt?.tagName === 'INPUT') return; // typing the registration
      if (tgt?.tagName === 'SELECT') { tgt.blur(); e.preventDefault(); } // a focused menu must not eat flight keys
      // Every keydown (including auto-repeat) keeps the key "held" for a moment. Some browsers/webviews
      // deliver a held key as rapid down/up pairs, which would otherwise never register as held.
      this.latch.set(e.code, performance.now() + 220);
      if (e.repeat && !['KeyW', 'KeyS'].includes(e.code)) { if (!e.code.startsWith('Arrow')) return; }
      this.keys.add(e.code);
      const fire = (a: Action) => this.listeners.forEach((l) => l(a));
      switch (e.code) {
        case 'KeyE': fire('engine'); break;
        case 'KeyC': fire('camera'); break;
        case 'KeyM': fire('map'); break;
        case 'KeyL': fire('labels'); break;
        case 'Backspace': fire('reset'); break;
        case 'KeyH': case 'F1': fire('help'); e.preventDefault(); break;
        case 'Escape': fire('pause'); break;
        case 'KeyY': this.mouseYoke = !this.mouseYoke; fire('yoke'); break;
        case 'Enter': fire('ready'); break;
        case 'KeyN': fire('nextStand'); break;
        case 'KeyK': fire('lesson'); break;
        case 'KeyG': if (e.shiftKey) fire('gear'); break; // plain G = trim nose down (same as T/G on every aircraft)
        case 'KeyV': fire('voice'); break;
        case 'KeyO': fire('sound'); break;
        case 'KeyU': fire('failL'); break;
        case 'KeyI': fire('failR'); break;
        case 'KeyP': this.c.parking = !this.c.parking; break;
        case 'KeyF': this.c.flaps = Math.min(2, this.c.flaps + 1); break;
        case 'KeyR': this.c.flaps = Math.max(0, this.c.flaps - 1); break;
        case 'Digit1': this.c.throttle = 0; break;
        case 'Digit0': this.c.throttle = 1; break;
      }
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.latch.clear(); });
    el.addEventListener('mousemove', (e) => {
      this.mouse.x = (e.clientX / innerWidth) * 2 - 1;
      this.mouse.y = (e.clientY / innerHeight) * 2 - 1;
      if (this.mouse.dragging) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    el.addEventListener('mousedown', () => { this.mouse.dragging = true; });
    addEventListener('mouseup', () => { this.mouse.dragging = false; });
    el.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  on(l: (a: Action) => void) { this.listeners.push(l); }
  /** trigger an action as if its key was pressed (touch buttons) */
  fire(a: Action) { if (a === 'yoke') this.mouseYoke = !this.mouseYoke; this.listeners.forEach((l) => l(a)); }

  update(dt: number) {
    const h = (...codes: string[]) => codes.some((x) => this.held(x));
    const c = this.c;
    const axis = (neg: boolean, pos: boolean, cur: number, rate: number, ret: number) => {
      if (pos && !neg) return Math.min(1, cur + rate * dt * (cur < 0 ? 2.5 : 1));
      if (neg && !pos) return Math.max(-1, cur - rate * dt * (cur > 0 ? 2.5 : 1));
      return Math.abs(cur) < ret * dt ? 0 : cur - Math.sign(cur) * ret * dt;
    };
    const arrows = h('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight');
    const T = this.touch, touchStick = T.stick ?? T.tilt;
    const follow = (cur: number, to: number) => cur + (to - cur) * Math.min(1, dt * 14);
    if (touchStick && !arrows) {
      c.aileron = follow(c.aileron, touchStick.x);
      c.elevator = follow(c.elevator, touchStick.y);
    } else if (this.mouseYoke && !arrows) {
      const dz = (v: number) => (Math.abs(v) < 0.04 ? 0 : (v - Math.sign(v) * 0.04) / 0.96);
      c.aileron = dz(this.mouse.x);
      c.elevator = dz(this.mouse.y) * 1.1;
    } else {
      c.elevator = axis(h('ArrowUp'), h('ArrowDown'), c.elevator, 2.0, 2.2);
      c.aileron = axis(h('ArrowLeft'), h('ArrowRight'), c.aileron, 2.6, 3.0);
    }
    const rudKeys = h('KeyA', 'KeyZ', 'KeyD', 'KeyX');
    c.rudder = T.rudder !== null && !rudKeys ? follow(c.rudder, T.rudder) : axis(h('KeyA', 'KeyZ'), h('KeyD', 'KeyX'), c.rudder, 2.5, 3.5);
    if (T.trim) c.trim = Math.max(-1, Math.min(1, c.trim + T.trim * 0.4 * dt));
    if (h('KeyW', 'Equal')) c.throttle = Math.min(1, c.throttle + 0.5 * dt);
    if (h('KeyS', 'Minus')) c.throttle = Math.max(0, c.throttle - 0.5 * dt);
    if (h('BracketRight', 'PageUp') || (h('KeyT') && !this.keys.has('ShiftLeft') && !this.keys.has('ShiftRight'))) c.trim = Math.min(1, c.trim + 0.4 * dt);
    if (h('BracketLeft', 'PageDown') || (h('KeyG') && !this.keys.has('ShiftLeft') && !this.keys.has('ShiftRight'))) c.trim = Math.max(-1, c.trim - 0.4 * dt);
    const both = h('Space', 'KeyB') || T.brake;
    c.brakeL = both || h('Comma') ? 1 : 0;
    c.brakeR = both || h('Period') ? 1 : 0;
  }
}

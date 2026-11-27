// Touch controls for iPads / tablets: stick pad, rudder bar, throttle lever, big buttons,
// a menu for everything else, optional tilt steering, and drag / pinch to look around.
import type { Input, Action } from '../sim/input';

export interface TouchState { parking: boolean; flaps: number; gear: number | null; running: boolean; throttle: number; trim: number; view: string; paused: boolean; time: string; twin: boolean; sound: boolean; voice: boolean }

/** Should the touch layout be on? (?touch=1 / ?touch=0 override the detection) */
export function wantsTouch() {
  const q = new URLSearchParams(location.search).get('touch');
  if (q !== null) return q !== '0';
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
}

const clamp = (v: number, a = -1, b = 1) => Math.max(a, Math.min(b, v));
/** softer around the centre, full deflection at the edge */
const expo = (v: number) => Math.sign(v) * (0.35 * Math.abs(v) + 0.65 * v * v);

/** Lesson / help text: key names -> touch buttons. */
export function touchify(html: string) {
  return html
    .replace('Full power (<b>0</b> or hold <b>W</b>)', 'Full power (throttle lever all the way up)')
    .replace('(Arrow ↓)', '(pull the stick pad down)')
    .replace(/<b>E<\/b>/g, '<b>ENGINE</b>')
    .replace(/<b>Enter<\/b>/g, '<b>📻 CALL</b>')
    .replace(/<b>P<\/b>/g, '<b>PARK</b>')
    .replace(/a little power <b>W<\/b>/g, 'a little power (throttle lever)')
    .replace(/<b>W<\/b>/g, '<b>throttle</b>')
    .replace(/steer with <b>A\/D<\/b>/g, 'steer with the <b>RUDDER</b> bar')
    .replace(/<b>Space<\/b>/g, '<b>BRAKE</b>')
    .replace(/<b>F<\/b>/g, '<b>FLAPS ▼</b>')
    .replace(/<b>R<\/b>/g, '<b>FLAPS ▲</b>')
    .replace(/<b>Shift\+G<\/b>/g, '<b>GEAR</b>')
    .replace(/<b>K<\/b>/g, '<b>☰ → New lesson</b>')
    .replace(/Press <b>Backspace<\/b> or the Restart button/g, 'Tap <b>↺ Restart</b>').replace(/<b>Backspace<\/b>/g, '<b>☰ → Restart</b>')
    .replace('Esc to resume', 'tap ☰ → Resume');
}

export class TouchControls {
  readonly root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private tiltOn = false;
  private tiltInvert = localStorage.getItem('lkbe.tiltInvert') === '1';
  private tilt0: { roll: number; pitch: number } | null = null;
  private tiltRaw = { roll: 0, pitch: 0 };
  private thrDrag: { y: number; v: number } | null = null;
  onPicker: (show: boolean) => void = () => {};
  onPause: () => void = () => {};
  /** cycle the time of day */
  onTime: () => void = () => {};
  /** the picker was closed from outside (its Done button) */
  closePicker = () => {};

  constructor(private input: Input, private canvas: HTMLElement, private state: () => TouchState) {
    document.body.classList.add('touch');
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.innerHTML = `
      <div class="pad stick" data-k="stick"><div class="knob"></div><span class="lbl s">STICK</span></div>
      <div class="pad rudder" data-k="rudder"><span class="lbl l">◀ L</span><span class="lbl r">R ▶</span><div class="knob"></div><span class="lbl top">RUDDER · nose wheel</span></div>
      <div class="pad thr" data-k="thr"><div class="fill"></div><div class="knob"></div><span class="lbl">THR</span></div>
      <div class="cluster">
        <button data-k="brake" class="hold big">BRAKE</button>
        <button data-k="park">PARK</button><button data-k="gear">GEAR</button>
        <button data-k="flapUp">FLAPS ▲</button><button data-k="flapDn">FLAPS ▼</button>
        <button data-k="trimUp" class="hold">TRIM UP</button><button data-k="trimDn" class="hold">TRIM DN</button>
      </div>
      <div class="row">
        <button data-k="engine">ENGINE</button><button data-k="ready">📻 CALL</button>
        <button data-k="camera">VIEW</button><button data-k="map">MAP</button><button data-k="menu">☰</button>
      </div>
      <div class="menu hidden" data-k="menuSheet">
        <div class="grid">
          <button data-m="resume">▶︎ Resume</button>
          <button data-m="reset">↺ Restart</button>
          <button data-m="lesson">✦ New lesson (new wind)</button>
          <button data-m="nextStand">⇄ Next parking stand</button>
          <button data-m="picker">✈︎ Aircraft &amp; airport…</button>
          <button data-m="time">☀️ Time: Midday</button>
          <button data-m="help">? Help</button>
          <button data-m="labels">🏷 Village labels</button>
          <button data-m="sound">🔊 Engine sound</button>
          <button data-m="voice">🗣 Controller voice</button>
          <button data-m="tilt">📱 Tilt steering: OFF</button>
          <button data-m="tiltCal">⊙ Calibrate tilt (hold as neutral)</button>
          <button data-m="tiltInv">⇅ Tilt pitch: normal</button>
          <button data-m="failL" class="twin">✕ Fail left engine</button>
          <button data-m="failR" class="twin">✕ Fail right engine</button>
          <button data-m="full">⛶ Full screen</button>
        </div>
        <p class="note"></p>
      </div>`;
    document.body.appendChild(root);
    root.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.els[e.dataset.k!] = e));
    root.querySelectorAll<HTMLElement>('[data-m]').forEach((e) => (this.els['m_' + e.dataset.m!] = e));
    // keep Safari from scrolling, zooming or selecting text under the controls
    root.addEventListener('touchstart', (e) => { if (!(e.target as HTMLElement).closest('.menu')) e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());

    this.setupStick();
    this.setupRudder();
    this.setupThrottle();
    this.setupButtons();
    this.setupMenu();
    this.setupLook();
    addEventListener('deviceorientation', (e) => this.onOrientation(e));
  }

  // ---- stick pad: x = roll, y = pitch (drag down = pull = nose up), springs back
  private setupStick() {
    const el = this.els.stick, knob = el.querySelector<HTMLElement>('.knob')!;
    const T = this.input.touch;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect(), R = r.width / 2 - 18;
      let x = (e.clientX - r.left - r.width / 2) / R, y = (e.clientY - r.top - r.height / 2) / R;
      const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
      knob.style.transform = `translate(${x * R}px, ${y * R}px)`;
      T.stick = { x: expo(x), y: expo(y) * 1.05 };
    };
    this.drag(el, move, () => { T.stick = null; knob.style.transform = ''; });
  }

  // ---- rudder bar (nose-wheel steering on the ground), springs back
  private setupRudder() {
    const el = this.els.rudder, knob = el.querySelector<HTMLElement>('.knob')!;
    const T = this.input.touch;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect(), R = r.width / 2 - 22;
      const x = clamp((e.clientX - r.left - r.width / 2) / R);
      knob.style.transform = `translateX(${x * R}px)`;
      T.rudder = expo(x);
    };
    this.drag(el, move, () => { T.rudder = null; knob.style.transform = ''; });
  }

  // ---- throttle lever: relative drag (touching it never jumps the power), stays where it is left
  private setupThrottle() {
    const el = this.els.thr, c = this.input.c;
    el.addEventListener('pointerdown', (e) => { try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } this.thrDrag = { y: e.clientY, v: c.throttle }; el.classList.add('on'); });
    el.addEventListener('pointermove', (e) => {
      if (!this.thrDrag) return;
      const h = el.getBoundingClientRect().height - 40;
      c.throttle = clamp(this.thrDrag.v - (e.clientY - this.thrDrag.y) / h, 0, 1);
    });
    const end = () => { this.thrDrag = null; el.classList.remove('on'); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    // double tap: idle
    let last = 0;
    el.addEventListener('pointerdown', () => { const now = performance.now(); if (now - last < 300) c.throttle = 0; last = now; });
  }

  private drag(el: HTMLElement, move: (e: PointerEvent) => void, end: () => void) {
    let id = -1;
    el.addEventListener('pointerdown', (e) => { id = e.pointerId; try { el.setPointerCapture(id); } catch { /* synthetic pointer */ } el.classList.add('on'); move(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const up = (e: PointerEvent) => { if (e.pointerId !== id) return; id = -1; el.classList.remove('on'); end(); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }

  private setupButtons() {
    const T = this.input.touch, c = this.input.c;
    const hold = (k: string, on: () => void, off: () => void) => {
      const el = this.els[k];
      el.addEventListener('pointerdown', (e) => { try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } el.classList.add('on'); on(); });
      const up = () => { el.classList.remove('on'); off(); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    };
    hold('brake', () => (T.brake = true), () => (T.brake = false));
    hold('trimUp', () => (T.trim = 1), () => (T.trim = 0));
    hold('trimDn', () => (T.trim = -1), () => (T.trim = 0));
    const tap = (k: string, f: () => void) => this.els[k].addEventListener('pointerdown', (e) => { e.preventDefault(); this.flash(this.els[k]); f(); });
    tap('park', () => (c.parking = !c.parking));
    tap('flapUp', () => (c.flaps = Math.max(0, c.flaps - 1)));
    tap('flapDn', () => (c.flaps = Math.min(2, c.flaps + 1)));
    tap('gear', () => this.input.fire('gear'));
    for (const a of ['engine', 'ready', 'camera', 'map'] as Action[]) tap(a, () => this.input.fire(a));
    tap('menu', () => this.menu(this.els.menuSheet.classList.contains('hidden')));
  }
  private flash(el: HTMLElement) { el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 140); }

  private menu(show: boolean) {
    this.els.menuSheet.classList.toggle('hidden', !show);
    if (show !== this.state().paused) this.onPause(); // the sim pauses while the menu is open
  }

  private setupMenu() {
    const note = this.root.querySelector<HTMLElement>('.note')!;
    let picker = false;
    this.closePicker = () => { picker = false; };
    const act = (m: string) => {
      switch (m) {
        case 'resume': this.menu(false); break;
        case 'reset': case 'lesson': case 'nextStand': this.input.fire(m as Action); this.menu(false); break;
        case 'help': this.menu(false); this.input.fire('help'); break;
        case 'labels': this.input.fire('labels'); break;
        case 'time': this.onTime(); break;
        case 'sound': this.input.fire('sound'); break;
        case 'voice': this.input.fire('voice'); break;
        case 'failL': case 'failR': this.input.fire(m as Action); this.menu(false); break;
        case 'picker': picker = !picker; this.onPicker(picker); this.menu(false); break;
        case 'tilt': void this.toggleTilt(note); break;
        case 'tiltCal': this.tilt0 = { ...this.tiltRaw }; note.textContent = 'Tilt centred – this is now "stick neutral".'; break;
        case 'tiltInv': this.tiltInvert = !this.tiltInvert; localStorage.setItem('lkbe.tiltInvert', this.tiltInvert ? '1' : '0'); break;
        case 'full': {
          const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
          const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
          if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
          else if (el.requestFullscreen) void el.requestFullscreen().catch(() => (note.textContent = 'Full screen is not available here – use Share → Add to Home Screen.'));
          else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
          else note.textContent = 'Full screen is not available here – use Share → Add to Home Screen.';
          break;
        }
      }
      this.sync();
    };
    this.root.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.addEventListener('click', () => act(b.dataset.m!)));
    // tap outside the buttons closes the menu
    this.els.menuSheet.addEventListener('click', (e) => { if (e.target === this.els.menuSheet) this.menu(false); });
  }

  // ---- tilt steering (DeviceOrientation; iOS asks for permission, needs HTTPS)
  private async toggleTilt(note: HTMLElement) {
    if (this.tiltOn) { this.tiltOn = false; this.input.touch.tilt = null; note.textContent = ''; return; }
    if (!isSecureContext) { note.textContent = 'Tilt steering needs the sim to be opened over HTTPS (the deployed site), not a local http:// address.'; return; }
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (DOE?.requestPermission) {
      try { if ((await DOE.requestPermission()) !== 'granted') { note.textContent = 'Motion access was not allowed (Settings → Safari → Motion & Orientation Access).'; return; } }
      catch { note.textContent = 'Motion access could not be requested.'; return; }
    }
    this.tiltOn = true; this.tilt0 = null;
    note.textContent = 'Tilt on: hold the iPad as you like and it becomes neutral. Tilt left/right to roll, top edge towards you to pull. Touching the stick pad still overrides.';
    this.sync();
  }

  private onOrientation(e: DeviceOrientationEvent) {
    if (e.beta === null || e.gamma === null) return;
    // "up" (against gravity) in device axes, then in screen axes for the current screen rotation
    const b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180;
    const ux = -Math.cos(b) * Math.sin(g), uy = Math.sin(b), uz = Math.cos(b) * Math.cos(g);
    const ang = ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) * Math.PI) / 180;
    const right = ux * Math.cos(ang) - uy * Math.sin(ang), up = ux * Math.sin(ang) + uy * Math.cos(ang);
    // roll: the right edge going down tilts "up" away from the screen's right axis; pitch: angle of the screen from flat (0 = flat, 90° = upright)
    this.tiltRaw = { roll: -Math.asin(clamp(right)), pitch: Math.atan2(up, uz) };
    if (!this.tiltOn) return;
    if (!this.tilt0) this.tilt0 = { ...this.tiltRaw };
    const dr = this.tiltRaw.roll - this.tilt0.roll;
    // top edge towards you = screen more upright than neutral (angle from flat grows) = pull = nose up
    const dp = this.tiltRaw.pitch - this.tilt0.pitch;
    this.input.touch.tilt = { x: expo(clamp(dr / (32 * Math.PI / 180))), y: expo(clamp(dp / (22 * Math.PI / 180))) * (this.tiltInvert ? -1 : 1) };
  }

  // ---- one finger on the scenery: look around; two fingers: zoom
  private setupLook() {
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0, acc = 0;
    const m = this.input.mouse;
    this.canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); m.dragging = pts.size === 1; pinch = 0; });
    this.canvas.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 1) { m.dx += (e.clientX - p.x) * 1.4; m.dy += (e.clientY - p.y) * 1.4; }
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) { acc += pinch - d; while (Math.abs(acc) > 28) { m.wheel += Math.sign(acc); acc -= Math.sign(acc) * 28; } }
        pinch = d;
      }
    });
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); m.dragging = false; pinch = 0; };
    this.canvas.addEventListener('pointerup', up); this.canvas.addEventListener('pointercancel', up);
    this.canvas.style.touchAction = 'none';
  }

  /** Reflect aircraft state on the buttons (call a few times a second). */
  sync() {
    const s = this.state(), E = this.els;
    E.park.classList.toggle('lit', s.parking);
    E.flapUp.textContent = `FLAPS ▲`; E.flapDn.textContent = `FLAPS ▼`;
    E.flapDn.dataset.v = ['UP', 'T/O', 'LDG'][s.flaps];
    E.gear.classList.toggle('hidden', s.gear === null);
    if (s.gear !== null) { E.gear.textContent = s.gear > 0.98 ? 'GEAR ⬇︎ down' : s.gear < 0.02 ? 'GEAR ⬆︎ up' : 'GEAR …'; E.gear.classList.toggle('lit', s.gear > 0.98); }
    E.engine.classList.toggle('lit', s.running);
    E.engine.textContent = s.running ? 'ENGINE stop' : 'ENGINE start';
    E.camera.textContent = `VIEW: ${s.view}`;
    const thr = this.els.thr;
    (thr.querySelector('.fill') as HTMLElement).style.height = `${s.throttle * 100}%`;
    (thr.querySelector('.knob') as HTMLElement).style.bottom = `calc(${s.throttle * 100}% - ${s.throttle * 40}px)`;
    (thr.querySelector('.lbl') as HTMLElement).textContent = s.throttle < 0.01 ? 'IDLE' : s.throttle > 0.99 ? 'FULL' : `${Math.round(s.throttle * 100)}%`;
    E.stick.querySelector('.lbl.s')!.textContent = this.tiltOn ? 'TILT · touch overrides' : 'STICK';
    E.m_tilt.textContent = `📱 Tilt steering: ${this.tiltOn ? 'ON' : 'OFF'}`;
    E.m_tiltInv.textContent = `⇅ Tilt pitch: ${this.tiltInvert ? 'inverted' : 'normal'}`;
    E.m_tiltCal.classList.toggle('hidden', !this.tiltOn); E.m_tiltInv.classList.toggle('hidden', !this.tiltOn);
    E.m_time.textContent = `Time: ${s.time}`;
    E.m_sound.textContent = `${s.sound ? '🔊' : '🔇'} Engine sound: ${s.sound ? 'on' : 'off'}`;
    E.m_voice.textContent = `${s.voice ? '🗣' : '🔇'} Controller voice: ${s.voice ? 'on' : 'off'}`;
    this.root.querySelectorAll<HTMLElement>('.twin').forEach((b) => b.classList.toggle('hidden', !s.twin));
  }
}

// Splash / loading screen (markup in index.html): progress bar, rotating tips, "Start flying" button.
import { wantsTouch } from './touch';

// [keyboard, touch] variants; one entry = same text for both
const TIPS: string[][] = [
  ['Radio first: press <b>Enter</b> to request taxi before you roll.', 'Radio first: tap <b>📻 CALL</b> to request taxi before you roll.'],
  ['Benešov circuits: RWY 24 right-hand, RWY 06 left-hand.'],
  ['Stop at the holding point and call ready for departure before you enter the runway.'],
  ['Flaps <b>T/O</b> for take-off, <b>LDG</b> on short final.'],
  ['Keep above 2500 ft over Tisem. There is a granny with a phone.'],
  ['Press <b>M</b> to cycle the map, up to a 60 km wide view.', 'Tap <b>MAP</b> to cycle the map, up to a 60 km wide view.'],
  ['Pick a <b>Direct to</b> airport for a magenta course line and a bearing pointer.'],
  ['Five airfields to visit: Benešov, Příbram, Vlašim, Praha Ruzyně and Karlovy Vary.'],
  ['Twin training: fail an engine in the P2006T with <b>U</b> / <b>I</b>.', 'Twin training: ☰ → Fail L/R engine in the P2006T.'],
  ['Use the rudder on the take-off roll and in turns.'],
  ['Press <b>H</b> any time for the full list of keys.', 'Tap <b>☰ → Help</b> for all the touch controls.'],
];

export class Splash {
  private el = document.getElementById('loading')!;
  private txt = document.getElementById('loadtxt')!;
  private pct = document.getElementById('loadpct')!;
  private bar = document.getElementById('loadbar')!;
  private tip = document.getElementById('loadtip')!;
  private f = 0;
  private tipTimer = 0;
  private touch = wantsTouch();

  constructor() {
    let i = Math.floor(Math.random() * TIPS.length);
    const show = () => { const t = TIPS[i++ % TIPS.length]; this.tip.innerHTML = t[this.touch ? t.length - 1 : 0]; };
    show();
    this.tipTimer = window.setInterval(() => {
      this.tip.classList.add('fade');
      setTimeout(() => { show(); this.tip.classList.remove('fade'); }, 400);
    }, 5200);
  }

  /** status line + optional overall fraction 0..1 (never goes backwards) */
  progress = (s: string, f?: number) => {
    this.txt.textContent = s;
    if (f === undefined) return;
    this.f = Math.max(this.f, Math.min(1, f));
    this.bar.style.width = `${(this.f * 100).toFixed(1)}%`;
    this.pct.textContent = `${Math.round(this.f * 100)} %`;
  };

  error(msg: string) {
    this.el.classList.add('error');
    this.txt.textContent = 'Error: ' + msg;
    clearInterval(this.tipTimer);
  }

  /** Loading finished: wait for a click / tap / key (also unlocks audio), then fade out. */
  ready(onStart: () => void) {
    this.progress('Ready for departure', 1);
    clearInterval(this.tipTimer);
    this.touch = this.touch || matchMedia('(pointer: coarse)').matches;
    document.getElementById('loadhint')!.textContent = this.touch ? 'or tap anywhere' : 'or press any key';
    this.el.classList.add('ready');
    let done = false;
    const go = (e: Event) => {
      if (e instanceof KeyboardEvent && (e.metaKey || e.ctrlKey || e.altKey || e.key === 'Tab')) return; // keep browser shortcuts
      // keep this key / tap away from the sim (Enter would make a radio call)
      e.stopPropagation(); e.preventDefault();
      if (done) return;
      done = true;
      removeEventListener('keydown', go, true);
      this.el.removeEventListener('pointerdown', go);
      onStart();
      this.el.classList.add('out');
      setTimeout(() => this.el.classList.add('hidden'), 950);
    };
    addEventListener('keydown', go, true);
    this.el.addEventListener('pointerdown', go);
  }
}

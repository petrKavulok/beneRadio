// Controller voice: speaks RADIO/TOWER/POLICE lines with the browser's built-in speech
// synthesis, converted to ICAO-style phraseology (phonetic registrations, digit-by-digit numbers).
const ALPHA: Record<string, string> = { A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu' };
const DIG = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const digits = (s: string) => s.split('').map((c) => (/\d/.test(c) ? DIG[+c] : c === 'L' ? 'left' : c === 'R' ? 'right' : c === 'C' ? 'centre' : c)).join(' ');

export function phraseology(text: string) {
  return text
    .replace(/[^\p{L}\p{N}\s.,:'\-–?!/()]/gu, '')               // emojis etc.
    .replace(/\b([A-Z]{1,2})-([A-Z]{3})\b/g, (_, a, b) => (a + b).split('').map((c: string) => ALPHA[c]).join(' '))
    .replace(/\brunway (\d{2}[LRC]?)\b/gi, (_, n) => `runway ${digits(n)}`)
    .replace(/\bQNH (\d{4})\b/g, (_, n) => `QNH ${digits(n)}`)
    .replace(/\bwind (\d{3}) degrees (\d+) knots/g, (_, d, k) => `wind ${digits(d)} degrees ${k} knots`)
    .replace(/\bAIR FORCE (\d{4})\b/g, (_, n) => `Air Force ${digits(n)}`)
    .replace(/\b([A-Z])(\d)?\b/g, (_, l: string, d?: string) => ALPHA[l] + (d ? ' ' + DIG[+d] : ''))   // taxiways A, C2, Q3 …
    .replace(/\bRADIO\b/g, 'Radio').replace(/\bTOWER\b/g, 'Tower').replace(/\bAČR\b/g, 'A Č R');
}

export class Voice {
  enabled = localStorage.getItem('lkbe.voice') !== 'off';
  private voice: SpeechSynthesisVoice | null = null;

  constructor() {
    if (!('speechSynthesis' in window)) { this.enabled = false; return; }
    const pick = () => {
      const vs = speechSynthesis.getVoices();
      this.voice = vs.find((v) => /en-GB/i.test(v.lang) && /male|daniel|arthur|george/i.test(v.name)) ?? vs.find((v) => /en-GB/i.test(v.lang)) ?? vs.find((v) => /^en/i.test(v.lang)) ?? null;
    };
    pick();
    speechSynthesis.onvoiceschanged = pick;
  }

  toggle() { this.enabled = !this.enabled; localStorage.setItem('lkbe.voice', this.enabled ? 'on' : 'off'); if (!this.enabled) speechSynthesis.cancel(); return this.enabled; }

  /** Speak a radio line if it comes from a ground station. */
  say(line: string) {
    if (!this.enabled || !('speechSynthesis' in window)) return;
    const m = line.match(/^(RADIO|TOWER|POLICE):\s*(.*)$/);
    if (!m) return;
    const u = new SpeechSynthesisUtterance(phraseology(m[2]));
    const police = m[1] === 'POLICE';
    u.voice = this.voice; // police speak English too, just deeper and slower
    u.lang = u.voice?.lang ?? 'en-GB';
    u.rate = police ? 0.92 : 1.08; u.pitch = police ? 0.7 : 0.95; u.volume = 0.9;
    speechSynthesis.speak(u);
  }
}

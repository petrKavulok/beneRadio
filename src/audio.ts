// Synthesised Rotax engine, wind, stall horn and tyre rumble (WebAudio, no assets).
export class Sound {
  private ctx: AudioContext | null = null;
  private eng!: OscillatorNode; private eng2!: OscillatorNode; private engGain!: GainNode; private engFilter!: BiquadFilterNode;
  private windGain!: GainNode; private windFilter!: BiquadFilterNode;
  private rumbleGain!: GainNode;
  private horn!: GainNode;
  private siren: { osc: OscillatorNode; gain: GainNode } | null = null;
  /** engine / prop / wind / tyre noise off (warning horns stay audible) */
  muted = localStorage.getItem('lkbe.sound') === 'off';
  toggle() { this.muted = !this.muted; localStorage.setItem('lkbe.sound', this.muted ? 'off' : 'on'); return !this.muted; }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const c = (this.ctx = new AudioContext());
    const master = c.createGain(); master.gain.value = 0.6; master.connect(c.destination);
    this.engFilter = c.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 2;
    this.engGain = c.createGain(); this.engGain.gain.value = 0;
    this.eng = c.createOscillator(); this.eng.type = 'sawtooth';
    this.eng2 = c.createOscillator(); this.eng2.type = 'square';
    const g2 = c.createGain(); g2.gain.value = 0.35;
    this.eng.connect(this.engFilter); this.eng2.connect(g2).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(master);
    this.eng.start(); this.eng2.start();
    // noise source shared by wind and rumble
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = c.createBufferSource(); noise.buffer = buf; noise.loop = true; noise.start();
    this.windFilter = c.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.Q.value = 0.6;
    this.windGain = c.createGain(); this.windGain.gain.value = 0;
    noise.connect(this.windFilter).connect(this.windGain).connect(master);
    const rf = c.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 140;
    this.rumbleGain = c.createGain(); this.rumbleGain.gain.value = 0;
    noise.connect(rf).connect(this.rumbleGain).connect(master);
    const hornOsc = c.createOscillator(); hornOsc.type = 'square'; hornOsc.frequency.value = 2900;
    this.horn = c.createGain(); this.horn.gain.value = 0;
    hornOsc.connect(this.horn).connect(master); hornOsc.start();
  }

  update(rpm: number, ias: number, stall: boolean, groundSpeed: number, onGround: boolean, cockpit: boolean) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime, k = 0.08;
    const m = this.muted ? 0 : 1;
    const fire = (rpm / 60) * 2; // 4-stroke flat-four firing frequency
    this.eng.frequency.setTargetAtTime(Math.max(fire, 1), t, k);
    this.eng2.frequency.setTargetAtTime(Math.max(rpm / 2.43 / 60 * 2, 1), t, k);
    this.engFilter.frequency.setTargetAtTime(300 + rpm * 0.25, t, k);
    this.engGain.gain.setTargetAtTime(m * (rpm > 200 ? 0.1 + 0.18 * Math.min(rpm / 5500, 1) : 0) * (cockpit ? 1 : 0.7), t, k);
    this.windFilter.frequency.setTargetAtTime(400 + ias * 18, t, k);
    this.windGain.gain.setTargetAtTime(m * Math.min(ias / 120, 1) * 0.25, t, k);
    this.rumbleGain.gain.setTargetAtTime(m * (onGround ? Math.min(groundSpeed / 25, 1) * 0.5 : 0), t, k);
    this.horn.gain.setTargetAtTime(stall ? 0.05 : 0, t, 0.02); // safety cue: never muted
  }

  /** Two-tone police siren; volume 0..1 (0 = off). Part of the sound effects (muted with O). */
  sirenLevel(vol: number, t: number) {
    const c = this.ctx; if (!c) return;
    if (!this.siren) {
      const osc = c.createOscillator(); osc.type = 'square';
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
      const gain = c.createGain(); gain.gain.value = 0;
      osc.connect(f).connect(gain).connect(c.destination); osc.start();
      this.siren = { osc, gain };
    }
    const hi = Math.floor(t * 1.6) % 2 === 0; // hi-lo, ~0.6 s per tone
    this.siren.osc.frequency.setTargetAtTime(hi ? 950 : 700, c.currentTime, 0.02);
    this.siren.gain.gain.setTargetAtTime(this.muted ? 0 : vol * 0.08, c.currentTime, 0.1);
  }

  thump(strength: number) {
    const c = this.ctx; if (!c || this.muted) return;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = 70; g.gain.value = Math.min(1, strength) * 0.7;
    g.gain.setTargetAtTime(0, c.currentTime, 0.08);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + 0.5);
  }
}

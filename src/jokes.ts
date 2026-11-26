// Local inside joke: the Tisem granny.
// Fly low over Tisem once → she calls the aerodrome and threatens to call the police.
// Do it again → the police are already waiting for you on the apron.
import type { AcState } from './lesson';

// Village centre / radius measured from the OSM buildings of Tisem (90 % within 364 m).
const TISEM = { x: -2603, z: -1693, r: 420 };
// The granny only minds you below circuit altitude (2460 ft AMSL, "2500" in local speak);
// a 60 ft tolerance so a pilot holding circuit altitude is left alone.
const MIN_ALT_FT = 2400;
const SAY_ALT_FT = 2500;

export type JokeStage = 0 | 1 | 2 | 3;

export class TisemGranny {
  stage: JokeStage = 0;
  private inside = false;
  private insideT = 0;
  private outsideT = 0;
  private talkedOnGround = false;

  constructor(
    private say: (...lines: string[]) => void,
    private callsign: () => string,
    private onPolice: () => void,
  ) {}

  reset() { this.stage = 0; this.inside = false; this.insideT = 0; this.outsideT = 0; this.talkedOnGround = false; this.leftAfterWarning = false; }

  /** true while the aircraft is low over the village */
  over(a: AcState) {
    return !a.onGround && a.altFt < MIN_ALT_FT && Math.hypot(a.x - TISEM.x, a.z - TISEM.z) < TISEM.r;
  }

  update(a: AcState, dt: number, onApron: boolean) {
    const cs = this.callsign();
    const now = this.over(a);
    if (now) { this.insideT += dt; this.outsideT = 0; } else { this.outsideT += dt; this.insideT = 0; }
    const entered = now && !this.inside;
    this.inside = now;

    if (this.stage === 0 && entered) {
      this.stage = 1;
      this.say(
        `RADIO: ${cs}, Benešov RADIO. The granny from Tisem just called again — you're buzzing her house and scaring the chickens.`,
        `RADIO: She says if you do it once more she's calling the police. Please keep clear of Tisem or stay at circuit altitude, ${SAY_ALT_FT} ft.`,
      );
    } else if (this.stage === 1 && ((entered && this.leftAfterWarning) || this.insideT > 45)) {
      this.stage = 2;
      this.onPolice();
      this.say(
        `RADIO: ${cs}... she did it. The police are already at the airfield — they'll be waiting for you on the apron.`,
        `RADIO: Good luck with the landing. And bring your licence.`,
      );
    }
    if (this.stage === 1 && !now && this.outsideT > 8) this.leftAfterWarning = true;

    if (this.stage === 2 && a.onGround && onApron && a.gs < 1 && !this.talkedOnGround) {
      this.talkedOnGround = true;
      this.stage = 3;
      this.say(`POLICE: Good afternoon, ${cs}. Licence and papers please. A lady from Tisem would like a word with you. 👮`);
    }
  }
  private leftAfterWarning = false;
}

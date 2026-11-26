export const HELP_HTML = `
<h2>Tecnam P2002 / P2006T trainer – LKBE · LKPM · LKVL · LKPR</h2>
<p>Pick your <b>Start</b> airport at the bottom: LKBE Benešov, LKPM Příbram, LKVL Vlašim or LKPR Praha (controlled – TOWER clearances). You can fly anywhere in Czechia: the airports are detailed islands (5 m terrain, 1 m photo), everything else streams in as you fly. To land at another airport, just line up on its final.<br>Real terrain (ČÚZK DMR 5G + Terrarium elevation), real orthophoto (ČÚZK), villages from OpenStreetMap / OpenFreeMap.
Fun physics – roughly P2002-like, not a certified simulator.</p>
<table>
<tr><td>E</td><td>Start / stop engine</td></tr>
<tr><td>W / S  (0 / 1)</td><td>Throttle up / down (full / idle)</td></tr>
<tr><td>↑ / ↓</td><td>Stick forward (nose down) / back (nose up)</td></tr>
<tr><td>← / →</td><td>Roll left / right</td></tr>
<tr><td>A / D  (Z / X)</td><td>Rudder + nose-wheel steering</td></tr>
<tr><td>Space or B</td><td>Brakes (hold) · <b>,</b> / <b>.</b> = left / right brake</td></tr>
<tr><td>P</td><td>Parking brake</td></tr>
<tr><td>F / R</td><td>Flaps down / up (UP → T/O 15° → LDG 40°)</td></tr>
<tr><td>G / T  ([ / ], PgDn / PgUp)</td><td>Elevator trim nose down / up – same keys on every aircraft</td></tr>
<tr><td>Shift + G</td><td>Landing gear up / down (P2006T) – 3 greens = down &amp; locked</td></tr>
<tr><td>U / I</td><td>Fail / restore left / right engine (P2006T training)</td></tr>
<tr><td>Y</td><td>Mouse yoke on/off (mouse position = stick)</td></tr>
<tr><td>Enter</td><td>Radio call (request taxi, ready for departure, vacated)</td></tr>
<tr><td>V</td><td>Controller voice on / off (the controller also calls you if you don't follow instructions)</td></tr>
<tr><td>O</td><td>Engine sound on / off (stall &amp; gear warning horns stay on) – also the 🔊 / 🗣 buttons at the bottom</td></tr>
<tr><td>C</td><td>Camera: cockpit → chase → tower · drag mouse to look · wheel = zoom</td></tr>
<tr><td>M</td><td>Map: small → big → wide (60 km) → small</td></tr>
<tr><td>Direct to</td><td>(bottom bar) pick an airport: magenta course line on the map, bearing pointer on the heading indicator, marker in the 3D view, distance / course / ETE</td></tr>
<tr><td>L</td><td>Village name labels</td></tr>
<tr><td>N</td><td>Next parking stand</td></tr>
<tr><td>K</td><td>New lesson (new wind, runway in use)</td></tr>
<tr><td>Backspace</td><td>Restart at the stand</td></tr>
<tr><td>Esc</td><td>Pause</td></tr>
<tr><td>H</td><td>This help</td></tr>
</table>
<p><b>P2006T:</b> rotate 65 kt · Vy 83 · Vyse 82 (blue line) · Vmc 62 (red line) · approach 75 kt · Vfe 93. Engine failure: pitch for the blue line, rudder on the live engine, bank 3–5° towards it.</p>
<p><b>P2002 speeds:</b> rotate 50 kt · Vx 60 · Vy 66 · approach 60 kt (flaps LDG) · Vfe 70 · Vne 145 · stall ~42–47 kt.
Circuit altitude 2460 ft AMSL (field 1322 ft). RWY 06 & 09 left-hand, 24 & 27 right-hand circuits.</p>
<p style="opacity:.7">Data: orthophoto &amp; DMR 5G elevation © ČÚZK (CC BY 4.0) · elevation tiles © Mapzen/Terrarium (AWS Open Data) · buildings, forests, places © OpenStreetMap contributors (ODbL), vector tiles OpenFreeMap · aerodrome chart: ŘLP ČR VFR Manual · Tecnam P2002 Sierra 3D model © Emmanuel Baranger (helijah), FlightGear FGAddon, GPL v2+.<br>Not for real-world navigation or training credit. Holding point positions are approximate.</p>
<p>Press <b>H</b> to close.</p>
`;

import { inject } from '@vercel/analytics';

import * as THREE from 'three';
import { injectSpeedInsights } from '@vercel/speed-insights';
import { GeoData } from './world/data';
import { buildTerrain, groundOverlay } from './world/terrain';
import { paintAirportGround } from './world/airfield-ground';
import { StreamedTerrain } from './world/stream';
import { StreamedVillages } from './world/stream-buildings';
import { loadAirports, ISLAND_IDS } from './airport/registry';
import type { Airport } from './airport/types';
import { buildBuildings, obstacleIndex, Bld } from './world/buildings';
import { buildEnvironment, TIME_OPTIONS, TimeOfDay } from './world/env';
import { buildAirfield } from './airport/objects';
import { Aircraft, Env } from './sim/fdm';
import { P2002 } from './sim/p2002';
import { P2006T } from './sim/p2006t';
import type { AircraftParams } from './sim/fdm';
import { makeVisual, AircraftVisual, VisualId, VISUAL_OPTIONS, LIVERIES, SCHOOL, livreg } from './models/visuals';
import { P2006T_LIVERIES } from './models/p2006t-visual';
import { Input } from './sim/input';
import { CameraRig } from './camera';
import { Panel } from './ui/panel';
import { MovingMap, Place } from './ui/map';
import { Hud } from './ui/hud';
import { Sound } from './audio';
import { Lesson, AcState } from './lesson';
import { TisemGranny } from './jokes';
import { AtcMonitor } from './atc-monitor';
import { Voice } from './voice';
import { buildPoliceCar, PoliceChase } from './world/police';
import { HELP_HTML, TOUCH_HELP_HTML } from './ui/help';
import { TouchControls, wantsTouch, touchify } from './ui/touch';
import { navTo, fmtBrg } from './nav';
import { Splash } from './ui/splash';
import { report } from './ui/report';
import { LOW_MEM } from './quality';
import { runJobs, pendingJobs, jobTimes } from './world/budget';
import { freeAfterUpload } from './world/free-geometry';
import { addAircraftLights, AircraftLights } from './models/lights';

inject();

// Initialize Vercel Speed Insights
injectSpeedInsights();

const $ = (id: string) => document.getElementById(id)!;
const splash = new Splash();
const progress = splash.progress;

async function main() {
  const canvas = $('gl') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW_MEM, logarithmicDepthBuffer: true, powerPreference: LOW_MEM ? 'low-power' : 'high-performance' });
  let pixelRatio = Math.min(devicePixelRatio, LOW_MEM ? 1.25 : 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 120000);
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  });

  progress('Warming up the engine…', 0.02);
  // phones: only the start airport's detail island (plus the LKBE area) – all five don't fit in iOS memory
  const startWanted = localStorage.getItem('lkbe.start') ?? 'LKBE';
  const loadIslands = LOW_MEM ? ISLAND_IDS.filter((id) => id === startWanted) : ISLAND_IDS;
  const geo = await GeoData.load(progress, loadIslands);
  const env = buildEnvironment(scene, renderer);
  progress('Loading orthophoto tiles (ČÚZK)…', 0.12);
  const terrain = await buildTerrain(geo, renderer, progress);
  scene.add(terrain.group);
  progress('Loading airports…', 0.74);
  const airports = await loadAirports();
  progress('Building villages…', 0.8);
  const base = import.meta.env.BASE_URL + 'data/';
  const json = <T,>(f: string) => fetch(base + f).then((r) => (r.ok ? (r.json() as Promise<T>) : ([] as unknown as T)));
  const regionDirs = geo.regions.map((r) => r.dir);
  const bldSets = await Promise.all(regionDirs.map((d) => json<Bld[]>(d + 'buildings.json')));
  const placeSets = await Promise.all(regionDirs.map((d) => json<Place[]>(d + 'places.json')));
  const seen = new Set<string>();
  const places = placeSets.flat().filter((p) => { const k = p.n + Math.round(p.x / 500) + ',' + Math.round(p.z / 500); if (seen.has(k)) return false; seen.add(k); return true; });
  const blds = bldSets.flat();
  progress('Painting the airfields…', 0.86);
  const groundCanvases: { img: CanvasImageSource; x0: number; z0: number; x1: number; z1: number; ring: number }[] = [];
  for (const ap of airports) {
    const reg = geo.region(ap.centre[0], ap.centre[1]);
    if (!reg) continue;
    const photo = terrain.mapTiles.filter((t) => ap.centre[0] > t.x0 && ap.centre[0] < t.x1 && ap.centre[1] > t.z0 && ap.centre[1] < t.z1).sort((a, b) => a.ring - b.ring)[0];
    const near = blds.filter((b) => Math.hypot(b.p[0] - ap.centre[0], b.p[1] - ap.centre[1]) < 4000);
    const gnd = paintAirportGround(ap, near, photo);
    const ov = groundOverlay(reg.id);
    ov.map.value = gnd.texture;
    ov.box.value.set(gnd.box.x0, gnd.box.z0, gnd.box.x1 - gnd.box.x0, gnd.box.z1 - gnd.box.z0);
    groundCanvases.push({ img: gnd.canvas, ...gnd.box, ring: -1 });
  }
  bldSets.forEach((set) => { const g = buildBuildings(geo, set); freeAfterUpload(g); scene.add(g); });
  const hitsBuilding = obstacleIndex(blds, 1800, airports.map((a) => a.centre));
  // airport objects only where the detail ground is loaded (on phones other airfields are streamed scenery only)
  const airfields = airports.filter((ap) => geo.region(ap.centre[0], ap.centre[1])).map((ap) => buildAirfield(geo, ap));
  airfields.forEach((a) => scene.add(a.group));
  // Czech-wide streamed terrain outside the baked islands
  const stream = new StreamedTerrain(renderer, geo.islandRects(), null);
  scene.add(stream.group);
  geo.stream = stream;
  stream.edgeHeight = (x, z) => { const r = geo.region(x, z); return r ? r.heightAt(x, z) : 400; };
  const villages = new StreamedVillages(geo, geo.islandRects(), places, (x, z) => stream.heightAt(x, z) !== null);
  scene.add(villages.group);
  let navAp: Airport | null = null;
  let startAp: Airport = airports.find((a) => a.icao === localStorage.getItem('lkbe.start')) ?? airports[0];

  // Aircraft visuals (player + parked), switchable: detailed FlightGear P2002 or the original simple model.
  progress('Rolling the Tecnams out of the hangar…', 0.92);
  const PARKED: [number, number, number, string][] = [[-246, 342, 10, 'Classic-Blue'], [-110, 348, -5, 'orange'], [-70, 340, 175, 'Blue-Yellow']];
  // the simple P2002 is hidden from the menu (it stays only as the fallback if the detailed model fails to load)
  let visualId = (localStorage.getItem('lkbe.visual') as VisualId) || 'detailed';
  if (visualId === 'simple') visualId = 'detailed';
  const isTwin = () => visualId === 'p2006t';
  const paramsFor = (): AircraftParams => (isTwin() ? P2006T : P2002);
  const liveriesFor = () => (isTwin() ? P2006T_LIVERIES : LIVERIES);
  const liveryKey = () => (isTwin() ? 'lkbe.livery.p2006t' : 'lkbe.livery');
  let livery = localStorage.getItem(liveryKey()) || liveriesFor()[0];
  livreg.reg = localStorage.getItem('lkbe.reg') || 'OK-SIM';
  livreg.military = localStorage.getItem('lkbe.serial') || '0731';
  let visual: AircraftVisual;
  let parked: AircraftVisual[] = [];
  /** time of day from the bottom bar or the touch menu (remembered) */
  const setTime = (t: TimeOfDay) => {
    env.setTime(t); localStorage.setItem('lkbe.time', env.time);
    const sel = document.getElementById('selTime') as HTMLSelectElement | null;
    if (sel) sel.value = env.time;
  };
  let acLights: AircraftLights;
  async function loadVisuals() {
    if (visual) scene.remove(visual.root);
    parked.forEach((p) => scene.remove(p.root));
    visual = await makeVisual(visualId, livery);
    acLights = addAircraftLights(visual.root);
    scene.add(visual.root);
    parked = await Promise.all(PARKED.map(([, , , l]) => makeVisual(isTwin() ? 'detailed' : visualId, l)));
    parked.forEach((p, i) => {
      const [x, z, h] = PARKED[i];
      p.root.position.set(x, geo.heightAt(x, z) + P2002.restHeight, z);
      p.root.rotation.y = -h * Math.PI / 180;
      p.animate(input.c0, 0, 0, 0, false);
      scene.add(p.root);
    });
  }
  let ac = new Aircraft(paramsFor());
  const input = new Input(canvas);
  await loadVisuals();
  setupPicker();
  const wind = new THREE.Vector3();
  const fdmEnv: Env = { heightAt: (x, z) => geo.heightAt(x, z), surfaceAt: (x, z) => geo.surfaceAt(x, z), hitsBuilding, wind };
  let standIdx = 1;
  const place = () => {
    const s = startAp.stands[standIdx % startAp.stands.length];
    // make sure streamed/baked ground is there before placing
    stream.update(new THREE.Vector3(s.pos[0], geo.heightAt(s.pos[0], s.pos[1]) + 50, s.pos[1]), geo.heightAt(s.pos[0], s.pos[1]));
    ac.place(s.pos[0], s.pos[1], s.hdg, fdmEnv);
    ac.running = false; ac.rpm = 0;
    Object.assign(input.c, { throttle: 0, parking: true, flaps: 0, trim: 0.15, elevator: 0, aileron: 0, rudder: 0, gearDown: true });
  };
  place();

  const lesson = new Lesson(airports, startAp);
  const callsign = () => (isTwin() && livery === 'CZ-Military' ? `CZECH AIR FORCE ${livreg.military}` : livreg.reg);
  lesson.callsign = callsign();
  lesson.aircraft = ac.A;
  // Inside joke: the Tisem granny (and the police waiting on the apron)
  const police = buildPoliceCar();
  scene.add(police.car);
  const chase = new PoliceChase(police.car, (x, z) => geo.heightAt(x, z));
  const POLICE_HOME: [number, number, number] = [-172, 343, 0.15];
  chase.park(...POLICE_HOME);
  let busted = false, bustedT = 0;
  const granny = new TisemGranny((...l) => lesson.radio(...l), () => lesson.callsign, () => { police.car.visible = true; chase.park(...POLICE_HOME); });
  const getBusted = () => {
    busted = true; bustedT = 0;
    ac.stopEngine(); ac.vel.set(0, 0, 0); ac.omega.set(0, 0, 0);
    document.body.classList.add('busted');
    $('busted').classList.remove('hidden');
    ($('busted').querySelector('.sub') as HTMLElement).textContent = 'Fine: 5 000 CZK · the granny from Tisem pressed charges';
    if (rig.view === 'cockpit') rig.next();
    lesson.radio(`POLICE: ${lesson.callsign}, police! Shut down the engine and step out of the aircraft. You flew low over Tisem twice – you are under arrest.`);
    lesson.score.push('👮 BUSTED – caught by the police at LKBE');
  };
  const atc = new AtcMonitor(lesson);
  const voice = new Voice();
  lesson.onSay = (l) => voice.say(l);
  atc.onAlert = () => { const el = $('radio'); el.classList.remove('alert'); void el.offsetWidth; el.classList.add('alert'); };
  const resetJoke = () => {
    granny.reset(); police.car.visible = false; atc.reset(); chase.park(...POLICE_HOME);
    busted = false; document.body.classList.remove('busted'); $('busted').classList.add('hidden'); sound.sirenLevel(0, 0);
  };
  // touch: tap the radio strip to clear the messages currently shown
  const radioGone = new Set<string>();
  let radioNow: string[] = [];
  $('radio').addEventListener('pointerdown', () => { radioNow.forEach((t) => radioGone.add(t)); $('radio').style.display = 'none'; });
  lesson.onRadio = (all) => {
    const el = $('radio');
    const lines = document.body.classList.contains('touch') ? all.filter((l) => !radioGone.has(l.text)) : all;
    radioNow = lines.map((l) => l.text);
    if (radioGone.size > 50) radioGone.clear();
    el.style.display = lines.length ? 'block' : 'none';
    el.innerHTML = lines.map((l) => `<div style="opacity:${l.alpha.toFixed(2)}"${l.tag ? ' class="warn"' : ''}>${l.text.replace(/^(\S+:)/, '<b>$1</b>')}</div>`).join('');
  };
  const rig = new CameraRig(camera, (x, z) => geo.heightAt(x, z));
  const panel = new Panel($('panel') as HTMLCanvasElement);
  const map = new MovingMap($('map') as HTMLCanvasElement, () => [...stream.mapTiles(), ...terrain.mapTiles, ...groundCanvases], places, airports);
  rig.tower = startAp.tower;
  const hud = new Hud($('hud') as HTMLCanvasElement, places, geo);
  const sound = new Sound();
  syncAudioButtons();
  $('help').innerHTML = HELP_HTML;
  let paused = false, showLabels = true;

  // iPad / touch layout: on for touch devices, or as soon as the screen is touched
  let touch: TouchControls | null = null;
  const enableTouch = () => {
    if (touch) return;
    // lesson box: tap to fold it into a small pill (remembered)
    const msg = $('msg');
    msg.classList.toggle('folded', localStorage.getItem('lkbe.msgFolded') === '1');
    msg.addEventListener('pointerdown', () => { msg.classList.toggle('folded'); localStorage.setItem('lkbe.msgFolded', msg.classList.contains('folded') ? '1' : '0'); });
    touch = new TouchControls(input, canvas, () => ({
      parking: input.c.parking, flaps: input.c.flaps, gear: ac.A.retractable ? ac.gearPos : null, running: ac.running || ac.starting > 0,
      throttle: input.c.throttle, trim: input.c.trim, view: rig.view, paused, time: TIME_OPTIONS.find((o) => o.id === env.time)!.label, twin: ac.eng.length > 1, sound: !sound.muted, voice: voice.enabled,
    }));
    touch.onPicker = (show) => document.body.classList.toggle('picker', show);
    $('picker').insertAdjacentHTML('beforeend', '<button class="tgl" id="pickDone">✓ Done</button>');
    $('pickDone').onclick = () => { document.body.classList.remove('picker'); touch?.closePicker(); };
    touch.onPause = () => input.fire('pause');
    touch.onReport = () => report.show();
    touch.onTime = () => { const i = TIME_OPTIONS.findIndex((o) => o.id === env.time); setTime(TIME_OPTIONS[(i + 1) % TIME_OPTIONS.length].id); };
    $('help').innerHTML = TOUCH_HELP_HTML + HELP_HTML.replace(/^\s*<h2>.*?<\/h2>/s, '');
    $('help').insertAdjacentHTML('afterbegin', HELP_HTML.match(/<h2>.*?<\/h2>/s)![0]);
    $('help').addEventListener('click', () => { if (!$('help').classList.contains('hidden')) input.fire('help'); });
    touch.sync();
  };
  if (wantsTouch()) enableTouch(); else addEventListener('touchstart', enableTouch, { once: true });
  let panelFrac = 0;

  input.on((a) => {
    sound.start();
    const st = acState();
    switch (a) {
      case 'engine': ac.running || ac.starting > 0 ? ac.stopEngine() : ac.startEngine(); break;
      case 'camera': rig.next(); break;
      case 'map': map.toggle(); break;
      case 'labels': showLabels = !showLabels; break;
      case 'reset': place(); lesson.reset(); resetJoke(); break;
      case 'nextStand': standIdx = (standIdx + 1) % startAp.stands.length; place(); lesson.reset(); resetJoke(); break;
      case 'lesson': place(); lesson.newWeather(); lesson.reset(); resetJoke(); break;
      case 'help': $('help').classList.toggle('hidden'); break;
      case 'pause': paused = !paused; if (!$('help').classList.contains('hidden')) { $('help').classList.add('hidden'); paused = false; } break;
      case 'ready': lesson.call(st); break;
      case 'voice': voice.toggle(); syncAudioButtons(); break;
      case 'sound': sound.toggle(); syncAudioButtons(); break;
      case 'gear': if (ac.A.retractable) input.c.gearDown = !(input.c.gearDown ?? true); break;
      case 'failL': if (ac.eng.length > 1) ac.toggleFailure(0); break;
      case 'failR': if (ac.eng.length > 1) ac.toggleFailure(1); break;
    }
  });

  function syncAudioButtons() {
    const b1 = document.getElementById('btnSound'), b2 = document.getElementById('btnVoice');
    if (b1) { b1.textContent = sound.muted ? '🔇 Engine' : '🔊 Engine'; b1.classList.toggle('off', sound.muted); }
    if (b2) { b2.textContent = voice.enabled ? '🗣 Voice' : '🔇 Voice'; b2.classList.toggle('off', !voice.enabled); }
  }

  function setupPicker() {
    const pick = $('picker');
    pick.innerHTML = `<label>Aircraft <select id="selVisual">${VISUAL_OPTIONS.filter((o) => o.id !== 'simple').map((o) => `<option value="${o.id}">${o.label}</option>`).join('')}</select></label>
      <label>Livery <select id="selLivery">${LIVERIES.map((l) => `<option value="${l}">${l === SCHOOL ? 'Bene' : l === 'Hot-Rod-Flames' ? '🔥 Hot Rod Flames' : l}</option>`).join('')}</select></label>
      <label>Reg <input id="inReg" maxlength="8" size="7" spellcheck="false"></label>
      <label>Start <select id="selStart">${airports.map((a) => `<option value="${a.icao}">${a.icao} ${a.name}</option>`).join('')}</select></label>
      <label>Time <select id="selTime">${TIME_OPTIONS.map((o) => `<option value="${o.id}">${o.label}</option>`).join('')}</select></label>
      <label>Direct to <select id="selNav"><option value="">—</option>${airports.map((a) => `<option value="${a.icao}">${a.icao}</option>`).join('')}</select></label>
      <button id="btnSound" class="tgl" title="Engine sound on/off (O)"></button>
      <button id="btnVoice" class="tgl" title="Controller voice on/off (V)"></button>
      <button id="btnReport" class="tgl" title="Report a problem with the app">🐞 Report</button>`;
    const st = $('selTime') as HTMLSelectElement;
    st.value = env.time;
    st.onchange = () => { setTime(st.value as TimeOfDay); st.blur(); };
    const sn = $('selNav') as HTMLSelectElement;
    sn.onchange = () => {
      navAp = airports.find((a) => a.icao === sn.value) ?? null; sn.blur();
      if (navAp) { const n = navTo(navAp, ac.pos.x, ac.pos.z, 0)!; lesson.radio(`${lesson.callsign}: navigating direct ${navAp.icao} ${navAp.name}, course ${fmtBrg(n.brgMag)}, ${n.distNm.toFixed(0)} NM.`); }
    };
    $('btnSound').onclick = (e) => { sound.start(); sound.toggle(); syncAudioButtons(); (e.currentTarget as HTMLElement).blur(); };
    $('btnReport').onclick = (e) => { (e.currentTarget as HTMLElement).blur(); report.show(); };
    $('btnVoice').onclick = (e) => { voice.toggle(); syncAudioButtons(); (e.currentTarget as HTMLElement).blur(); };
    const ss = $('selStart') as HTMLSelectElement;
    ss.value = startAp.icao;
    ss.onchange = () => {
      startAp = airports.find((a) => a.icao === ss.value) ?? airports[0];
      localStorage.setItem('lkbe.start', startAp.icao); ss.blur();
      // phones load only the start airport's area: reload to fetch the new one
      if (!geo.region(startAp.centre[0], startAp.centre[1])) { location.reload(); return; }
      standIdx = Math.min(1, startAp.stands.length - 1);
      lesson.setAirport(startAp); lesson.reset(); resetJoke(); place();
    };
    const sv = $('selVisual') as HTMLSelectElement, sl = $('selLivery') as HTMLSelectElement;
    const ir = $('inReg') as HTMLInputElement;
    const label = (l: string) => (l === SCHOOL ? 'Bene' : l === 'Hot-Rod-Flames' ? '🔥 Hot Rod Flames' : l === 'CZ-Military' ? '🎖 Czech Air Force (grey)' : l.replace(/_/g, ' '));
    const fillLiveries = () => { sl.innerHTML = liveriesFor().map((l) => `<option value="${l}">${label(l)}</option>`).join(''); sl.value = livery; };
    const fillReg = () => { ir.value = isTwin() ? livreg.military : livreg.reg; ir.maxLength = isTwin() ? 4 : 8; };
    fillLiveries(); fillReg();
    sv.value = visualId;
    ir.onchange = async () => {
      if (isTwin()) { livreg.military = ir.value.replace(/\D/g, '').slice(0, 4).padStart(4, '0') || '0731'; localStorage.setItem('lkbe.serial', livreg.military); }
      else { livreg.reg = ir.value.trim().toUpperCase() || 'OK-SIM'; localStorage.setItem('lkbe.reg', livreg.reg); }
      fillReg(); ir.blur(); lesson.callsign = callsign();
      if (isTwin()) visual.setLivery(livery, livreg.military);
      else if (livery === SCHOOL || livery === 'Hot-Rod-Flames') { if (visualId === 'detailed') visual.setLivery(livery); else await loadVisuals(); }
    };
    sv.onchange = async () => {
      const wasTwin = isTwin();
      visualId = sv.value as VisualId; localStorage.setItem('lkbe.visual', visualId); sv.blur();
      if (wasTwin !== isTwin()) {
        livery = localStorage.getItem(liveryKey()) || liveriesFor()[0];
        fillLiveries(); fillReg();
        ac = new Aircraft(paramsFor()); lesson.aircraft = ac.A; place(); lesson.reset(); resetJoke();
        rig.dist = isTwin() ? 17 : 13;
        input.c.gearDown = true;
      }
      lesson.callsign = callsign();
      await loadVisuals();
    };
    sl.onchange = async () => {
      livery = sl.value; localStorage.setItem(liveryKey(), livery); sl.blur(); lesson.callsign = callsign();
      if (visualId === 'detailed' || isTwin()) visual.setLivery(livery, livreg.military); else await loadVisuals();
    };
  }

  function acState(): AcState {
    const g = geo.heightAt(ac.pos.x, ac.pos.z);
    return {
      x: ac.pos.x, z: ac.pos.z, hdg: ac.heading(), ias: ac.ias * 1.944, gs: Math.hypot(ac.vel.x, ac.vel.z) * 1.944,
      altFt: ac.pos.y * 3.281, aglFt: (ac.pos.y - g - ac.A.restHeight) * 3.281, onGround: ac.onGround,
      running: ac.running, parking: input.c.parking, touchdownVs: ac.touchdownVs, crashed: ac.crashed,
    };
  }

  (window as unknown as { sim: unknown }).sim = { pendingJobs, jobTimes, env, ac, input, lesson, atc, chase, get busted() { return busted; }, voice, geo, rig, scene, granny, police, stream, villages, airports, renderer, camera, get visual() { return visual; } };
  let started = false;
  report.setContext(() => ({
    Airport: lesson.ap.icao, Aircraft: visualId, Livery: livery, Phase: lesson.phase, 'Time of day': env.time, View: rig.view,
    FPS: (window as unknown as { simFps?: number }).simFps, 'Pixel ratio': renderer.getPixelRatio(), Shadows: renderer.shadowMap.enabled,
    Position: `x ${Math.round(ac.pos.x)} z ${Math.round(ac.pos.z)} · ${Math.round(ac.pos.y * 3.281)} ft · ${Math.round(ac.ias * 1.944)} kt`,
    'Engine running': ac.running, Crashed: ac.crashed,
  }));
  // big Restart button after a crash or an arrest
  const restartBtn = $('restartBtn');
  restartBtn.addEventListener('click', (e) => { (e.currentTarget as HTMLElement).blur(); input.fire('reset'); });
  splash.ready(() => { started = true; sound.start(); });
  const clock = new THREE.Timer();
  let fpsAcc = 0, fpsN = 0;
  let acc = 0, t = 0, panelT = 0, lastOnGround = true;
  const STEP = 1 / 240;

  renderer.setAnimationLoop(() => {
    clock.update();
    const dt = Math.min(clock.getDelta(), 0.1);
    // adaptive quality: drop resolution / shadows if the GPU struggles
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 3) {
      const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
      if (fps > 8 && fps < 28 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); }
      else if (fps > 8 && fps < 28 && renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; }
      (window as unknown as { simFps: number }).simFps = Math.round(fps);
    }
    if (busted) { bustedT += dt; }
    restartBtn.classList.toggle('hidden', !(started && (busted || ac.crashed)));
    if (started && !paused && !busted && !report.open && $('help').classList.contains('hidden')) {
      t += dt;
      input.update(dt);
      // wind with gusts, from lesson weather
      const gust = 1 + 0.18 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1);
      const to = (lesson.windFrom + 180) * Math.PI / 180;
      wind.set(Math.sin(to), 0, -Math.cos(to)).multiplyScalar(lesson.windKt * 0.5144 * gust * (ac.pos.y - geo.heightAt(ac.pos.x, ac.pos.z) < 10 ? 0.8 : 1));
      acc += dt;
      while (acc >= STEP) { ac.step(STEP, input.c, fdmEnv); acc -= STEP; }
      if (ac.onGround && !lastOnGround) sound.thump(ac.touchdownVs / 2);
      lastOnGround = ac.onGround;
      const st0 = acState();
      atc.update(st0, dt);
      lesson.tickRadio(dt);
      lesson.update(st0, dt);
      granny.update(st0, dt, false); // the old "papers please" on the apron is replaced by the chase
      if (police.car.visible && granny.stage >= 2) {
        if (chase.update(dt, { x: ac.pos.x, z: ac.pos.z, aglFt: st0.aglFt, onGround: ac.onGround, gsKt: st0.gs })) getBusted();
      }
    }
    // mouse look / zoom
    if (input.mouse.dragging && !input.mouseYoke) rig.look(input.mouse.dx, input.mouse.dy);
    input.mouse.dx = input.mouse.dy = 0;
    if (input.mouse.wheel) { rig.zoom(input.mouse.wheel); input.mouse.wheel = 0; }

    visual.root.position.copy(ac.pos); visual.root.quaternion.copy(ac.quat);
    visual.animate(input.c, ac.rpm, dt, Math.hypot(ac.vel.x, ac.vel.z), rig.view === 'cockpit', { gearPos: ac.gearPos, rpms: ac.eng.map((e) => e.rpm) });
    {
      const gnd = geo.heightAt(ac.pos.x, ac.pos.z);
      acLights.update(dt, { running: ac.running || ac.starting > 0, onGround: ac.onGround, gsKt: Math.hypot(ac.vel.x, ac.vel.z) * 1.944, aglFt: (ac.pos.y - gnd - ac.A.restHeight) * 3.281 });
    }
    rig.eye.copy(visual.eye);
    rig.update(dt, ac.pos, ac.quat, ac.heading());
    env.follow(ac.pos);
    airfields.forEach((a) => a.updateWindsocks(lesson.windFrom, lesson.windKt, t));
    const camGround = geo.heightAt(camera.position.x, camera.position.z);
    stream.update(camera.position, camGround);
    villages.update(camera.position, dt, camera.position.y - camGround);
    runJobs(LOW_MEM ? 3 : 5); // finish streamed tiles a few ms per frame (no hitches)
    const nearAp = airports.reduce((b, a) => (Math.hypot(a.centre[0] - ac.pos.x, a.centre[1] - ac.pos.z) < Math.hypot(b.centre[0] - ac.pos.x, b.centre[1] - ac.pos.z) ? a : b));
    rig.tower = nearAp.tower;
    police.update(t);
    sound.sirenLevel(police.car.visible && (chase.active || busted) ? (busted ? Math.max(0, 1 - bustedT / 6) : 1) / (1 + chase.distanceTo(camera.position.x, camera.position.z) / 250) : 0, t);
    env.sky.position.copy(camera.position);
    renderer.render(scene, camera);

    const st = acState();
    const nav = navTo(navAp, ac.pos.x, ac.pos.z, st.gs);
    const gearHorn = ac.A.retractable && !ac.onGround && ac.gearPos < 0.98 && (input.c.throttle < 0.2 || input.c.flaps === 2) && st.aglFt < 1000;
    sound.update(ac.rpm, st.ias, (ac.stall && !ac.onGround) || (gearHorn && Math.floor(t * 2.5) % 2 === 0), st.gs, ac.onGround, rig.view === 'cockpit');
    panelT -= dt;
    if (panelT <= 0) {
      panelT = 1 / 30;
      const e = ac.euler();
      panel.draw({
        iasKt: st.ias, altFt: st.altFt, vsFpm: ac.vs * 196.85, hdgMag: (st.hdg - 5 + 360) % 360,
        pitch: e.x, bank: -e.z, turnRate: ac.turnGyro, slip: (ac.ball / 0.26) * 0.36, rpm: ac.rpm, throttle: input.c.throttle, flaps: input.c.flaps,
        trim: input.c.trim, parking: input.c.parking, brakes: input.c.brakeL + input.c.brakeR > 0, running: ac.running,
        stall: ac.stall && !ac.onGround, qnh: lesson.qnh,
        stick: { x: input.c.aileron, y: input.c.elevator, rudder: input.c.rudder },
        speeds: ac.A.speeds, rpms: ac.eng.map((e) => e.rpm), engOk: ac.eng.map((e) => e.running), gear: ac.A.retractable ? ac.gearPos : null, navBrg: nav ? nav.brgMag : null,
      }, rig.view === 'cockpit' ? 0.27 : 0.19);
      const frac = rig.view === 'cockpit' ? 0.27 : 0.19;
      if (frac !== panelFrac) { panelFrac = frac; document.documentElement.style.setProperty('--ph', `${frac * 100}vh`); }
      touch?.sync();
      map.draw({ x: ac.pos.x, z: ac.pos.z, hdg: st.hdg }, st.aglFt < 150, lesson.route, lesson.target, nav);
      let lessonHtml = touch ? touchify(lesson.text(st)) : lesson.text(st);
      if (touch) { const i = lessonHtml.indexOf('\n\n'); if (i > 0) lessonHtml = `<div class="hdr">${lessonHtml.slice(0, i)}</div>${lessonHtml.slice(i + 2)}`; }
      $('msg').innerHTML = (touch ? '<span class="pill">📋 Lesson</span>' : '') + lessonHtml + (nav ? `\n\n<b style="color:#ff7df5">→ ${nav.icao} ${nav.name}</b>: ${nav.distNm.toFixed(1)} NM, course <b>${fmtBrg(nav.brgMag)}°</b>${nav.eteMin !== null ? `, ETE ${Math.round(nav.eteMin)} min` : ''}${nav.distNm < 4 && !st.onGround ? ` – join the ${nav.icao} circuit at ${airports.find((a) => a.icao === nav.icao)!.circuitFt} ft and call ${airports.find((a) => a.icao === nav.icao)!.callName}` : ''}` : '') + (paused ? (touch ? '\n\n<b>PAUSED</b>' : '\n\n<b>PAUSED</b> – Esc to resume') : '') + (touch ? '' : `\n\n<span style="opacity:.6">H = help · C = view (${rig.view}) · M = map${input.mouseYoke ? ' · mouse yoke ON' : ''}</span>`);
    }
    hud.draw(camera, showLabels, lesson.target, st, nav && nav.distNm > 0.6 ? nav : null);
  });
}

main().catch((e) => { console.error(e); splash.error((e as Error).message, () => report.show()); });

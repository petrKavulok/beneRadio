// "Report a problem": a small form that opens a pre-filled GitHub issue (or copies the report).
// Technical details are collected automatically and shown to the reporter before anything is sent.
import { LOW_MEM } from '../quality';

declare const __BUILD__: string;
const REPO = 'https://github.com/petrKavulok/beneRadio';
const build = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';

// ---- recent errors (kept from page load on, so a report after a failure still has them)
const errors: string[] = [];
const keep = (s: string) => { errors.push(`${new Date().toISOString().slice(11, 19)} ${s}`.slice(0, 300)); if (errors.length > 6) errors.shift(); };
addEventListener('error', (e) => keep(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
addEventListener('unhandledrejection', (e) => keep(`unhandled: ${(e.reason as Error)?.message ?? String(e.reason)}`));
const origError = console.error.bind(console);
console.error = (...a: unknown[]) => { keep(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ')); origError(...a); };

function gpu(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return (ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : gl ? String(gl.getParameter(gl.RENDERER)) : 'no WebGL');
  } catch { return 'unknown'; }
}

/** What the sim knows about the current flight (filled in by main once loaded). */
export type ReportContext = () => Record<string, string | number | boolean | null | undefined>;

export class ProblemReport {
  open = false;
  private el: HTMLElement;
  private ctx: ReportContext = () => ({});
  onClose: () => void = () => {};

  constructor() {
    const el = (this.el = document.createElement('div'));
    el.id = 'report'; el.className = 'hidden';
    el.innerHTML = `<div class="sheet">
      <h2>🐞 Report a problem</h2>
      <p class="lead">BeneSim is still a work in progress – thank you for helping! Describe what happened and what you expected.</p>
      <textarea id="repText" rows="5" placeholder="e.g. On iPhone the app reloads after about a minute of flying near Praha…"></textarea>
      <details><summary>Technical details that will be included</summary><pre id="repInfo"></pre></details>
      <input id="repWebsite" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true" placeholder="website">
      <div class="btns">
        <button id="repSend" class="main">Send report</button>
        <button id="repClose">Cancel</button>
      </div>
      <p class="status" id="repStatus"></p>
      <p class="hint">No account needed. Reports appear publicly as issues in the BeneSim GitHub repository, so please don't include personal details.
        Other ways: <a href="#" id="repGit">open it on GitHub yourself</a> (needs a GitHub account) · <a href="#" id="repCopy">copy the report</a> to send to your instructor.</p>
    </div>`;
    document.body.appendChild(el);
    // typing in the form must not fly the aircraft
    el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.hide(); });
    el.addEventListener('keyup', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => { if (e.target === el) this.hide(); });
    el.querySelector('#repClose')!.addEventListener('click', () => this.hide());
    el.querySelector('#repSend')!.addEventListener('click', () => void this.send());
    el.querySelector('#repGit')!.addEventListener('click', (e) => { e.preventDefault(); this.toGitHub(); });
    el.querySelector('#repCopy')!.addEventListener('click', (e) => { e.preventDefault(); void this.copy(); });
  }

  setContext(c: ReportContext) { this.ctx = c; }

  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    (this.el.querySelector('#repStatus') as HTMLElement).textContent = '';
    (this.el.querySelector('#repInfo') as HTMLElement).textContent = this.details();
    setTimeout(() => (this.el.querySelector('#repText') as HTMLTextAreaElement).focus(), 50);
  }
  hide() { if (!this.open) return; this.open = false; this.el.classList.add('hidden'); this.onClose(); }

  private details(): string {
    let c: ReturnType<ReportContext> = {};
    try { c = this.ctx(); } catch { /* sim not loaded yet */ }
    const nav = navigator as Navigator & { deviceMemory?: number };
    const lines: [string, unknown][] = [
      ['Version', build],
      ['Page', location.pathname + location.search],
      ['Browser', navigator.userAgent],
      ['Screen', `${screen.width}×${screen.height} @${devicePixelRatio} · window ${innerWidth}×${innerHeight}${matchMedia('(orientation: portrait)').matches ? ' portrait' : ' landscape'}`],
      ['GPU', gpu()],
      ['Memory', nav.deviceMemory ? `${nav.deviceMemory} GB` : 'n/a'],
      ['Low-memory mode', LOW_MEM],
      ['Touch layout', document.body.classList.contains('touch')],
      ...Object.entries(c),
      ['Recent errors', errors.length ? '\n  ' + errors.join('\n  ') : 'none'],
    ];
    return lines.map(([k, v]) => `${k}: ${v}`).join('\n');
  }

  private text() { return (this.el.querySelector('#repText') as HTMLTextAreaElement).value.trim(); }
  private status(s: string) { (this.el.querySelector('#repStatus') as HTMLElement).textContent = s; }

  /** Send through our Vercel function (creates the GitHub issue for the reporter). */
  private async send() {
    const desc = this.text();
    if (!desc) { this.status('Please describe the problem first.'); return; }
    const btn = this.el.querySelector('#repSend') as HTMLButtonElement;
    btn.disabled = true; this.status('Sending…');
    try {
      const r = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: desc, details: this.details(), website: (this.el.querySelector('#repWebsite') as HTMLInputElement).value }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; number?: number; error?: string };
      if (r.ok && j.ok) {
        (this.el.querySelector('#repText') as HTMLTextAreaElement).value = '';
        this.status(`Thank you – report sent${j.number ? ` (#${j.number})` : ''}.`);
        setTimeout(() => this.hide(), 2200);
      } else this.status(`Could not send the report: ${j.error ?? `server error ${r.status}.`} Use one of the other ways below.`);
    } catch { this.status('Could not send the report (no connection?). Use one of the other ways below.'); }
    finally { btn.disabled = false; }
  }

  private toGitHub() {
    const desc = this.text();
    if (!desc) { this.status('Please describe the problem first.'); return; }
    const title = `[Report] ${desc.split('\n')[0].slice(0, 70)}`;
    let body = `### What happened\n${desc}\n\n### Technical details\n\`\`\`\n${this.details()}\n\`\`\`\n`;
    // GitHub's new-issue URL must stay well under ~8 kB
    if (body.length > 6000) body = body.slice(0, 6000) + '\n…(truncated)\n```';
    const url = `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    const w = window.open(url, '_blank', 'noopener');
    if (!w) location.href = url;
    this.status('GitHub opened in a new tab – check the text and press "Create".');
  }

  private async copy() {
    const desc = this.text();
    const all = `BeneSim problem report\n\n${desc || '(no description)'}\n\n${this.details()}`;
    try { await navigator.clipboard.writeText(all); this.status('Copied – paste it into a message or e-mail.'); }
    catch {
      const ta = this.el.querySelector('#repText') as HTMLTextAreaElement;
      ta.value = all; ta.select(); this.status('The report is selected in the box above – copy it with ⌘C (or long-press → Copy).');
    }
  }
}

export const report = new ProblemReport();

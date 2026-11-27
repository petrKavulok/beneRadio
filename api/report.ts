// Vercel Function: POST /api/report – files a BeneSim problem report as a GitHub issue,
// so reporters don't need a GitHub account. Needs the env var GITHUB_TOKEN on Vercel:
// a fine-grained personal access token for petrKavulok/beneRadio with "Issues: Read and write" only.

declare const process: { env: Record<string, string | undefined> }; // Node global on Vercel (no @types/node needed)

const REPO = 'petrKavulok/beneRadio';
const MAX_TEXT = 4000, MAX_DETAILS = 6000;

// best-effort spam brake per server instance: 5 reports per IP per 10 minutes
const recent = new Map<string, number[]>();
function limited(ip: string, now: number) {
  const t = (recent.get(ip) ?? []).filter((x) => now - x < 10 * 60_000);
  t.push(now); recent.set(ip, t);
  if (recent.size > 5000) recent.clear();
  return t.length > 5;
}

// no accidental @mentions or #references pinging people from user text
const defuse = (s: string) => s.replace(/@/g, '@​').replace(/\r/g, '');

export interface ReportIn { text?: unknown; details?: unknown; website?: unknown }

/** Pure handler (testable): returns [status, json]. */
export async function handleReport(body: ReportIn, token: string | undefined, ip: string, doFetch: typeof fetch = fetch, now = Date.now()): Promise<[number, Record<string, unknown>]> {
  if (!token) return [503, { error: 'Reporting is not set up on the server yet.' }];
  if (typeof body.website === 'string' && body.website) return [200, { ok: true }]; // honeypot filled in: a bot
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const details = typeof body.details === 'string' ? body.details : '';
  if (text.length < 3) return [400, { error: 'Please describe the problem.' }];
  if (limited(ip, now)) return [429, { error: 'Too many reports – please try again in a few minutes.' }];
  const title = `[Report] ${defuse(text.split('\n')[0]).slice(0, 80)}`;
  const issueBody = `### What happened\n${defuse(text.slice(0, MAX_TEXT))}\n\n### Technical details\n\`\`\`\n${defuse(details.slice(0, MAX_DETAILS)).replace(/```/g, "'''")}\n\`\`\`\n\n<sub>Sent from the in-app report form.</sub>`;
  const r = await doFetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'benesim-report' },
    body: JSON.stringify({ title, body: issueBody }),
  });
  if (!r.ok) return [502, { error: `GitHub refused the report (${r.status}).` }];
  const j = (await r.json()) as { number?: number; html_url?: string };
  return [201, { ok: true, number: j.number, url: j.html_url }];
}

export async function POST(request: Request): Promise<Response> {
  let body: ReportIn = {};
  try { body = (await request.json()) as ReportIn; } catch { /* empty / not JSON */ }
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const [status, json] = await handleReport(body, process.env.GITHUB_TOKEN, ip);
  return Response.json(json, { status });
}

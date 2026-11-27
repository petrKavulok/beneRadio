// Headless test of the /api/report handler with a fake GitHub API.
import { handleReport } from '../api/report';

let sent: { url: string; init: RequestInit } | null = null;
const fakeGitHub = (status = 201) => (async (url: string | URL, init?: RequestInit) => {
  sent = { url: String(url), init: init! };
  return new Response(JSON.stringify({ number: 42, html_url: 'https://github.com/x/y/issues/42' }), { status });
}) as typeof fetch;
const ok = (c: boolean, m: string) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ', m); };

const [s1, j1] = await handleReport({ text: 'Engine stops @petr on final\nmore', details: 'Browser: x ``` y' }, 'tok', '1.1.1.1', fakeGitHub());
ok(s1 === 201 && j1.number === 42, 'valid report creates an issue (#42)');
const b = JSON.parse(String(sent!.init.body));
ok(sent!.url.endsWith('/repos/petrKavulok/beneRadio/issues'), 'posts to the beneRadio issues API');
ok((sent!.init.headers as Record<string, string>).Authorization === 'Bearer tok', 'uses the server-side token');
ok(b.title === '[Report] Engine stops @​petr on final', 'title = first line, mention defused');
ok(!b.body.includes('@petr') && b.body.includes("'''"), 'body: no live @mention, code fence escaped');

sent = null;
ok((await handleReport({ text: '  ' }, 'tok', '2.2.2.2', fakeGitHub()))[0] === 400 && !sent, 'empty description rejected');
ok((await handleReport({ text: 'spam', website: 'http://x' }, 'tok', '3.3.3.3', fakeGitHub()))[0] === 200 && !sent, 'honeypot: bot gets fake ok, nothing filed');
ok((await handleReport({ text: 'hello' }, undefined, '4.4.4.4', fakeGitHub()))[0] === 503, 'no token → 503 "not set up"');
ok((await handleReport({ text: 'hello' }, 'bad', '5.5.5.5', fakeGitHub(401)))[0] === 502, 'GitHub refuses → 502');
let last = 0;
for (let i = 0; i < 6; i++) last = (await handleReport({ text: 'again ' + i }, 'tok', '6.6.6.6', fakeGitHub()))[0];
ok(last === 429, '6th report from one IP within 10 min → 429');
console.log('report-test passed');

// Watcher: polls CodeHawks contests (public tRPC) + Frantic board (public JSON).
// Runs as a step inside the harvest job (public repo only, per operator rule).
// Exits 0 even if a source fails (keeps last good state).
// On genuinely new contests/bounties, opens a GitHub issue (the page) with dedupe.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const UA = 'escrow-radar-watcher/1.0';
const STATE = 'data/watch-codehawks-frantic.json';
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || 'doishy-doish/escrow-radar';
const ts = () => new Date().toISOString();
const nowMs = () => Date.now();

function loadPrev() {
  try { return existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null; }
  catch { return null; }
}

async function chContests() {
  const r = await fetch('https://codehawks.com/trpc/competitions.getCompetitions?batch=1&input=%7B%7D', {
    headers: { 'User-Agent': UA },
  });
  if (!r.ok) throw new Error('ch ' + r.status);
  const j = await r.json();
  const arr = (j && j.result && j.result.data)
    ? j.result.data
    : (Array.isArray(j) && j[0] && j[0].result && j[0].result.data && j[0].result.data.json) ? j[0].result.data.json : [];
  const contests = arr.map((c) => ({
    id: c.id, name: c.name, slug: c.urlSlug,
    start: c.startDate, end: c.endDate,
    kyc: !!c.requiresKyc, invite: !!c.inviteOnly, fin: !!c.finalised,
    reward: c.reward, currency: c.currency, tags: c.protocolTags,
    repo: c.githubUrl,
  }));
  return { ok: true, count: contests.length, contests };
}

async function frBoard() {
  const r = await fetch('https://gofrantic.com/v1/board', { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('fr ' + r.status);
  const j = await r.json();
  const list = ((j && j.board && j.board.open_bounties) || []).map((b) => ({
    n: b.number, price: b.price_usd, status: b.work_status,
    avail: b.claim_slots ? (b.claim_slots.available + '/' + b.claim_slots.capacity) : '?',
    posted: (b.posted_at || '').slice(0, 10),
  }));
  return { ok: true, day: j.board.day, open: j.board.bounties_open, funded: j.board.funded_usd, bounties: list };
}

async function gh(path, method, body) {
  const r = await fetch('https://api.github.com/repos/' + REPO + path, {
    method: method || 'GET',
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': UA, ...(GH_TOKEN ? { Authorization: 'Bearer ' + GH_TOKEN } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error('gh ' + r.status + ' ' + path);
  return r.json();
}

async function openIssues() { return gh('/issues?state=open&per_page=100'); }

async function page(title, body, uid) {
  try {
    const open = await openIssues();
    if (open.some((i) => (i.body || '').includes(uid))) { console.log('dedupe: already paged', uid); return; }
    try {
      await gh('/issues', 'POST', { title, body: body + '\n\nuid:' + uid, labels: ['watch'] });
    } catch {
      await gh('/issues', 'POST', { title, body: body + '\n\nuid:' + uid });
    }
    console.log('paged', uid);
  } catch (e) { console.log('page failed (non-fatal):', String(e).slice(0, 160)); }
}

const prev = loadPrev();
const next = { checked_at: ts(), codehawks: null, frantic: null };

try { next.codehawks = await chContests(); console.log('ch contests:', next.codehawks.count); }
catch (e) {
  console.log('ch failed, keeping last good:', String(e).slice(0, 120));
  next.codehawks = (prev && prev.codehawks) || { ok: false, count: 0, contests: [] };
  next.codehawks.error = String(e).slice(0, 160);
}

try { next.frantic = await frBoard(); console.log('fr open:', next.frantic.open, 'funded:', next.frantic.funded); }
catch (e) {
  console.log('fr failed, keeping last good:', String(e).slice(0, 120));
  next.frantic = (prev && prev.frantic) || { ok: false, bounties: [] };
  next.frantic.error = String(e).slice(0, 160);
}

if (prev) {
  const prevCh = new Set((prev.codehawks && prev.codehawks.contests || []).map((c) => c.id));
  for (const c of next.codehawks.contests || []) {
    if (!prevCh.has(c.id)) {
      const live = Date.parse(c.start) <= nowMs() && nowMs() <= Date.parse(c.end) && !c.fin;
      const gates = [];
      if (c.kyc) gates.push('KYC-gated');
      if (c.invite) gates.push('invite-only');
      await page(
        (live ? '\u{1F6A8} CodeHawks LIVE: ' : '\u{1F3AF} CodeHawks NEW: ') + c.name + ' (' + c.reward + ' ' + c.currency + ')',
        'New contest in CodeHawks tRPC feed.\n\n- name: ' + c.name + '\n- reward: ' + c.reward + ' ' + c.currency + ' (chain: see contest page)\n- window: ' + c.start + ' -> ' + c.end + (live ? '  LIVE NOW' : '') + '\n- flags: requiresKyc=' + c.kyc + ' inviteOnly=' + c.invite + ' finalised=' + c.fin + (gates.length ? '  GATES: ' + gates.join(', ') : '') + '\n- tags: ' + c.tags + '\n- repo: ' + c.repo + '\n- slug: ' + c.slug + '\n- feed: https://codehawks.com/trpc/competitions.getCompetitions?batch=1&input=%7B%7D\n\nStanding filters: skip KYC/invite-only; solidity/foundry is our best language; needs account ferry at submit time + human-judged weeks.',
        'ch:' + c.id,
      );
    }
  }
  const prevFr = new Set((prev.frantic && prev.frantic.bounties || []).map((b) => b.n));
  for (const b of next.frantic.bounties || []) {
    if (!prevFr.has(b.n)) {
      await page(
        '\u{1F3AF} Frantic NEW bounty #' + b.n + ' ($' + b.price + ')',
        'New bounty on the Frantic public board.\n\n- number: ' + b.n + '\n- price: $' + b.price + '\n- status: ' + b.status + '\n- slots: ' + b.avail + '\n- posted: ' + b.posted + '\n- board: https://gofrantic.com/v1/board\n\nCheck brief for gates (gallery/MCP/Reddit/spend) before claiming. Standing: never claim without receipt in hand (one claim per person); #146-class needs gallery+MCP send; #130-class needs Reddit ferry.',
        'fr:' + b.n,
      );
    }
  }
} else {
  console.log('first run: baseline established, no pages');
}

writeFileSync(STATE, JSON.stringify(next, null, 1) + '\n');
console.log('wrote', STATE);

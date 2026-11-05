// Harvester: refreshes data/*.json from public sources. Runs on Actions
// (public repo only, per operator rule â never on private repos).
// Exits 0 even if a source fails (keeps last good file).
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const UA = { 'User-Agent': 'x402-radar/1.0' };
const ts = () => new Date().toISOString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// GitHub enrichment auth: Actions provides GITHUB_TOKEN (1000 req/hr);
// anonymous fallback keeps last good data if rate-limited.
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
function ghHeaders(extra) {
  return { ...UA, Accept: 'application/vnd.github+json', ...(GH_TOKEN ? { Authorization: 'Bearer ' + GH_TOKEN } : {}), ...(extra || {}) };
}
async function ghJson(url, extra) {
  const r = await fetch(url, { headers: ghHeaders(extra) });
  if (!r.ok) throw new Error('gh ' + r.status + ' ' + url);
  return r.json();
}

function writeIfChanged(path, obj) {
  const next = JSON.stringify(obj, null, 1) + '\n';
  let cur = null;
  try { cur = existsSync(path) ? readFileSync(path, 'utf8') : null; } catch { cur = null; }
  if (cur === next) { console.log('unchanged', path); return; }
  writeFileSync(path, next);
  console.log('wrote', path);
}

async function harvestPrices() {
  const syms = ['BTC', 'ETH', 'SOL'];
  const kr = await fetch('https://api.kraken.com/0/public/Ticker?pair=BTCUSD,ETHUSD,SOLUSD', { headers: UA }).then(r => r.json());
  const kmap = { BTC: 'XXBTZUSD', ETH: 'XETHZUSD', SOL: 'SOLUSD' };
  const out = [];
  for (const s of syms) {
    let kraken = null, coinbase = null;
    try { kraken = kr?.result?.[kmap[s]]?.c?.[0] ?? null; } catch { /* keep null */ }
    try {
      const c = await fetch(`https://api.coinbase.com/v2/prices/${s}-USD/spot`, { headers: UA }).then(r => r.json());
      coinbase = c?.data?.amount ?? null;
    } catch { /* keep null */ }
    await sleep(300);
    if (kraken || coinbase) out.push({ symbol: s, priceUsd: kraken || coinbase, kraken, coinbase, ts: ts() });
  }
  if (out.length) writeIfChanged('data/prices.json', out);
  else console.log('prices: all sources failed, keeping last good');
}

async function harvestGas() {
  const chains = [
    { chain: 'base', rpc: 'https://mainnet.base.org' },
    { chain: 'ethereum', rpc: 'https://ethereum-rpc.publicnode.com' },
  ];
  const out = [];
  for (const c of chains) {
    try {
      const r = await fetch(c.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_gasPrice', params: [] }) }).then(x => x.json());
      if (r?.result) {
        const wei = BigInt(r.result).toString();
        out.push({ chain: c.chain, gasPriceWei: wei, gasPriceGwei: (Number(BigInt(r.result)) / 1e9).toFixed(2), rpc: c.rpc, ts: ts() });
      }
    } catch (e) { console.log('gas failed for', c.chain); }
  }
  if (out.length) writeIfChanged('data/gas.json', out);
  else console.log('gas: all sources failed, keeping last good');
}

function parseArxivAtom(xml) {
  const entries = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const b = m[1];
    const pick = (re) => { const x = b.match(re); return x ? x[1].replace(/\s+/g, ' ').trim() : null; };
    const idRaw = pick(/<id>([^<]*)<\/id>/);
    const title = pick(/<title>([\s\S]*?)<\/title>/);
    if (!idRaw || !title) continue;
    const summary = pick(/<summary>([\s\S]*?)<\/summary>/);
    entries.push({
      id: (idRaw.split('/abs/')[1] || idRaw).trim(), title,
      authors: [...b.matchAll(/<author>\s*<name>([^<]*)<\/name>/g)].map(a => a[1].replace(/\s+/g, ' ').trim()).filter(Boolean),
      summary: summary ? summary.slice(0, 500) : null,
      published: pick(/<published>([^<]*)<\/published>/), ts: ts(),
    });
  }
  const seen = new Set(), out = [];
  for (const e of entries) { if (!seen.has(e.id)) { seen.add(e.id); out.push(e); } }
  return out;
}

async function harvestPapers() {
  try {
    const xml = await fetch('https://export.arxiv.org/api/query?search_query=' + encodeURIComponent('(cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL)') + '&start=0&max_results=40&sortBy=submittedDate&sortOrder=descending', { headers: UA }).then(r => { if (!r.ok) throw new Error('http-' + r.status); return r.text(); });
    const recs = parseArxivAtom(xml);
    if (recs.length) writeIfChanged('data/papers.json', recs);
    else console.log('papers: empty parse, keeping last good');
  } catch (e) { console.log('papers failed:', String(e).slice(0, 120), 'â keeping last good'); }
}


async function harvestHN() {
  try {
    const ids = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', { headers: UA }).then(r => { if (!r.ok) throw new Error('http-' + r.status); return r.json(); });
    const out = [];
    for (const id of (Array.isArray(ids) ? ids.slice(0, 30) : [])) {
      try {
        const it = await fetch('https://hacker-news.firebaseio.com/v0/item/' + id + '.json', { headers: UA }).then(r => r.json());
        if (it && it.title) out.push({ id: it.id, title: it.title, url: it.url || null, score: it.score || 0, by: it.by || null, time: it.time ? new Date(it.time * 1000).toISOString() : null });
      } catch { /* skip one */ }
      await sleep(150);
    }
    if (out.length) writeIfChanged('data/hn.json', out);
    else console.log('hn: empty, keeping last good');
  } catch (e) { console.log('hn failed:', String(e).slice(0, 120)); }
}

async function harvestFng() {
  try {
    const j = await fetch('https://api.alternative.me/fng/?limit=7', { headers: UA }).then(r => { if (!r.ok) throw new Error('http-' + r.status); return r.json(); });
    const recs = (j && Array.isArray(j.data) ? j.data : []).map(d => ({
      value: d.value, classification: d.value_classification,
      date: d.timestamp ? new Date(Number(d.timestamp) * 1000).toISOString().slice(0, 10) : null, ts: ts(),
    })).filter(r => r.value);
    if (recs.length) writeIfChanged('data/fng.json', recs);
    else console.log('fng: empty, keeping last good');
  } catch (e) { console.log('fng failed:', String(e).slice(0, 120)); }
}

// ---- Verified bounties feed (Paraloom [BOUNTY] issues + mechanical enrichment) ----
// Per-issue: competing open-PR count (timeline cross-references), age, severity,
// reward (explicit $ else severity-table typical), repro/stack/fix flags.
// Per-repo (cached per run): CI status via check-runs, repro command via
// workflows (manifest fallback). Rail is a static venue table. Escrow is
// honestly false: venue pays post-merge from treasury, no per-ticket contract.
const SEV_TABLE = { Low: 50, Medium: 150, High: 400, Critical: 1000 };
const REPRO_RE = /(cargo test[^\n`]{0,80}|pytest[^\n`]{0,80}|pnpm (?:test|vitest)[^\n`]{0,80}|npm (?:test|run [a-z0-9:@/-]+)[^\n`]{0,80}|go test[^\n`]{0,80}|make (?:test|check)[^\n`]{0,80}|bun test[^\n`]{0,80})/im;

function bountySeverity(title, body) {
  let m = title.match(/\[BUG\s*BOUNTY\]\s*(Low|Medium|High|Critical)/i) || title.match(/\[BOUNTY\]\s*(Low|Medium|High|Critical)/i);
  if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  m = body.match(/##\s*Severity\s*\n+\s*(Low|Medium|High|Critical)/i) || body.match(/Severity\s*:\s*(Low|Medium|High|Critical)/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
}

function bountyReward(body, sev) {
  const m = body.match(/\$([\d,]+(?:\.\d{1,2})?)/);
  if (m) {
    const v = parseFloat(m[1].replace(/,/g, ''));
    if (v > 0 && v <= 100000) return { usdc: v, src: 'explicit' };
  }
  return { usdc: sev && SEV_TABLE[sev] != null ? SEV_TABLE[sev] : null, src: 'severity_table' };
}

const _repoEnrich = {};
// Persistent enrich cache (data/repo-enrich.json, 6h TTL): per-repo check-runs
// + workflow reads cost ~4 calls x N repos every run — at */5 that alone eats
// half the 1000/hr token budget. CI status / repro commands barely move in 6h.
let _enrichCache = {};
try { _enrichCache = JSON.parse(readFileSync('data/repo-enrich.json', 'utf8')); } catch { _enrichCache = {}; }
function enrichCacheFresh(k) {
  const e = _enrichCache[k];
  return e && (Date.now() - new Date(e.ts).getTime()) < 6 * 3600 * 1000 ? e : null;
}
const ASSERT_RES = [
  /thread '[^']*' panicked at '[^']{1,160}/,
  /panicked at '[^']{1,160}/,
  /assert_eq!\([^;]{1,200}\)/,
  /assert!\([^;]{1,200}\)/,
  /AssertionError[^:\n]*:?[^\n]{1,150}/,
  /test \S+ FAILED[^\n]{0,120}/,
  /Error: [^\n]{1,150}/,
];
const FILE_RE = /(?:^|[\s`("'\[])((?:src|programs|crates|lib|contracts|test|tests|app|packages|core|bridge|wallet|prover|engine)[\w\-./]*\.(?:rs|ts|tsx|js|jsx|sol|py|go|cairo))(?=[\s`)"'\],:;]|$)/gm;
const STACK_LINE = /panicked|stack backtrace|^\s*at [\w<>:$.]+\s*\(|#[0-9]+\s+0x[0-9a-f]+|Traceback \(most recent call|File "[^"]+", line \d+|0x[0-9a-f]{6,}\s+in /m;

function failingAssertion(body) {
  for (const re of ASSERT_RES) { const m = body.match(re); if (m) return m[0].replace(/\s+/g, ' ').trim().slice(0, 220); }
  return null;
}
function targetFiles(body) {
  const out = []; const seen = new Set(); let m;
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(body)) !== null && out.length < 5) {
    const f = m[1].replace(/^\.\//, '');
    if (!seen.has(f) && f.length < 120) { seen.add(f); out.push(f); }
  }
  return out;
}
function stackExcerpt(body) {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (STACK_LINE.test(lines[i])) {
      return lines.slice(Math.max(0, i - 1), i + 3).join('\n').replace(/\s+/g, ' ').trim().slice(0, 400);
    }
  }
  return null;
}

// Comment-claim scan: textual claims timelines miss ("Companion fix PR: #207",
// "Claiming this with an open PR", "Resolved via owner/repo#199").
// Returns { claimed, type, author, target_ref, raw_snippet } or { claimed:false }.
const CLAIM_PR_REF = /(?:companion\s+fix|resolved\s+via|fixes|closes|(?:pull\s+request|pr))[:\s]+(?:https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)|([\w.-]+)\/([\w.-]+)#(\d+)|#(\d+))/i;
const CLAIM_INTENT = /\b(?:claiming|taking this|working on (?:this|a fix)|wip(?:\s+pr)?|submitting a pr)\b/i;
const CLAIM_BOT = /solbotrescue|algora|polar-sh|bounty\s+(?:claimed|assigned)|fixes\s+#[0-9]+/i;
function scanClaim(by, text) {
  const one = String(text || '').replace(/\s+/g, ' ').trim();
  if (!one) return { claimed: false };
  const m = one.match(CLAIM_PR_REF);
  if (m) {
    let ref = null;
    if (m[3]) ref = m[1] + '#' + m[3];
    else if (m[6]) ref = m[4] + '/' + m[5] + '#' + m[6];
    else if (m[7]) ref = '#' + m[7];
    const type = /companion/i.test(one) ? 'companion_pr' : (/resolved\s+via/i.test(one) ? 'resolved_via' : 'pr_reference');
    return { claimed: true, type, author: by, target_ref: ref, raw_snippet: one.slice(0, 120) };
  }
  if (CLAIM_INTENT.test(one)) return { claimed: true, type: 'intent_claim', author: by, target_ref: null, raw_snippet: one.slice(0, 120) };
  if (CLAIM_BOT.test(one)) return { claimed: true, type: 'bot_claim', author: by, target_ref: null, raw_snippet: one.slice(0, 120) };
  return { claimed: false };
}
async function enrichRepo(owner, repo) {
  const key = owner + '/' + repo;
  if (_repoEnrich[key]) return _repoEnrich[key];
  const hit = enrichCacheFresh(key);
  if (hit) { _repoEnrich[key] = { ci: hit.ci, repro: hit.repro, reproSrc: hit.reproSrc }; return _repoEnrich[key]; }
  const out = { ci: 'unknown', repro: null, reproSrc: null };
  try {
    const info = await ghJson(`https://api.github.com/repos/${owner}/${repo}`);
    await sleep(700);
    const def = info.default_branch || 'main';
    try {
      const cr = await ghJson(`https://api.github.com/repos/${owner}/${repo}/commits/${def}/check-runs?per_page=5`);
      await sleep(700);
      const runs = cr.check_runs || [];
      const fails = runs.filter(x => x.conclusion === 'failure' || x.conclusion === 'timed_out' || x.conclusion === 'action_required');
      const succ = runs.filter(x => x.conclusion === 'success');
      const pend = runs.filter(x => x.status === 'in_progress' || x.status === 'queued' || x.status === 'waiting');
      out.ci = fails.length ? 'failing' : (succ.length ? 'passing' : (pend.length ? 'pending' : 'unknown'));
    } catch { out.ci = 'unknown'; }
    try {
      const wf = await ghJson(`https://api.github.com/repos/${owner}/${repo}/contents/.github/workflows`);
      await sleep(700);
      const ymls = (Array.isArray(wf) ? wf : []).filter(f => /\.ya?ml$/i.test(f.name)).slice(0, 2);
      for (const f of ymls) {
        try {
          const blob = await ghJson(`https://api.github.com/repos/${owner}/${repo}/contents/${f.path}`);
          await sleep(700);
          const txt = Buffer.from((blob.content || '').replace(/\n/g, ''), 'base64').toString('utf8').slice(0, 20000);
          const m = txt.match(REPRO_RE);
          if (m && !out.repro) { out.repro = m[1].trim().slice(0, 120); out.reproSrc = '.github/workflows/' + f.name; }
        } catch { /* skip one file */ }
      }
    } catch { /* no workflows dir */ }
    if (!out.repro) {
      try {
        const root = await ghJson(`https://api.github.com/repos/${owner}/${repo}/contents/`);
        await sleep(700);
        const names = (Array.isArray(root) ? root : []).map(f => f.name);
        if (names.includes('Cargo.toml')) out.repro = 'cargo test';
        else if (names.includes('package.json')) out.repro = 'npm test';
        else if (names.includes('pyproject.toml') || names.includes('pytest.ini') || names.includes('setup.py')) out.repro = 'pytest';
        else if (names.includes('go.mod')) out.repro = 'go test ./...';
        else if (names.includes('Makefile')) out.repro = 'make test';
        if (out.repro) out.reproSrc = 'repo manifest (fallback)';
      } catch { /* skip */ }
    }
  } catch (e) { console.log('enrichRepo failed for', owner + '/' + repo, String(e).slice(0, 100)); }
  _repoEnrich[key] = out;
  _enrichCache[key] = { ...out, ts: ts() };
  return out;
}

// Multi-source bounty intake. Each source: one search call + per-issue enrich.
// New sources MUST pass the paid-proof bar (reverse-scout verified payer)
// before being added here — never wire label-only repos.
const SOURCES = [
  { org: 'paraloom-labs', venue: 'paraloom', rail: 'MANUAL_MAINTAINER_REVIEW', note: 'reporter settlement wallet only; venue pays post-merge from treasury; no per-ticket escrow contract', q: '[BOUNTY] org:paraloom-labs state:open is:issue', per_page: 15 },
  { org: 'scaffold-studio-hq', venue: 'scaffold-studio', rail: 'MANUAL_MAINTAINER_REVIEW', note: 'explicit dollar bounties with /claim workflow; maintainer pays post-merge; no per-ticket escrow contract observed', q: '[Bounty] org:scaffold-studio-hq state:open is:issue', per_page: 5 },
];

// Serial-lock ranking (winner-take-all doctrine 2026-11-05): alerts file is
// pre-sorted for single-target execution. Tier 1 repro-determinism >
// Tier 2 blast radius (SJF) > Tier 3 reward density. Harvester does NOT lock;
// the agent holds the lock (data/bounty-lock.json) and re-verifies between sprints.
function reproTier(r) {
  if (r.failing_assertion) return 2;
  if (r.has_repro || r.repro_command) return 1;
  return 0;
}
function estMinutes(r) {
  const n = Array.isArray(r.target_files) ? r.target_files.length : 0;
  let m = 10 + n * 10;
  m += r.failing_assertion ? -5 : 15;
  m += r.has_stack_trace ? 0 : 10;
  return Math.max(5, m);
}
function rankAlerts(recs) {
  return recs
    .filter(r => r.competing_prs === 0 && !r.claimed_in_comments && r.age_seconds_since_open <= 7 * 24 * 3600 && (r.reward_usdc || 0) >= 50)
    .map(r => {
      const est = estMinutes(r);
      const density = (r.reward_usdc || 0) / est;
      return { ...r, selection_rank_tier: reproTier(r), est_minutes: est, reward_density: Math.round(density * 100) / 100 };
    })
    .sort((a, b) =>
      (b.selection_rank_tier - a.selection_rank_tier) ||
      (a.est_minutes - b.est_minutes) ||
      (b.reward_density - a.reward_density) ||
      ((b.reward_usdc || 0) - (a.reward_usdc || 0)));
}

// Stale-context demotion (drift doctrine 2026-11-05 — automates the #1315 kill).
// Alert candidates whose target files are missing at the issue repo's HEAD
// (cross-repo drift: body names wallet files on a core issue) or untouched
// >45d before the issue was filed (reporter reading old code) get
// stale_context:true and drop out of alerts. Runs ONLY on the small candidate
// set, so the extra calls stay inside rate budget. Flags are written back
// onto recs so data/bounties.json carries the evidence.
async function demoteStale(cands, recs) {
  const fresh = [], demoted = [];
  for (const r of cands) {
    let stale = null;
    const files = Array.isArray(r.target_files) ? r.target_files.slice(0, 5) : [];
    const back = recs.find(x => x.id === r.id);
    const tag = (k, v) => { r[k] = v; if (back) back[k] = v; };
    for (const f of files) {
      const p = String(f).split('/').map(encodeURIComponent).join('/');
      let head = null;
      try {
        head = await ghJson(`https://api.github.com/repos/${r.org}/${r.repo}/contents/${p}`);
        await sleep(400);
      } catch (e) {
        if (String(e).includes('gh 404')) { stale = 'repo_mismatch:' + f; break; }
        continue; // rate/network hiccup: don't punish the ticket
      }
      if (!head) continue;
      try {
        const cs = await ghJson(`https://api.github.com/repos/${r.org}/${r.repo}/commits?path=${encodeURIComponent(f)}&per_page=1`);
        await sleep(400);
        const d = cs && cs[0] && cs[0].commit && cs[0].commit.author && cs[0].commit.author.date;
        if (d) {
          const delta = Math.round((new Date(r.opened_at).getTime() - new Date(d).getTime()) / 86400000);
          tag('days_since_target_touch', delta);
          if (delta > 45) { stale = 'stale_target:' + f + ':' + delta + 'd'; break; }
        }
      } catch { /* hiccup: leave nominal */ }
    }
    tag('stale_context', stale ? true : false);
    if (stale) { tag('stale_reason', stale); demoted.push({ id: r.id, stale_reason: stale }); }
    else fresh.push(r);
  }
  return { fresh, demoted };
}

async function harvestBounties() {
  try {
    const now = Date.now();
    const recs = [];
    for (const src of SOURCES) {
    const s = await ghJson('https://api.github.com/search/issues?q=' + encodeURIComponent(src.q) + '&per_page=' + src.per_page + '&sort=created&order=desc');
    await sleep(4000);
    for (const i of (s.items || [])) {
      const repo = (i.repository_url || '').split('/').pop();
      if (!repo) continue;
      const body = i.body || '';
      const sev = bountySeverity(i.title || '', body);
      const rw = bountyReward((i.title || '') + '\n' + body, sev);
      const age = Math.max(0, Math.round((now - new Date(i.created_at).getTime()) / 1000));
      let prs = [];
      try {
        const tl = await ghJson(`https://api.github.com/repos/${src.org}/${repo}/issues/${i.number}/timeline?per_page=100`, { Accept: 'application/vnd.github.mockingbird-preview+json' });
        await sleep(800);
        prs = (Array.isArray(tl) ? tl : [])
          .filter(e => e.event === 'cross-referenced' && e.source && e.source.issue && e.source.issue.pull_request && e.source.issue.state === 'open')
          .map(e => e.source.issue.html_url);
      } catch (e) { console.log('timeline failed for', repo + '#' + i.number, String(e).slice(0, 80)); }
      const en = await enrichRepo(src.org, repo);
      // Comment-claim scan: one call per issue; any hit disqualifies the race.
      let claim = { claimed: false };
      try {
        const cm = await ghJson(`https://api.github.com/repos/${src.org}/${repo}/issues/${i.number}/comments?per_page=100`);
        await sleep(600);
        for (const c of (Array.isArray(cm) ? cm : [])) {
          const hit = scanClaim((c.user || {}).login || 'unknown', c.body || '');
          if (hit.claimed) { claim = hit; break; }
        }
      } catch (e) { console.log('comments failed for', repo + '#' + i.number, String(e).slice(0, 60)); }
      // Live-verify competing PRs ONLY for would-be alert candidates
      // (unclaimed + fresh + paid). Timeline embeds go stale (#1315: 3 xrefs
      // read open but are closed on direct fetch); fail-closed. Skipping the
      // verify for already-disqualified tickets keeps the run inside rate
      // budget (~80 calls/run at */5 = just under the 1000/hr token limit).
      const candidate = !claim.claimed && age <= 7 * 24 * 3600 && (rw.usdc || 0) >= 50;
      if (prs.length && candidate) {
        try {
          const live = [];
          for (const u of prs) {
            const m = String(u).match(/\/pull\/(\d+)(?:\/)?$/);
            if (!m) { live.push(u); continue; }
            try {
              const p = await ghJson(`https://api.github.com/repos/${src.org}/${repo}/pulls/${m[1]}`);
              await sleep(600);
              if (p && p.state === 'open') live.push(u);
            } catch (e) {
              console.log('verify failed for', repo + '#' + m[1], String(e).slice(0, 60));
              live.push(u);
            }
          }
          prs = live;
        } catch { /* keep timeline list */ }
      }
      recs.push({
        id: repo + '#' + i.number, venue: src.venue, repo: repo, org: src.org, number: i.number,
        title: i.title, url: i.html_url, severity: sev,
        reward_usdc: rw.usdc, reward_source: rw.src,
        age_seconds_since_open: age,
        opened_at: i.created_at,
        competing_prs: prs.length, competing_pr_urls: prs.slice(0, 5),
        ci_status: en.ci, repro_command: en.repro, repro_source: en.reproSrc,
        rail: src.rail, escrow_verified: false,
        escrow_note: src.note,
        has_repro: /steps to repro|reproduction|reproduce|cargo test|pytest|npm test|pnpm|go test|```(bash|sh|console)/i.test(body),
        has_stack_trace: /panic|backtrace|stack trace|test failed|assertion|Error:/i.test(body),
        has_fix_hint: /suggested fix|proposed fix|recommended fix/i.test(body),
        failing_assertion: failingAssertion(body),
        target_files: targetFiles(body),
        stack_excerpt: stackExcerpt(body),
        claimed_in_comments: !!claim.claimed,
        claim_evidence: claim.claimed ? { type: claim.type, author: claim.author, target_ref: claim.target_ref, raw_snippet: claim.raw_snippet } : null,
        excerpt: body.replace(/\s+/g, ' ').trim().slice(0, 600),
        ts: ts(),
      });
    }
    await sleep(2000);
    } // end source loop
    if (recs.length) {
      // Drift-demotion runs BEFORE the bounties write so stale_context /
      // stale_reason persist on the records, not just in the alerts file.
      let alerts = rankAlerts(recs);
      const preCount = alerts.length;
      const out = await demoteStale(alerts, recs);
      alerts = out.fresh;
      console.log(`demote: ${preCount} candidates -> ${alerts.length} alerts` + (out.demoted.length ? ' demoted=' + JSON.stringify(out.demoted) : ''));
      writeIfChanged('data/bounties.json', recs);
      writeIfChanged('data/repo-enrich.json', _enrichCache);
      // Customer-zero hook: uncontested + fresh (<=7d), pre-ranked for serial lock.
      // Rank 1 = alerts[0]. Lock it, ignore the rest until PR + re-verify gate.
      writeIfChanged('data/bounty-alerts.json', { ts: ts(), count: alerts.length, alerts, demoted: out.demoted });
    } else console.log('bounties: empty search, keeping last good');
  } catch (e) { console.log('bounties failed:', String(e).slice(0, 160), '— keeping last good'); }
}

await harvestPrices();
await harvestGas();
await harvestPapers();
await harvestHN();
await harvestFng();
await harvestBounties();
console.log('harvest done');

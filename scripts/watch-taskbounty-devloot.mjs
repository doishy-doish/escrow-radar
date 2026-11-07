// Watcher: polls TaskBounty open feed + DevLoot open bounties (both public, no auth).
// Runs as a step inside the harvest job (public repo only, per operator rule).
// Exits 0 even if a source fails (keeps last good state).
// On genuinely new funded items, opens a GitHub issue (the page) with dedupe.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const UA = 'escrow-radar-watcher/1.0';
const STATE = 'data/watch-taskbounty-devloot.json';
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY || 'doishy-doish/escrow-radar';
const ts = () => new Date().toISOString();

function loadPrev() {
  try { return existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null; }
  catch { return null; }
}

async function tbOpen() {
  const r = await fetch('https://www.task-bounty.com/api/v1/tasks?state=open&limit=20', {
    headers: { 'User-Agent': UA },
  });
  if (!r.ok) throw new Error('tb ' + r.status);
  const j = await r.json();
  const tasks = (j && j.data ? j.data : []).map((t) => ({
    id: t.id, slug: t.slug, title: t.title,
    cents: t.bounty_cents, status: t.status, deadline: t.submission_deadline,
  }));
  return { ok: true, count: tasks.length, tasks };
}

async function dlOpen() {
  const M = 'https://devloot.xyz/mcp';
  const H = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'User-Agent': UA,
  };
  const init = await fetch(M, {
    method: 'POST', headers: H,
    body: JSON.stringify({ jsonrpc: '2.0', id: 'w-init', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'escrow-radar-watcher', version: '1.0' } } }),
  });
  if (!init.ok) throw new Error('dl init ' + init.status);
  await init.text();
  const call = await fetch(M, {
    method: 'POST', headers: H,
    body: JSON.stringify({ jsonrpc: '2.0', id: 'w-fb', method: 'tools/call', params: { name: 'find_bounties', arguments: { status: 'OPEN' } } }),
  });
  if (!call.ok) throw new Error('dl fb ' + call.status);
  const j = JSON.parse(await call.text());
  const d = JSON.parse((j && j.result && j.result.content && j.result.content[0] && j.result.content[0].text) || '{}');
  const bounties = (d.bounties || []).map((b) => ({
    id: b.id, issue: b.issueUrl, amount: b.amount,
    status: b.status, difficulty: b.difficulty,
  }));
  return { ok: true, total: d.total || 0, bounties };
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
    let labels = ['watch'];
    try {
      await gh('/issues', 'POST', { title, body: body + '\n\nuid:' + uid, labels });
    } catch {
      await gh('/issues', 'POST', { title, body: body + '\n\nuid:' + uid });
      labels = [];
    }
    console.log('paged', uid, 'labels', labels.join(','));
  } catch (e) { console.log('page failed (non-fatal):', String(e).slice(0, 160)); }
}

const prev = loadPrev();
const next = { checked_at: ts(), taskbounty: null, devloot: null };

try { next.taskbounty = await tbOpen(); console.log('tb open:', next.taskbounty.count); }
catch (e) {
  console.log('tb failed, keeping last good:', String(e).slice(0, 120));
  next.taskbounty = (prev && prev.taskbounty) || { ok: false, count: 0, tasks: [] };
  next.taskbounty.error = String(e).slice(0, 160);
}

try { next.devloot = await dlOpen(); console.log('dl open:', next.devloot.total); }
catch (e) {
  console.log('dl failed, keeping last good:', String(e).slice(0, 120));
  next.devloot = (prev && prev.devloot) || { ok: false, total: 0, bounties: [] };
  next.devloot.error = String(e).slice(0, 160);
}

if (prev) {
  const prevTb = new Set((prev.taskbounty && prev.taskbounty.tasks || []).map((t) => t.id));
  for (const t of next.taskbounty.tasks || []) {
    if (!prevTb.has(t.id)) {
      await page(
        '🎯 TaskBounty OPEN: ' + t.title + ' ($' + (t.cents / 100) + ')',
        'New funded task on the TaskBounty open feed.\n\n- title: ' + t.title + '\n- reward: $' + (t.cents / 100) + ' (80/20 split; $50 minimum after first payout)\n- slug: ' + t.slug + '\n- deadline: ' + t.deadline + '\n- feed: https://www.task-bounty.com/api/v1/tasks?state=open\n\nGates (from Terms 2026-04-17): signup/API key required; payout USDC-on-Solana/ETH/BTC (NOT Base); eligibility + jurisdiction check before work; GitHub-PR submission with AI disclosure.',
        'tb:' + t.id,
      );
    }
  }
  const prevDl = new Set((prev.devloot && prev.devloot.bounties || []).map((b) => b.id));
  for (const b of next.devloot.bounties || []) {
    if (!prevDl.has(b.id)) {
      await page(
        '🎯 DevLoot OPEN: bounty #' + b.id + ' ($' + b.amount + ' USDC) ' + b.issue,
        'New OPEN bounty via DevLoot MCP find_bounties.\n\n- issue: ' + b.issue + '\n- reward: $' + b.amount + ' USDC\n- difficulty: ' + b.difficulty + '\n- verify: DevLoot MCP https://devloot.xyz/mcp -> find_bounties {status OPEN}\n\nGates: chain is Algorand (ALGO fees + USDC opt-in; operator holds no ALGO wallet); GitHub device-flow + server-managed agent wallet; merge alone does not pay (server claimability check).',
        'dl:' + b.id,
      );
    }
  }
} else {
  console.log('first run: baseline established, no pages');
}

writeFileSync(STATE, JSON.stringify(next, null, 1) + '\n');
console.log('wrote', STATE);

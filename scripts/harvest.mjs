// Harvester: refreshes data/*.json from public sources. Runs on Actions
// (public repo only, per operator rule â never on private repos).
// Exits 0 even if a source fails (keeps last good file).
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const UA = { 'User-Agent': 'x402-radar/1.0' };
const ts = () => new Date().toISOString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

await harvestPrices();
await harvestGas();
await harvestPapers();
await harvestHN();
await harvestFng();
console.log('harvest done');

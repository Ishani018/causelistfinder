// Phase 0 watcher: notice every new cause list on the court website, read it, and log what happened.
// No users, no alerts to lawyers. Problems go to the log and, if configured, to the operator on Telegram.
//
//   node watcher/watch.js           one check (for cron / GitHub Actions)
//   node watcher/watch.js --loop    keep running: every 5 min 07:00–23:00 IST, every 30 min otherwise
//   node watcher/watch.js --archive also probe the archive now, even if it was checked recently
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// The court's server does not send its intermediate certificate. Node needs it to verify the site,
// so re-run with it added (never with verification turned off).
const CERT = path.join(__dirname, 'globalsign-alphassl-ca-2025.pem');
if (!process.env.NODE_EXTRA_CA_CERTS) {
  const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_EXTRA_CA_CERTS: CERT } });
  process.exit(r.status ?? 1);
}

const site = require('./court-site.js');
const { readList, unreadCaseNumbers } = require('../tools/read-list.js');

const DATA = process.env.WATCH_DATA_DIR || path.join(__dirname, '..', 'data');
const PDFS = path.join(DATA, 'pdfs');
const STATE_FILE = path.join(DATA, 'state.json');
const LOG_FILE = path.join(DATA, 'log.jsonl');
const ARCHIVE_EVERY_MIN = 30;
const KEEP_PDFS_DAYS = 30;
const HEARTBEAT_AT = { h: 22, m: 30 };   // IST: by now tomorrow's Appellate Side daily list should be up

fs.mkdirSync(PDFS, { recursive: true });

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { notices: {}, archive: {}, heartbeats: {}, lastArchiveCheck: null, failures: 0 }; }
}
const saveState = s => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1));
const log = rec => fs.appendFileSync(LOG_FILE, JSON.stringify(rec) + '\n');

// Current IST wall-clock time as a Date whose UTC fields read as IST.
const istNow = () => new Date(Date.now() + 5.5 * 3600e3);
const isoDay = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400e3);
function nextWorkingDay(d) { let x = addDays(d, 1); while ([0, 6].includes(x.getUTCDay())) x = addDays(x, 1); return x; }

async function tellOperator(text) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  console.log(`PROBLEM: ${text}`);
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: `Cause list watcher: ${text}` }),
    });
  } catch (e) { console.log(`could not reach Telegram: ${e.message}`); }
}

// Download one list, read it with the page's parser, and check every printed case number is covered.
async function processList(item) {
  const foundAt = new Date().toISOString();
  const rec = { foundAt, ...item, delayMin: item.uploadedAt ? Math.round((Date.parse(foundAt) - Date.parse(item.uploadedAt)) / 60000) : null };
  try {
    const { bytes, isPdf } = await site.download(item.url);
    if (!isPdf) { rec.problem = item.type === 'notice' ? null : 'not a PDF'; rec.result = 'not a PDF'; return rec; }
    const file = path.join(PDFS, `${item.source}-${item.key.replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_')}.pdf`);
    fs.writeFileSync(file, bytes);
    const t0 = Date.now();
    const list = await readList(file);
    const unread = unreadCaseNumbers(list);
    rec.result = {
      pages: list.pages, cases: list.entries.length, ms: Date.now() - t0,
      listTypes: [...new Set(list.entries.map(e => e.list))],
      dates: [...new Set(list.entries.map(e => e.date))].slice(0, 3),
      courts: new Set(list.entries.map(e => e.court).filter(Boolean)).size,
      unread: unread.slice(0, 20), unreadCount: unread.length,
    };
    if (!list.entries.length && item.type !== 'notice') rec.problem = 'cause list read as zero cases';
    else if (unread.length) rec.problem = `${unread.length} case numbers printed but not read`;
  } catch (e) {
    rec.problem = `could not read: ${e.message}`;
  }
  return rec;
}

async function checkNotices(state) {
  const fresh = [];
  for (let page = 1; page <= 3; page++) {
    const items = await site.fetchNotices(page);
    const unseen = items.filter(n => !state.notices[n.id]);
    fresh.push(...unseen);
    // Keep paging only when a whole page is new (many uploads since the last check) and we have history.
    if (unseen.length < items.length || !Object.keys(state.notices).length) break;
  }
  return fresh.reverse().map(n => ({ source: 'notice', key: n.id, url: n.url, title: n.title, uploadedAt: n.uploadedAt, ...site.describeTitle(n.title) }));
}

async function checkArchive(state, force) {
  const last = state.lastArchiveCheck ? Date.parse(state.lastArchiveCheck) : 0;
  if (!force && Date.now() - last < ARCHIVE_EVERY_MIN * 60e3) return [];
  const today = istNow();
  const days = [today, addDays(today, 1), nextWorkingDay(today)].filter((d, i, a) => a.findIndex(x => isoDay(x) === isoDay(d)) === i);
  const probes = [];
  for (const side of Object.keys(site.SIDES)) for (const d of days) probes.push({ side, type: 'daily', d });
  for (const side of ['appellate', 'original']) probes.push({ side, type: 'supplementary', d: today });
  const fresh = [];
  for (const p of probes) {
    const url = site.archiveUrl(p.side, p.type, p.d);
    const info = await site.probeArchive(url);
    if (!info) continue;
    const seen = state.archive[url];
    if (seen && seen.size === info.size) continue;
    fresh.push({ source: 'archive', key: url.split('/old_cause_lists/')[1], url, title: `${p.type} list ${isoDay(p.d)} (${p.side})`,
      uploadedAt: info.uploadedAt, type: p.type, side: p.side, hearingDate: isoDay(p.d), court: null, vacation: false,
      replaced: !!seen, size: info.size });
  }
  state.lastArchiveCheck = new Date().toISOString();
  return fresh;
}

// Silence must never look like "nothing listed": say so when tomorrow's main list is late.
async function heartbeat(state) {
  const now = istNow();
  if (now.getUTCHours() * 60 + now.getUTCMinutes() < HEARTBEAT_AT.h * 60 + HEARTBEAT_AT.m) return;
  const target = isoDay(nextWorkingDay(now));
  if (state.heartbeats[target]) return;
  const have = Object.values(state.notices).some(n => n.type === 'daily' && n.side === 'appellate' && n.hearingDate === target)
    || Object.values(state.archive).some(a => a.type === 'daily' && a.side === 'appellate' && a.hearingDate === target);
  state.heartbeats[target] = have ? 'ok' : 'missing';
  if (!have) {
    const msg = `no Appellate Side daily list for ${target} by ${HEARTBEAT_AT.h}:${HEARTBEAT_AT.m} IST (holiday or late upload?)`;
    log({ foundAt: new Date().toISOString(), source: 'heartbeat', hearingDate: target, problem: msg });
    await tellOperator(msg);
  }
}

function prunePdfs() {
  const cutoff = Date.now() - KEEP_PDFS_DAYS * 86400e3;
  for (const f of fs.readdirSync(PDFS)) {
    const p = path.join(PDFS, f);
    if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
  }
}

async function runOnce({ forceArchive = false } = {}) {
  const state = loadState();
  const firstRun = !state.lastRun;   // the first run picks up a backlog; its delays mean nothing
  let items = [];
  try {
    items = [...await checkNotices(state), ...await checkArchive(state, forceArchive)];
    state.failures = 0;
  } catch (e) {
    state.failures = (state.failures || 0) + 1;
    const hint = /certificate|CERT|SIGNATURE/i.test(e.cause?.code || e.message) ? ' (the bundled GlobalSign intermediate may have expired; it is valid until May 2027)' : '';
    log({ foundAt: new Date().toISOString(), source: 'fetch', problem: `court site unreachable: ${e.cause?.code || e.message}${hint}`, failures: state.failures });
    if (state.failures === 3) await tellOperator(`court site unreachable 3 checks in a row: ${e.cause?.code || e.message}${hint}`);
    saveState(state);
    return;
  }
  for (const item of items) {
    const rec = await processList(item);
    if (firstRun) rec.backfill = true;
    log(rec);
    const summary = rec.result && typeof rec.result === 'object' ? `${rec.result.cases} cases, ${rec.result.pages} pages` : rec.result || '';
    console.log(`${item.source} ${item.key}: ${item.title} — ${summary}${rec.problem ? ' — PROBLEM: ' + rec.problem : ''}`);
    if (rec.problem) await tellOperator(`${item.title}: ${rec.problem} (${item.url})`);
    const keep = { type: item.type, side: item.side, hearingDate: item.hearingDate, uploadedAt: item.uploadedAt };
    if (item.source === 'notice') state.notices[item.key] = keep;
    else state.archive[item.url] = { ...keep, size: item.size };
  }
  await heartbeat(state);
  prunePdfs();
  state.lastRun = new Date().toISOString();
  saveState(state);
  console.log(`checked at ${istNow().toISOString().slice(0, 16).replace('T', ' ')} IST: ${items.length} new`);
}

async function loop() {
  for (;;) {
    await runOnce().catch(e => console.log(`check failed: ${e.stack || e}`));
    const h = istNow().getUTCHours();
    const waitMin = h >= 7 && h < 23 ? 5 : 30;
    await new Promise(r => setTimeout(r, waitMin * 60e3));
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--loop')) loop();
  else runOnce({ forceArchive: args.includes('--archive') }).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runOnce };

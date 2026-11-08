// Check a list of case numbers against one hearing day's cause lists, fetched from the court website:
// the daily list of every bench (Appellate, Original, Jalpaiguri, Port Blair) for that date, plus every daily
// or supplementary list the watcher has seen posted as a notice for that date. Returns only the matches. Case numbers are not stored.
//   POST /api/check  { "date": "2026-11-09", "cases": ["WPA/1234/2025", ...], "sides": ["appellate"] }
// sides: any of appellate, original, jalpaiguri, portblair (default: all).
const fs = require('fs');
const os = require('os');
const path = require('path');
const site = require('../watcher/court-site.js');
const { pickStore } = require('../watcher/store.js');
const { readList } = require('../tools/read-list.js');
const { buildIndex, search } = require('../src/parser.js');
const { requireUser } = require('../lib/auth.js');
const { logActivity } = require('../lib/activity.js');

const MAX_CASES = 500;
const CHECKS_PER_HOUR = Number(process.env.CHECKS_PER_HOUR) || 60;   // per person
const cache = new Map();   // url -> { at, list }: reused while this function instance stays warm

const KIND = { daily: 'Daily', supplementary: 'Supplementary', monthly: 'Monthly' };
const SIDE_NAME = { appellate: 'Appellate Side', original: 'Original Side', jalpaiguri: 'Jalpaiguri', portblair: 'Port Blair' };
const listKind = entries => {
  const n = { daily: 0, supplementary: 0, monthly: 0 };
  for (const e of entries) { const t = e.list || ''; if (/SUPPLEMENTARY/.test(t)) n.supplementary++; else if (/MONTHLY/.test(t)) n.monthly++; else if (/DAILY/.test(t)) n.daily++; }
  return Object.keys(n).sort((a, b) => n[b] - n[a])[0];
};
const shortDate = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/,/g, '');

async function fetchList(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.list;
  const { bytes, isPdf } = await site.download(url);
  if (!isPdf) return null;
  const file = path.join(os.tmpdir(), `check-${Buffer.from(url).toString('base64url').slice(-40)}.pdf`);
  fs.writeFileSync(file, bytes);
  try {
    const list = await readList(file);
    cache.set(url, { at: Date.now(), list });
    return list;
  } finally { fs.unlinkSync(file); }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST with { date, cases }.' });
  const user = requireUser(req, res); if (!user) return;
  const t0 = Date.now();
  const { date, cases } = req.body || {};
  const sides = (Array.isArray(req.body?.sides) ? req.body.sides : Object.keys(site.SIDES)).filter(s => site.SIDES[s]);
  const wanted = side => !side || sides.includes(side);   // a notice whose title names no side is always read
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'date must look like 2026-11-09' });
  if (!Array.isArray(cases) || !cases.length) return res.status(400).json({ error: 'Add at least one case.' });
  if (cases.length > MAX_CASES) return res.status(400).json({ error: `At most ${MAX_CASES} cases per check.` });
  if (!sides.length) return res.status(400).json({ error: 'Pick at least one side.' });
  try {
    if (await pickStore().hit(`check:${user.email}`) > CHECKS_PER_HOUR) {
      await logActivity(req, 'check-refused', user, { date, sides, cases: cases.length, reason: `over ${CHECKS_PER_HOUR} checks this hour` });
      return res.status(429).json({ error: `That's more than ${CHECKS_PER_HOUR} checks this hour. Try again later.` });
    }
  } catch { /* storage unavailable: don't block the check */ }

  // Which PDFs: each bench's daily list in the archive, and notices for this date the watcher has logged.
  const day = new Date(date + 'T00:00:00Z');
  const sources = sides.map(side => ({ url: site.archiveUrl(side, 'daily', day), via: 'archive', side }));
  try {
    const state = await pickStore().loadState();
    for (const [id, n] of Object.entries(state.notices || {})) {
      if (n.hearingDate === date && (n.type === 'daily' || n.type === 'supplementary')) {
        if (wanted(n.side)) sources.push({ url: `${site.BASE}/Notice-Files/CL/${id}`, via: 'notice', side: n.side });
      }
    }
  } catch { /* storage unavailable: the notices scan below still finds them */ }
  // Also read the court's notices pages, newest first, back to a few days before the date. This finds
  // supplementary and vacation lists posted before the watcher started, or between its checks.
  const known = new Set(sources.map(s => s.url));
  const listDates = new Set();   // hearing dates that have a daily list, to suggest when this date has none
  const stopBefore = new Date(day.getTime() - 4 * 86400e3).toISOString().slice(0, 10);
  for (let page = 1; page <= 10; page++) {
    let notices;
    try { notices = await site.fetchNotices(page); } catch { break; }
    for (const n of notices) {
      const t = site.describeTitle(n.title);
      const url = `${site.BASE}/Notice-Files/CL/${n.id}`;
      if (t.type === 'daily' && t.hearingDate) listDates.add(t.hearingDate);
      if (t.hearingDate === date && (t.type === 'daily' || t.type === 'supplementary') && !known.has(url)) {
        known.add(url); if (wanted(t.side)) sources.push({ url, via: 'notice', side: t.side });
      }
    }
    if (!notices.length || notices.every(n => (n.uploadedAt || '').slice(0, 10) < stopBefore)) break;
  }

  const lists = [], entries = [], raw = new Map(), seenSizes = new Set();
  const problems = [];
  for (const s of sources) {
    try {
      if (s.via === 'archive' && !(await site.probeArchive(s.url))) continue;   // no daily list for that date
      const list = await fetchList(s.url);
      if (!list || !list.entries.length) continue;
      // A daily list posted both as a notice and in the archive is the same file: read it once.
      const sig = `${list.pages}|${list.entries.length}|${list.entries[0].caseNo}`;
      if (seenSizes.has(sig)) continue;
      seenSizes.add(sig);
      const kind = listKind(list.entries);
      const sideName = SIDE_NAME[s.side] || 'Side not stated';
      const label = `${KIND[kind] || 'List'} · ${shortDate(date)} · ${sideName}${kind === 'supplementary' && list.entries[0].court ? ` · Court ${list.entries[0].court}` : ''}`;
      for (const e of list.entries) entries.push({ ...e, src: label, kind, side: s.side || null, sideName, dateKey: date, dateShort: shortDate(date) });
      for (const [k, pages] of list.raw) { const set = raw.get(k) || raw.set(k, new Set()).get(k); for (const p of pages) set.add(`${label} p. ${p}`); }
      lists.push({ label, kind, side: s.side || null, sideName, pages: list.pages, count: list.entries.length, url: s.url });
    } catch (e) {
      problems.push(`${s.url}: ${e.code || e.message}`);
    }
  }

  const index = buildIndex(entries, raw);
  const results = search(index, cases.map(String)).map(r => ({
    ...r,
    // A broad name ("State of West Bengal") can match thousands of rows: send the first 300.
    hits: r.hits.slice(0, 300).map(({ _key, _type, ...e }) => e), truncated: r.hits.length > 300 ? r.hits.length : undefined,
    linked: (r.linked || []).map(({ _key, _type, ...e }) => e),
    near: (r.near || []).map(({ _key, _type, ...e }) => e),
  }));
  // No list for this date: the nearest earlier and later dates that had one.
  let nearby = [];
  if (!lists.length) {
    const sorted = [...listDates].sort();
    const before = sorted.filter(d => d < date).pop(), after = sorted.find(d => d > date);
    nearby = [before, after].filter(Boolean);
  }
  await logActivity(req, 'check', user, { date, sides, cases: cases.length, found: results.filter(r => r.hits.length).length, lists: lists.length, ms: Date.now() - t0, error: problems.length ? `${problems.length} list(s) unreadable` : undefined });
  res.status(200).json({ date, sides, lists, results, problems, nearby });
};

// The activity log, for admins (ADMIN_EMAILS) only.
//   GET /api/log                 newest 5,000 entries as JSON (for the owner's page)
//   GET /api/log?format=csv      the whole log (up to 50,000 entries) as a CSV file
//   GET /api/log?kind=watcher    the watcher's log instead (lists found on the court website)
//   GET /api/log?kind=ecourts    the last eCourts case page that wasn't fully understood (kept 30 minutes)
const auth = require('../lib/auth.js');
const { pickStore } = require('../watcher/store.js');

const COLS = { activity: ['at', 'action', 'email', 'name', 'ip', 'date', 'sides', 'cases', 'found', 'lists', 'ms', 'target', 'reason', 'error', 'agent'],
  watcher: ['foundAt', 'source', 'type', 'side', 'hearingDate', 'title', 'uploadedAt', 'cases', 'problem'] };
const cell = v => { const s = v == null ? '' : Array.isArray(v) ? v.join(' ') : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await auth.requireUser(req, res); if (!user) return;
  if (!user.admin) return res.status(403).json({ error: 'Only admins can read the log.' });
  if (req.query?.kind === 'ecourts') return res.status(200).json(await pickStore().tmpGet('ec-debug'));   // the last eCourts page not fully understood
  const kind = req.query?.kind === 'watcher' ? 'watcher' : 'activity';
  const csv = req.query?.format === 'csv';
  const store = pickStore();
  const n = csv ? 50000 : 5000;
  let rows = kind === 'watcher' ? await store.recent(n) : await store.activityRecent(n);
  if (kind === 'watcher') rows = rows.map(r => ({ ...r, cases: r.result && typeof r.result === 'object' ? r.result.cases : null }));
  rows.reverse();
  if (!csv) return res.status(200).json({ kind, rows });
  const head = COLS[kind];
  const body = [head.join(','), ...rows.map(r => head.map(k => cell(r[k])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="causelistfinder-${kind}-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.status(200).send(body + '\n');
};

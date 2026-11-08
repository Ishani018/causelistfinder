// Can this Vercel region reach the court website? Fetches the newest cause-list notices and probes
// tomorrow's Appellate Side daily list in the archive. Read-only; stores nothing.
const site = require('../watcher/court-site.js');

module.exports = async (req, res) => {
  const t0 = Date.now();
  const out = { region: process.env.VERCEL_REGION || 'local', checkedAt: new Date().toISOString() };
  try {
    const notices = await site.fetchNotices(1);
    out.notices = { ok: true, ms: Date.now() - t0, count: notices.length, newest: notices[0] || null };
  } catch (e) {
    out.notices = { ok: false, ms: Date.now() - t0, error: e.code || e.message };
  }
  const t1 = Date.now();
  try {
    const tomorrow = new Date(Date.now() + (5.5 + 24) * 3600e3);
    const url = site.archiveUrl('appellate', 'daily', tomorrow);
    out.archive = { ok: true, ms: 0, url, file: await site.probeArchive(url) };
    out.archive.ms = Date.now() - t1;
  } catch (e) {
    out.archive = { ok: false, ms: Date.now() - t1, error: e.code || e.message };
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(out.notices.ok ? 200 : 502).json(out);
};

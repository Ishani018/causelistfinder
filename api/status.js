// Signed-in people only, read-only: when the watcher last checked and what it has logged recently.
const { pickStore } = require('../watcher/store.js');
const { requireUser } = require('../lib/auth.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireUser(req, res)) return;
  try {
    const store = pickStore();
    const [state, recent, notes] = await Promise.all([store.loadState(), store.recent(30), store.notes()]);
    res.status(200).json({
      lastCheck: state.lastRun || null,
      consecutiveFailures: state.failures || 0,
      lastRejectedCall: notes.lastRejectedCall || null,
      listsSeen: Object.keys(state.notices).length + Object.keys(state.archive).length,
      recent: recent.reverse().map(r => ({
        foundAt: r.foundAt, source: r.source, title: r.title || null, uploadedAt: r.uploadedAt || null,
        type: r.type || null, side: r.side || null, hearingDate: r.hearingDate || null,
        cases: r.result && typeof r.result === 'object' ? r.result.cases : null, problem: r.problem || null,
      })),
    });
  } catch (e) {
    // Names only, never values: enough to see whether storage and the secret reached this deployment.
    const names = Object.keys(process.env).filter(k => /KV|REDIS|UPSTASH|CRON|TELEGRAM/.test(k)).sort();
    res.status(503).json({ error: e.message, environment: process.env.VERCEL_ENV || null, deployment: process.env.VERCEL_URL || null, settingsSeen: names });
  }
};

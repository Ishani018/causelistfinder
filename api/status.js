// Public, read-only: when the watcher last checked and what it has logged recently.
const { pickStore } = require('../watcher/store.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const store = pickStore();
    const [state, recent] = await Promise.all([store.loadState(), store.recent(30)]);
    res.status(200).json({
      lastCheck: state.lastRun || null,
      consecutiveFailures: state.failures || 0,
      listsSeen: Object.keys(state.notices).length + Object.keys(state.archive).length,
      recent: recent.reverse().map(r => ({
        foundAt: r.foundAt, source: r.source, title: r.title || null, uploadedAt: r.uploadedAt || null,
        cases: r.result && typeof r.result === 'object' ? r.result.cases : null, problem: r.problem || null,
      })),
    });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
};

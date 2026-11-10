// One watcher check, called every few minutes by a scheduler (cron-job.org, or Vercel Cron on Pro).
// Needs CRON_SECRET: callers send "Authorization: Bearer <CRON_SECRET>" (Vercel Cron does this itself),
// so nobody else can make it hit the court website.
const { runOnce } = require('../watcher/watch.js');
const { fetchPaused } = require('../lib/pause.js');
const { pickStore } = require('../watcher/store.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'Set CRON_SECRET in the Vercel project settings first.' });
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${secret}`) {
    // Record why (never the value) so the status page can show a scheduler that is set up wrongly.
    const why = !auth ? 'no Authorization header' : !auth.startsWith('Bearer ') ? 'header does not start with "Bearer "'
      : auth.trim() !== auth || auth.slice(7).trim() !== auth.slice(7) ? 'extra spaces around the secret' : 'secret does not match CRON_SECRET';
    try { await pickStore().note('lastRejectedCall', { at: new Date().toISOString(), why, userAgent: (req.headers['user-agent'] || '').slice(0, 80) }); } catch {}
    return res.status(401).json({ error: `Wrong or missing Authorization header (${why}).` });
  }
  try {
    // ?archive=1 also probes the archive now; ?reset=1 forgets which lists were seen (the log is kept) and reads them again.
    if (fetchPaused()) return res.status(200).json({ skipped: 'paused: fetching from court websites is switched off (lib/pause.js)' });
    res.status(200).json(await runOnce({ forceArchive: req.query?.archive === '1', reset: req.query?.reset === '1' }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

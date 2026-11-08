// One watcher check, called every few minutes by a scheduler (cron-job.org, or Vercel Cron on Pro).
// Needs CRON_SECRET: callers send "Authorization: Bearer <CRON_SECRET>" (Vercel Cron does this itself),
// so nobody else can make it hit the court website.
const { runOnce } = require('../watcher/watch.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'Set CRON_SECRET in the Vercel project settings first.' });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Wrong or missing Authorization header.' });
  try {
    res.status(200).json(await runOnce({ forceArchive: req.query?.archive === '1' }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

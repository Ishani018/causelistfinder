// POST: ends this browser's sign-in.
const auth = require('../lib/auth.js');
const { logActivity } = require('../lib/activity.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const user = await auth.getUser(req);
  auth.clearSession(res);
  if (user) await logActivity(req, 'logout', user);
  res.status(200).json({ ok: true });
};

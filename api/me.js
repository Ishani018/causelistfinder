// Who is signed in (or null), and what the sign-in screen needs. Logs each page open by a signed-in person.
const auth = require('../lib/auth.js');
const { fetchPaused } = require('../lib/pause.js');
const { logActivity } = require('../lib/activity.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await auth.getUser(req);
  if (user && req.query?.open) await logActivity(req, 'open', user);
  res.status(200).json({ user, paused: fetchPaused(), mode: auth.mode(), clientId: process.env.GOOGLE_CLIENT_ID || null, sessionHours: auth.sessionHours() });
};

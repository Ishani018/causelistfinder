// POST { credential } (the ID token from Google's sign-in button): signs in an invited person.
const auth = require('../lib/auth.js');
const { logActivity } = require('../lib/activity.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!process.env.GOOGLE_CLIENT_ID || !auth.secret()) return res.status(503).json({ error: 'Sign-in is not set up yet (GOOGLE_CLIENT_ID).' });
  const credential = req.body?.credential;
  if (typeof credential !== 'string' || credential.length > 4096) return res.status(400).json({ error: 'No sign-in token.' });
  let who;
  try { who = await auth.verifyGoogle(credential); } catch (e) {
    await logActivity(req, 'login-refused', null, { reason: e.message });
    return res.status(401).json({ error: e.message });
  }
  if (!(await auth.isAllowed(who.email))) {
    await logActivity(req, 'login-refused', who, { reason: 'not invited' });
    return res.status(403).json({ error: `${who.email} isn't invited. Ask the owner to add you.`, email: who.email });
  }
  const expires = auth.setSession(res, who);
  await logActivity(req, 'login', who, { expires });
  res.status(200).json({ user: { ...who, expires, admin: auth.isAdmin(who.email) } });
};

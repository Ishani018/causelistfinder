// POST { credential } (the ID token from Google's sign-in button): signs in an invited person.
// POST { username, password }: the temporary shared login, while SITE_USERNAME / SITE_PASSWORD are set.
const auth = require('../lib/auth.js');
const { logActivity } = require('../lib/activity.js');
const { pickStore } = require('../watcher/store.js');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (auth.mode() === 'none' || !auth.secret()) return res.status(503).json({ error: 'Sign-in is not set up yet.' });
  if (auth.mode() === 'password') {
    // At most 10 tries an hour from one address, so the password can't be guessed by brute force.
    try { if (await pickStore().hit(`login:${auth.clientIp(req)}`) > 10) return res.status(429).json({ error: 'Too many tries. Wait an hour and try again.' }); } catch {}
    const { username, password } = req.body || {};
    if (!auth.checkPassword(username, password)) {
      await logActivity(req, 'login-refused', { email: String(username || '').slice(0, 60).toLowerCase() || null }, { reason: 'wrong username or password' });
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    const who = { email: process.env.SITE_USERNAME.trim().toLowerCase(), name: process.env.SITE_USERNAME.trim(), shared: true };
    const expires = auth.setSession(res, who);
    await logActivity(req, 'login', who, { expires, reason: 'shared login' });
    return res.status(200).json({ user: { email: who.email, name: who.name, expires, admin: auth.isAdmin(who.email), shared: true } });
  }
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

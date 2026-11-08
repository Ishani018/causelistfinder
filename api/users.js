// Who may sign in, managed from the owner's page. Admins (ADMIN_EMAILS) only.
//   GET    /api/users                      everyone who may sign in, and where that comes from
//   POST   /api/users  { email, note }     invite someone
//   DELETE /api/users  { email }           remove someone; they are signed out at their next request
const auth = require('../lib/auth.js');
const { pickStore } = require('../watcher/store.js');
const { logActivity } = require('../lib/activity.js');

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await auth.requireUser(req, res); if (!user) return;
  if (!user.admin) return res.status(403).json({ error: 'Only the owner can manage people.' });
  const store = pickStore();
  if (req.method === 'POST' || req.method === 'DELETE') {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'That doesn\'t look like an email address.' });
    if (req.method === 'POST') {
      await store.userSet(email, { addedAt: new Date().toISOString(), addedBy: user.email, note: String(req.body?.note || '').slice(0, 120) });
      await logActivity(req, 'invite', user, { target: email });
    } else {
      if (auth.fixed().includes(email)) return res.status(400).json({ error: `${email} is set in Vercel (ADMIN_EMAILS / ALLOWED_EMAILS). Remove it there.` });
      await store.userSet(email, null);
      await logActivity(req, 'remove', user, { target: email });
    }
  } else if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET, POST or DELETE.' });
  const invited = await store.users();
  const people = [
    ...auth.admins().map(email => ({ email, role: 'owner', source: 'vercel' })),
    ...auth.emails(process.env.ALLOWED_EMAILS).filter(e => !auth.isAdmin(e)).map(email => ({ email, role: 'user', source: 'vercel' })),
    ...Object.entries(invited).filter(([e]) => !auth.fixed().includes(e)).map(([email, i]) => ({ email, role: 'user', source: 'invited', ...i })),
  ];
  res.status(200).json({ people });
};

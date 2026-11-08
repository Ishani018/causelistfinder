// Sign-in with Google, for invited people only. The page gets a Google ID token, /api/login checks it
// with Google and sets a signed session cookie; every other API call checks that cookie.
// Settings (Vercel → Project → Settings → Environment Variables):
//   GOOGLE_CLIENT_ID  the OAuth client ID from Google Cloud Console (Web application)
//   ADMIN_EMAILS      the owner(s): may always sign in, and open the owner's page (/admin.html)
//   ALLOWED_EMAILS    optional: people who may always sign in, comma-separated
// Everyone else is invited or removed from the owner's page; those invites are kept in storage.
//   SESSION_HOURS     how long a sign-in lasts (default 168 = 7 days)
//   AUTH_SECRET       signs the cookie (optional: derived from CRON_SECRET when unset)
// Until GOOGLE_CLIENT_ID is set, sign-in is off and the site is open to anyone (checks are still logged and limited, by IP).
// Removing someone locks them out at their next request, even mid-session.
const crypto = require('crypto');
const { pickStore } = require('../watcher/store.js');

const COOKIE = 'clf_session';
const emails = v => (v || '').split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
const admins = () => emails(process.env.ADMIN_EMAILS);
const isAdmin = email => admins().includes(email);
const fixed = () => [...emails(process.env.ALLOWED_EMAILS), ...admins()];
// May this email sign in? Set in Vercel, or invited from the owner's page.
async function isAllowed(email) {
  if (fixed().includes(email)) return true;
  try { return Boolean((await pickStore().users())[email]); } catch { return false; }
}
const signInOn = () => Boolean(process.env.GOOGLE_CLIENT_ID);
const sessionHours = () => Number(process.env.SESSION_HOURS) > 0 ? Number(process.env.SESSION_HOURS) : 168;

function secret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.CRON_SECRET) return crypto.createHmac('sha256', process.env.CRON_SECRET).update('clf session cookie').digest('hex');
  return null;
}
const sign = body => crypto.createHmac('sha256', secret()).update(body).digest('base64url');

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// The signed-in person, or null: a valid, unexpired cookie for an email that is still invited.
async function getUser(req) {
  const raw = cookies(req)[COOKIE];
  if (!raw || !secret()) return null;
  const [body, mac] = raw.split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body)), got = Buffer.from(mac);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  let s; try { s = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!s.email || !(s.exp > Date.now()) || !(await isAllowed(s.email))) return null;
  return { email: s.email, name: s.name || '', expires: new Date(s.exp).toISOString(), admin: isAdmin(s.email) };
}

function setSession(res, { email, name }) {
  const exp = Date.now() + sessionHours() * 3600e3;
  const body = Buffer.from(JSON.stringify({ email, name, exp })).toString('base64url');
  res.setHeader('Set-Cookie', `${COOKIE}=${body}.${sign(body)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.round(sessionHours() * 3600)}`);
  return new Date(exp).toISOString();
}
function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

// Ask Google whether the ID token is genuine and meant for this site. The token goes in the POST body.
async function verifyGoogle(idToken) {
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken }),
  });
  if (!res.ok) throw new Error('Google did not accept the sign-in');
  const t = await res.json();
  if (t.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('Sign-in was for a different site');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(t.iss)) throw new Error('Unexpected issuer');
  if (!(Number(t.exp) * 1000 > Date.now())) throw new Error('Sign-in expired');
  if (t.email_verified !== 'true' && t.email_verified !== true) throw new Error('Google has not verified this email');
  return { email: String(t.email).toLowerCase(), name: t.name || '' };
}

// For API handlers: the user, or a 401 already sent.
async function requireUser(req, res) {
  if (!signInOn()) return { email: null, name: '', guest: true, admin: false };
  const user = await getUser(req);
  if (!user) { res.setHeader('Cache-Control', 'no-store'); res.status(401).json({ error: 'Sign in first.', signIn: true }); }
  return user;
}

const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

module.exports = { signInOn, getUser, setSession, clearSession, verifyGoogle, requireUser, isAllowed, fixed, admins, isAdmin, emails, sessionHours, secret, clientIp };

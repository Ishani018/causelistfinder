// The website's activity log: every sign-in (and refused sign-in), sign-out, page open and check, with
// who, when and from where. Case numbers are not logged, only how many were checked and found.
const { pickStore } = require('../watcher/store.js');
const { clientIp } = require('./auth.js');

async function logActivity(req, action, who, detail = {}) {
  const rec = {
    at: new Date().toISOString(), action,
    email: who?.email || null, name: who?.name || null,
    ip: clientIp(req) || null,
    agent: String(req.headers['user-agent'] || '').slice(0, 160) || null,
    ...detail,
  };
  try { await pickStore().activity(rec); } catch (e) { console.error('activity log:', e.message, JSON.stringify(rec)); }
  return rec;
}

module.exports = { logActivity };

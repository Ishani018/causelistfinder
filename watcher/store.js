// Where the watcher keeps what it has seen and its log: local files, or Upstash Redis on Vercel
// (functions there keep nothing between runs).
const fs = require('fs');
const os = require('os');
const path = require('path');

const EMPTY_STATE = () => ({ notices: {}, archive: {}, heartbeats: {}, lastArchiveCheck: null, failures: 0 });

const hits = new Map(), temp = new Map();   // hourly counters and short-lived values for local runs (Redis keeps them on Vercel)

function fileStore(dir) {
  const pdfDir = path.join(dir, 'pdfs');
  fs.mkdirSync(pdfDir, { recursive: true });
  const stateFile = path.join(dir, 'state.json');
  const logFile = path.join(dir, 'log.jsonl');
  const activityFile = path.join(dir, 'activity.jsonl');
  const usersFile = path.join(dir, 'users.json');
  return {
    kind: 'files', pdfDir, keepPdfs: true,
    async loadState() { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return EMPTY_STATE(); } },
    async saveState(s) { fs.writeFileSync(stateFile, JSON.stringify(s, null, 1)); },
    async log(rec) { fs.appendFileSync(logFile, JSON.stringify(rec) + '\n'); },
    async recent(n) {
      try { return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-n).map(l => JSON.parse(l)); } catch { return []; }
    },
    async lock() { return true; },
    async unlock() {},
    async note() {},
    async notes() { return {}; },
    async activity(rec) { fs.appendFileSync(activityFile, JSON.stringify(rec) + '\n'); },
    async activityRecent(n) {
      try { return fs.readFileSync(activityFile, 'utf8').split('\n').filter(Boolean).slice(-n).map(l => JSON.parse(l)); } catch { return []; }
    },
    async users() { try { return JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch { return {}; } },
    async userSet(email, info) { const u = await this.users(); if (info) u[email] = info; else delete u[email]; fs.writeFileSync(usersFile, JSON.stringify(u, null, 1)); },
    async tmpSet(key, value) { temp.set(key, { value, until: Date.now() + 1800e3 }); },
    async tmpGet(key) { const t = temp.get(key); return t && t.until > Date.now() ? t.value : null; },
    async hit(key) { const k = key + '|' + Math.floor(Date.now() / 3600e3); hits.set(k, (hits.get(k) || 0) + 1); return hits.get(k); },
  };
}

// Upstash's REST API: POST a command as a JSON array. Vercel's Upstash integration sets KV_REST_API_*.
function redisStore(url, token) {
  const call = async (...cmd) => {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(cmd) });
    const out = await res.json();
    if (out.error) throw new Error(`Redis ${cmd[0]}: ${out.error}`);
    return out.result;
  };
  const LOG_KEEP = 20000, ACTIVITY_KEEP = 50000;
  return {
    kind: 'redis', pdfDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lists-')), keepPdfs: false,
    async loadState() { const s = await call('GET', 'clf:state'); return s ? JSON.parse(s) : EMPTY_STATE(); },
    async saveState(s) { await call('SET', 'clf:state', JSON.stringify(s)); },
    async log(rec) { await call('RPUSH', 'clf:log', JSON.stringify(rec)); await call('LTRIM', 'clf:log', -LOG_KEEP, -1); },
    async recent(n) { return (await call('LRANGE', 'clf:log', -n, -1)).map(l => JSON.parse(l)); },
    // One check at a time, even if two schedulers fire together; expires on its own after 5 minutes.
    async lock() { return (await call('SET', 'clf:lock', String(Date.now()), 'NX', 'EX', 300)) === 'OK'; },
    async unlock() { await call('DEL', 'clf:lock'); },
    // Small facts for the status page, e.g. the last call that was turned away.
    async note(key, value) { await call('HSET', 'clf:notes', key, JSON.stringify(value)); },
    async notes() { const r = await call('HGETALL', 'clf:notes') || []; const o = {}; for (let i = 0; i < r.length; i += 2) o[r[i]] = JSON.parse(r[i + 1]); return o; },
    // Who signed in and what they did on the website (see lib/activity.js). Kept apart from the watcher's log.
    async activity(rec) { await call('RPUSH', 'clf:activity', JSON.stringify(rec)); await call('LTRIM', 'clf:activity', -ACTIVITY_KEEP, -1); },
    async activityRecent(n) { return (await call('LRANGE', 'clf:activity', -n, -1)).map(l => JSON.parse(l)); },
    // People invited from the owner's page: email -> { addedAt, addedBy, note }. Pass no info to remove.
    async users() { const r = await call('HGETALL', 'clf:users') || []; const o = {}; for (let i = 0; i < r.length; i += 2) o[r[i]] = JSON.parse(r[i + 1]); return o; },
    async userSet(email, info) { if (info) await call('HSET', 'clf:users', email, JSON.stringify(info)); else await call('HDEL', 'clf:users', email); },
    // Short-lived values (e.g. an eCourts session while someone types its captcha): gone after 30 minutes.
    async tmpSet(key, value) { await call('SET', `clf:tmp:${key}`, JSON.stringify(value), 'EX', 1800); },
    async tmpGet(key) { const v = await call('GET', `clf:tmp:${key}`); return v ? JSON.parse(v) : null; },
    // Calls this hour for a key (e.g. checks by one person); the counter expires on its own.
    async hit(key) {
      const k = `clf:hits:${key}:${Math.floor(Date.now() / 3600e3)}`;
      const n = await call('INCR', k); if (n === 1) await call('EXPIRE', k, 3700);
      return n;
    },
  };
}

// Vercel's Upstash integration names its variables KV_REST_API_URL / _TOKEN, or with a custom prefix
// chosen when connecting (e.g. STORAGE_KV_REST_API_URL); older setups use UPSTASH_REDIS_REST_URL / _TOKEN.
function upstashEnv(env = process.env) {
  for (const urlKey of Object.keys(env).filter(k => /(^|_)(KV_REST_API|UPSTASH_REDIS_REST)_URL$/.test(k)).sort((a, b) => a.length - b.length)) {
    const token = env[urlKey.replace(/_URL$/, '_TOKEN')];
    if (env[urlKey] && token) return { url: env[urlKey], token };
  }
  return null;
}

function pickStore() {
  const up = upstashEnv();
  if (up) return redisStore(up.url, up.token);
  if (process.env.VERCEL) throw new Error('No storage connected: add an Upstash Redis store to this Vercel project');
  return fileStore(process.env.WATCH_DATA_DIR || path.join(__dirname, '..', 'data'));
}

module.exports = { pickStore, fileStore, redisStore, upstashEnv };

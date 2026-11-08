// Where the watcher keeps what it has seen and its log: local files, or Upstash Redis on Vercel
// (functions there keep nothing between runs).
const fs = require('fs');
const os = require('os');
const path = require('path');

const EMPTY_STATE = () => ({ notices: {}, archive: {}, heartbeats: {}, lastArchiveCheck: null, failures: 0 });

function fileStore(dir) {
  const pdfDir = path.join(dir, 'pdfs');
  fs.mkdirSync(pdfDir, { recursive: true });
  const stateFile = path.join(dir, 'state.json');
  const logFile = path.join(dir, 'log.jsonl');
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
  const LOG_KEEP = 20000;
  return {
    kind: 'redis', pdfDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lists-')), keepPdfs: false,
    async loadState() { const s = await call('GET', 'clf:state'); return s ? JSON.parse(s) : EMPTY_STATE(); },
    async saveState(s) { await call('SET', 'clf:state', JSON.stringify(s)); },
    async log(rec) { await call('RPUSH', 'clf:log', JSON.stringify(rec)); await call('LTRIM', 'clf:log', -LOG_KEEP, -1); },
    async recent(n) { return (await call('LRANGE', 'clf:log', -n, -1)).map(l => JSON.parse(l)); },
    // One check at a time, even if two schedulers fire together; expires on its own after 5 minutes.
    async lock() { return (await call('SET', 'clf:lock', String(Date.now()), 'NX', 'EX', 300)) === 'OK'; },
    async unlock() { await call('DEL', 'clf:lock'); },
  };
}

function pickStore() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisStore(url, token);
  if (process.env.VERCEL) throw new Error('No storage connected: add an Upstash Redis store to this Vercel project');
  return fileStore(process.env.WATCH_DATA_DIR || path.join(__dirname, '..', 'data'));
}

module.exports = { pickStore, fileStore, redisStore };

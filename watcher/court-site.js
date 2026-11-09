// Everything that knows about the Calcutta High Court website: where lists are and how notices look.
const { request } = require('./http.js');
const BASE = 'https://www.calcuttahighcourt.gov.in';
const USER_AGENT = 'CauseListFinder/0.1 (cause list watcher; https://github.com/Ishani018/causelistfinder)';

// Archive folders and file prefixes, as used by the site's own Cause Lists page.
const SIDES = {
  appellate: { folder: 'AS', file: 'cla' },
  original: { folder: 'OS', file: 'cl' },
  jalpaiguri: { folder: 'J', file: 'clj' },
  portblair: { folder: 'PB', file: 'clpb' },
};
const ARCHIVE_TYPES = { daily: '', monthly: 'monthly/', supplementary: 'supplementary/' };

const ddmmyyyy = d => `${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}${d.getUTCFullYear()}`;
function archiveUrl(side, type, date) {
  const s = SIDES[side];
  return `${BASE}/downloads/old_cause_lists/${ARCHIVE_TYPES[type]}${s.folder}/${s.file}${ddmmyyyy(date)}.pdf`;
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const decode = s => s.replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// "08-Nov-2026 10:21:03" (IST) -> ISO string with +05:30.
function istStamp(s) {
  const m = s.match(/(\d{2})-(\w{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[3]}-${String(MONTHS[m[2]] + 1).padStart(2, '0')}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
}

// Notices page (/Notices/CL?page=N): newest first, each a link with a title and an upload stamp.
function parseNotices(html) {
  const out = [];
  const re = /href="([^"]*\/Notice-Files\/CL\/(\d+))"[\s\S]*?<strong>([\s\S]*?)<\/strong>[\s\S]*?Uploaded:\s*(\d{2}-\w{3}-\d{4} \d{2}:\d{2}:\d{2})/g;
  let m;
  while ((m = re.exec(html))) out.push({ id: m[2], url: m[1], title: decode(m[3]), uploadedAt: istStamp(m[4]) });
  return out;
}

// What a notice title says about the list: type, side, hearing date, court.
function describeTitle(title) {
  const t = title.toUpperCase();
  const type = /SUPPLEMENTARY/.test(t) ? 'supplementary' : /MONTHLY/.test(t) ? 'monthly' : /LOK ADALAT/.test(t) ? 'lok adalat'
    : /CAUSE ?L?IS?T/.test(t) ? 'daily' : 'notice';   // the court's titles have typos: CAUSELIST, CAUSEIST
  const side = /ORIGINAL SIDE/.test(t) ? 'original' : /JALPAIGURI/.test(t) ? 'jalpaiguri' : /PORT BLAIR/.test(t) ? 'portblair' : /APPELLATE/.test(t) ? 'appellate' : '';
  const d = t.match(/(\d{2})[.\-/](\d{2})[.\-/](\d{4})/);
  const court = t.match(/COURT NO\.?\s*([0-9A-Z]+)/);
  return { type, side, hearingDate: d ? `${d[3]}-${d[2]}-${d[1]}` : null, court: court ? court[1] : null, vacation: /VACATION/.test(t) };
}

const get = (url, method = 'GET') => request(url, { method, headers: { 'User-Agent': USER_AGENT } });

async function fetchNotices(page = 1) {
  const res = await get(`${BASE}/Notices/CL?page=${page}`);
  if (!res.ok) throw new Error(`notices page ${page}: HTTP ${res.status}`);
  return parseNotices(res.body.toString('utf8'));
}

// HEAD an archive file: exists?, size and the server's upload time.
async function probeArchive(url) {
  const res = await get(url, 'HEAD');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const lm = res.headers['last-modified'];
  return { size: +res.headers['content-length'] || null, uploadedAt: lm ? new Date(lm).toISOString() : null };
}

async function download(url) {
  const res = await get(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = res.body;
  return { bytes, isPdf: /pdf/i.test(res.headers['content-type'] || '') || bytes.subarray(0, 5).toString() === '%PDF-' };
}

module.exports = { BASE, SIDES, archiveUrl, parseNotices, describeTitle, istStamp, fetchNotices, probeArchive, download };

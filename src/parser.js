// Cause-list parser: turns pdf.js text items into case entries with bench context.
// Case type: WPA, WP.ST, WPA(P), CRA(DB), and hyphenated ones such as AO-COM or FMAT-IPD.
const TYPE = '[A-Z][A-Z.]*(?:-[A-Z][A-Z.]*)*(?:\\([A-Z.]+\\))?(?:\\.[A-Z]+)?';
const CASE_RE = new RegExp(`^${TYPE}\\/\\d+\\/\\d{4}$`);
const SERIAL_RE = /^((wt)?\d+[A-Z]?|in|with|\(in)$/i;
const CASE_TOKEN_RE = new RegExp(`(?<![A-Z\\/-])${TYPE}\\/\\d+\\/\\d{4}\\b`, 'g');
// Original Side rows can start with the application: "1  IA NO. GA/1/2026 … In WPO/329/2026".
const IA_FIRST_RE = new RegExp(`^IA\\s*NO\\.?\\s*:?\\s*(${TYPE}\\/\\d+\\/\\d{4})$`, 'i');
const IN_MAIN_RE = new RegExp(`^\\(?in\\s+(${TYPE}\\/\\d+\\/\\d{4})\\)?$`, 'i');

function groupLines(items) {
  const rows = [];
  const sorted = items
    .filter(it => it.str && it.str.trim())
    .map(it => ({ x: it.transform[4], y: it.transform[5], s: it.str.trim() }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  for (const it of sorted) {
    const row = rows.length && rows[rows.length - 1];
    if (row && Math.abs(row.y - it.y) <= 3.5) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

function createParser() {
  const entries = [];
  const bench = { court: '', type: '', time: '', judges: [], date: '', list: '', notes: [], vc: '', notesText: null };
  let inHeader = false, headerDone = false;
  let section = '', lastWasSection = false;
  let cur = null, lastSerial = '';
  const rawCases = new Map();   // case key -> pages, from every case number printed anywhere

  const near = (a, b) => b != null && Math.abs(a - b) < 12;
  const isFooter = s => /^Page \d+ Of \d+$/i.test(s) || /^\(Bench ID/i.test(s) || /^\d+\/\d+$/.test(s);
  const HEADER_START = /^(MONTHLY|DAILY|SUPPLEMENTARY|WEEKLY|WARNING|ADVANCE|ADDITIONAL)?\s*CAUSE\s?LIST$/i;
  const DATE_RE = /^For\s+(.*\b(19|20)\d{2})$/i;

  function close() { if (cur) { entries.push(cur); cur = null; } }

  function addPage(items, pageNo) {
    const pageText = items.map(i => i.str).join(' ');
    for (const c of pageText.replace(/\s*\/\s*/g, '/').match(CASE_TOKEN_RE) || []) {
      const k = keyOf(c);
      const pages = rawCases.get(k) || rawCases.set(k, new Set()).get(k);
      pages.add(pageNo);
    }
    for (const row of groupLines(items)) {
      const its = row.items.filter(i => !isFooter(i.s));
      if (!its.length) continue;
      const text = its.map(i => i.s).join(' ').replace(/\s+/g, ' ');
      const wasSection = lastWasSection; lastWasSection = false;
      const setSection = () => { section = wasSection ? section + ' ' + text : text; lastWasSection = true; };

      if (/CAUSELIST COURT NO/i.test(text) || /^HIGH COURT OF CALCUTTA/i.test(text)) continue;
      if (/^(Appellate|Original) Side$/i.test(text)) { close(); continue; }

      if (HEADER_START.test(text)) {
        close();
        inHeader = true; headerDone = false; section = '';
        Object.assign(bench, { court: '', type: '', time: '', judges: [], date: '', list: text.replace(/\s+/g, ' ').toUpperCase(), notes: [], vc: '', notesText: null });
        continue;
      }
      if (inHeader && !headerDone) {
        let m;
        if ((m = text.match(DATE_RE))) { bench.date = m[1].replace(/(\d+)\s+(st|nd|rd|th)\b/i, '$1$2').replace(/\s+/g, ' ').trim(); continue; }
        if ((m = text.match(/^COURT NO\.?\s*(.+)$/i))) { bench.court = m[1].trim().replace(/^\.$/, ''); continue; }
        if ((m = text.match(/^AT\s+(\d{1,2}[:.]\d{2}\s*[AP]\.?\s?M\.?)$/i))) { bench.time = m[1].toUpperCase(); continue; }
        if (/^(THE\s+)?HON['’]?BLE\b|^LD\.\s/i.test(text)) { bench.judges.push(text); continue; }
        if (/BENCH|REGISTRAR/i.test(text) && !bench.type && !bench.judges.length) { bench.type = text; continue; }
        if (!bench.judges.length && its.length === 1 && text.length < 40) continue;  // floor / building lines
        headerDone = true;
      }

      const [a, b] = its;
      // "In WPO/329/2026" under an IA-first row is that row's main case, not a new item.
      if (b && cur && cur.awaitingMain && /^\(?in$/i.test(a.s) && CASE_RE.test(b.s.replace(/\s+/g, ''))) {
        cur.caseNo = b.s.replace(/\s+/g, ''); cur.awaitingMain = false;
        for (const it of its.slice(2)) place(it);
        continue;
      }
      const iaFirst = b && /^\d+[A-Z]?$/.test(a.s) && b.s.replace(/\s+/g, ' ').match(IA_FIRST_RE);
      if (b && SERIAL_RE.test(a.s) && (iaFirst || CASE_RE.test(b.s.replace(/\s+/g, '')))) {
        inHeader = false;
        close();
        const rest = its.slice(2);
        const rel = /^\(?(in|with)$/i.test(a.s) ? a.s.replace('(', '').toLowerCase() : (/^wt/i.test(a.s) ? 'with' : '');
        const serial = /^\(?(in|with)$/i.test(a.s) ? lastSerial : a.s.replace(/^wt/i, '');
        lastSerial = serial;
        const ax = rest.find(i => i.x > (rest[0] ? rest[0].x : b.x) + 100);
        cur = {
          serial, rel, caseNo: iaFirst ? null : b.s.replace(/\s+/g, ''), awaitingMain: !!iaFirst,
          remarks: [], parties: [], adv: [[], []], ia: iaFirst ? iaFirst[1].replace(/\s+/g, '') : '',
          cx: b.x, px: rest[0] && rest[0] !== ax ? rest[0].x : null, ax: ax ? ax.x : null, ax2: null,
          court: bench.court, benchType: bench.type, time: bench.time, judges: bench.judges.slice(),
          date: bench.date, list: bench.list, section, page: pageNo,
          benchNotes: bench.notesText ?? (bench.notesText = bench.notes.filter(n => n !== section).join(' ').replace(/\s+/g, ' ').trim()), vc: bench.vc,
        };
        for (const it of rest) place(it);
        continue;
      }
      if (inHeader) {
        let m;
        if ((m = text.match(/VC LINK\s*:?\s*(https?:\/\/\S+)/i))) bench.vc = m[1];
        else if (its.length === 1 && text.length < 40) setSection();
        if (!m) bench.notes.push(text);
        continue;
      }

      if (cur && /^IA NO\s*:/i.test(text)) { cur.ia = text.replace(/^IA NO\s*:\s*/i, ''); continue; }
      if (cur && cur.ia && /^(No:|\(Old|[A-Z]+\/\d+\/\d{4}[,(]|[A-Z]+\/\d+\/\d{4}$)/.test(text)) { cur.ia += ' ' + text; continue; }

      if (cur) {
        const aligned = its.every(i => near(i.x, cur.cx) || near(i.x, cur.px) || near(i.x, cur.ax) || near(i.x, cur.ax2) ||
          (cur.px == null && i.x > cur.cx + 60) || (cur.px != null && i.x > cur.px + 100));
        if (aligned) { for (const it of its) place(it); continue; }
        if (/^VS\.?$/i.test(its[0].s) && !cur.parties.some(p => /^VS\.?$/i.test(p))) { for (const it of its) cur.parties.push(it.s); continue; }
        close();
      }
      if (its.length === 1 && text.length < 80) setSection();
    }
  }

  function place(it) {
    if (cur.awaitingMain && it.x < (cur.px ?? Infinity) - 12) {
      const m = it.s.replace(/\s+/g, ' ').match(IN_MAIN_RE);
      if (m) { cur.caseNo = m[1].replace(/\s+/g, ''); cur.awaitingMain = false; return; }
    }
    if (cur.ax == null && cur.px != null && it.x > cur.px + 100) cur.ax = it.x;
    if (cur.px == null && it.x > cur.cx + 60 && (cur.ax == null || it.x < cur.ax - 12)) cur.px = it.x;
    if (cur.ax != null && it.x > cur.ax + 60 && cur.ax2 == null) cur.ax2 = it.x;
    if (cur.ax2 != null && it.x >= cur.ax2 - 12) cur.adv[1].push(it.s);
    else if (cur.ax != null && it.x >= cur.ax - 12) cur.adv[0].push(it.s);
    else if (cur.px != null && it.x >= cur.px - 12) cur.parties.push(it.s);
    else if (cur.px == null && it.x > cur.cx + 60) { cur.px = it.x; cur.parties.push(it.s); }
    else cur.remarks.push(it.s);
  }

  function finish() {
    close();
    const join = arr => arr.join(' ').replace(/\s+/g, ' ').trim();
    return entries.map(e => {
      const p = join(e.parties);
      const parts = p.split(/\s+VS\.?(?:\s+|$)/i);
      const remarks = join(e.remarks);
      const linked = (remarks + ' ' + p).match(CASE_TOKEN_RE) || [];
      return {
        serial: e.serial, rel: e.rel, caseNo: e.caseNo || e.ia,
        petitioner: (parts[0] || '').trim(), respondent: parts.slice(1).join(' VS ').trim(),
        advocate: join(e.adv[0]), advocate2: join(e.adv[1]),
        remarks, linked: [...new Set(linked)].filter(c => c !== e.caseNo), ia: e.ia,
        court: e.court, benchType: e.benchType, time: e.time, judges: e.judges,
        date: e.date, list: e.list, section: e.section, page: e.page, benchNotes: e.benchNotes, vc: e.vc,
      };
    });
  }
  return { addPage, finish, rawCases: () => rawCases };
}

// Normalise anything a lawyer might type into TYPE/NUM/YEAR.
// Whole lines as lawyers write them: "CAN 2/2024 in WPST/71/2015", "CPAN No. 2041 of 2024",
// "MAT/812/2026, CAN No. 1 of 2026", "WP 5120(W)/2019" (old writ numbering).
function normaliseCase(raw) {
  const s = raw.toUpperCase().replace(/[–—]/g, '-').replace(/&\s*\d*\s*OTHERS?.*$/, '').replace(/\bNO\b\.?/g, ' ')
    .replace(/^W\.?\s*P\.?\s*(\d+)\s*\(\s*W\s*\)/, 'WPA $1').replace(/\s+/g, ' ').trim();
  const parts = s.split(/\s+IN\s+/);
  if (parts.length > 1) { const n = parseOne(parts[parts.length - 1]); if (n) return n; }
  const pieces = s.split(/\s*[,;]\s*/).filter(Boolean);
  if (pieces.length > 1) { for (const p of pieces) { const n = parseOne(p); if (n && n.type !== 'CAN') return n; } }
  return parseOne(s);
}

function parseOne(raw) {
  let s = raw.toUpperCase().trim().replace(/\bOF\b/g, '/').replace(/[–—]/g, '-');
  const m = s.match(/^([A-Z][A-Z.\s]*?(?:-[A-Z][A-Z.]*)*(?:\(\s*[A-Z.\s]+\))?(?:\.[A-Z]+)?)\s*[\/\-\s.]\s*0*(\d+)\s*[\/\-\s]\s*(\d{2}|\d{4})$/);
  if (!m) return null;
  let type = m[1].replace(/\s+/g, '');
  type = type.replace(/\.(?=[A-Z])/g, '').replace(/\.$/, '');
  let year = m[3];
  if (year.length === 2) year = '20' + year;
  return { type, num: String(parseInt(m[2], 10)), year, key: `${type}/${parseInt(m[2], 10)}/${year}` };
}
const keyOf = caseNo => { const n = normaliseCase(caseNo); return n ? n.key : caseNo; };
const looseType = t => t.replace(/[.()]/g, '');

function buildIndex(entries, rawCases) {
  const byKey = new Map(), byNumYear = new Map();
  for (const e of entries) {
    const n = normaliseCase(e.caseNo); if (!n) continue;
    e._key = n.key; e._type = n.type;
    (byKey.get(n.key) || byKey.set(n.key, []).get(n.key)).push(e);
    const ny = `${n.num}/${n.year}`;
    (byNumYear.get(ny) || byNumYear.set(ny, []).get(ny)).push(e);
  }
  const byLinked = new Map();
  for (const e of entries) for (const c of e.linked || []) {
    const k = keyOf(c);
    (byLinked.get(k) || byLinked.set(k, []).get(k)).push(e);
  }
  return { entries, byKey, byNumYear, byLinked, rawCases: rawCases || new Map() };
}

// Each query line is a case number or a name (advocate / party).
function search(index, lines) {
  const out = [];
  for (const raw of lines) {
    const q = raw.trim(); if (!q) continue;
    const n = normaliseCase(q);
    if (n) {
      let hits = index.byKey.get(n.key) || [];
      if (!hits.length) hits = (index.byNumYear.get(`${n.num}/${n.year}`) || []).filter(e => looseType(e._type) === looseType(n.type));
      const linked = index.byLinked.get(n.key) || [];
      const similar = t => { const x = looseType(t), y = looseType(n.type); return x.startsWith(y) || y.startsWith(x); };
      const near = hits.length || linked.length ? [] : (index.byNumYear.get(`${n.num}/${n.year}`) || []).filter(e => similar(e._type));
      const raw = hits.length || linked.length ? [] : [...(index.rawCases.get(n.key) || [])].sort((x, y) => x - y);
      out.push({ query: q, kind: 'case', key: n.key, hits, linked, near, raw });
    } else {
      const needle = q.toUpperCase().replace(/\s+/g, ' ');
      if (needle.length < 3) { out.push({ query: q, kind: 'invalid', hits: [], linked: [], near: [], raw: [] }); continue; }
      const hits = index.entries.filter(e =>
        e.advocate.toUpperCase().includes(needle) ||
        e.petitioner.toUpperCase().includes(needle) ||
        e.respondent.toUpperCase().includes(needle) ||
        (e.advocate2 || '').toUpperCase().includes(needle));
      out.push({ query: q, kind: 'name', hits, linked: [], near: [], raw: [] });
    }
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { createParser, normaliseCase, buildIndex, search, keyOf };

// eCourts High Court services (hcservices.ecourts.gov.in): case status and orders for the Calcutta High Court.
// Its search asks for a captcha. This site never solves it: the captcha image is shown to the person, who
// types it, and only then does the server search with their answer and read the case history.
//   1. start(): open an eCourts session, fetch its captcha image
//   2. search(session, case, captcha): find the case, read its history (status, advocates, orders)
//   3. orderPdf(session, link): fetch one order PDF with the same session
const { request } = require('../watcher/http.js');

const BASE = 'https://hcservices.ecourts.gov.in/ecourtindiaHC/';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; CauseListFinder/1.0)' };
const STATE = 16, DIST = 1;
// eCourts' establishment codes for the Calcutta High Court.
const COURT = { original: 1, jalpaiguri: 2, appellate: 3, portblair: 4 };

const cookieOf = res => (res.headers['set-cookie'] || []).map(c => c.split(';')[0]);
const mergeCookies = (a, b) => { const m = new Map(); for (const c of [...a, ...b]) m.set(c.split('=')[0], c); return [...m.values()]; };

async function post(file, body, session) {
  const r = await request(BASE + 'cases/' + file, {
    method: 'POST', timeoutMs: 30000, body: new URLSearchParams(body).toString(),
    headers: { ...UA, cookie: session.cookies.join('; '), 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', Referer: BASE + 'cases/case_no.php' },
  });
  session.cookies = mergeCookies(session.cookies, cookieOf(r));
  if (!r.ok) throw new Error(`eCourts: HTTP ${r.status}`);
  return r.body.toString().replace(/^﻿/, '');
}

// A new eCourts session for one side of the court, with its captcha image.
async function start(side) {
  const court = COURT[side] || COURT.appellate;
  const g = await request(`${BASE}cases/case_no.php?state_cd=${STATE}&dist_cd=${DIST}&court_code=${court}&stateNm=Calcutta`, { headers: UA, timeoutMs: 30000 });
  if (!g.ok) throw new Error(`eCourts: HTTP ${g.status}`);
  const session = { court, cookies: cookieOf(g) };
  return { session, captcha: await captcha(session) };
}

async function captcha(session) {
  const r = await request(`${BASE}securimage/securimage_show.php?${Math.random().toString(36).slice(2)}`, { headers: { ...UA, cookie: session.cookies.join('; ') }, timeoutMs: 30000 });
  session.cookies = mergeCookies(session.cookies, cookieOf(r));
  if (!r.ok) throw new Error(`eCourts captcha: HTTP ${r.status}`);
  return `data:${r.headers['content-type'] || 'image/png'};base64,${r.body.toString('base64')}`;
}

// "WPA" -> eCourts' code for that case type on this side ("12"), from its own list.
async function caseTypeCode(session, type) {
  const list = await post('case_no_qry.php', { action_code: 'fillCaseType', state_code: STATE, dist_code: DIST, court_code: session.court }, session);
  const want = type.toUpperCase().replace(/\s+/g, '');
  for (const item of list.split('#')) {
    const [code, label] = item.split('~');
    if (code && code !== '0' && label && label.split(' - ')[0].toUpperCase().replace(/\s+/g, '') === want) return code;
  }
  return null;
}

class CaptchaError extends Error {}

// Find the case with the person's captcha answer, then read its history page.
async function search(session, { type, num, year }, answer) {
  const code = await caseTypeCode(session, type);
  if (!code) throw new Error(`eCourts has no case type ${type} on this side of the court.`);
  const out = await post('case_no_qry.php', { action_code: 'showRecords', state_code: STATE, dist_code: DIST, case_type: code, case_no: num, rgyear: year,
    caseNoType: 'new', displayOldCaseNo: 'NO', captcha: answer, court_code: session.court }, session);
  // eCourts' own error codes (from its page script)
  const err = out.trim();
  if (err === 'error1' || (/captcha/i.test(err) && !err.includes('~'))) throw new CaptchaError('That captcha was not right. Try the new one.');
  if (err === 'error2') throw new Error('eCourts says the case number is not valid.');
  if (err === 'errorDataLimit') throw new Error('eCourts says too many searches were made. Try again after some time.');
  if (/^error/i.test(err)) throw new Error('eCourts returned an error. Try again.');
  const records = out.split('##').filter(r => r.includes('~')).map(r => r.split('~'));
  if (!records.length) return { found: false };
  const [caseNo, , , cino, courtCode, , , token] = records[0];
  const html = await post('o_civil_case_history.php', { court_code: courtCode, state_code: STATE, dist_code: DIST, case_no: caseNo, cino, token: token || '', appFlag: '' }, session);
  return { found: true, cino, ...parseHistory(html), raw: html };
}

const text = s => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

function tables(html) {
  return [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map(t => ({
    attrs: (t[0].match(/<table([^>]*)>/i) || [])[1] || '',
    rows: [...t[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(r => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => ({ html: c[1], text: text(c[1]) }))),
  }));
}

// The history page: label/value tables (filing, registration, status), the parties with their advocates,
// and tables of orders. eCourts changes its markup now and then, so this reads it loosely.
function parseHistory(html) {
  const facts = {};
  const LABELS = /^(Filing Number|Filing Date|Registration Number|Registration Date|CNR Number|First Hearing Date|Next Hearing Date|Decision Date|Case Status|Stage of Case|Nature of Disposal|Coram|Bench Type|Judicial Branch|Causelist Type|State|District)\b/i;
  for (const t of tables(html)) for (const row of t.rows) {
    for (let i = 0; i + 1 < row.length; i += 2) {
      const label = row[i].text.replace(/\s*:\s*$/, '').trim();
      if (LABELS.test(label) && row[i + 1].text && !facts[label]) facts[label] = row[i + 1].text.replace(/^:\s*/, '');
    }
  }
  // "Label : value" pairs written as text rather than tables
  for (const m of text(html).matchAll(/(Filing Number|Filing Date|Registration Number|Registration Date|CNR Number|First Hearing Date|Next Hearing Date|Decision Date|Stage of Case|Coram)\s*:?\s*([^\n:]{2,80})/gi)) {
    if (!facts[m[1]]) facts[m[1]] = m[2].trim();
  }
  const block = re => { const m = html.match(re); return m ? text(m[1]).split('\n').map(s => s.trim()).filter(Boolean) : []; };
  const petitioners = block(/class=['"]?Petitioner_Advocate_table['"]?[^>]*>([\s\S]*?)<\/(?:span|table|div)>/i);
  const respondents = block(/class=['"]?Respondent_Advocate_table['"]?[^>]*>([\s\S]*?)<\/(?:span|table|div)>/i);

  // Orders: any table whose header mentions an order, with the link to each order's PDF.
  const orders = [];
  for (const t of tables(html)) {
    const head = (t.rows[0] || []).map(c => c.text.toLowerCase());
    if (!head.some(h => /order/.test(h))) continue;
    const at = name => head.findIndex(h => h.includes(name));
    const iDate = at('date'), iNo = head.findIndex(h => /number|no\b|sl/.test(h)), iJudge = head.findIndex(h => /judge|coram|bench/.test(h));
    for (const row of t.rows.slice(1)) {
      const link = row.map(c => (c.html.match(/(display_pdf\.php\?[^'"\s>]+)/i) || [])[1]).find(Boolean);
      const date = row[iDate]?.text || row.map(c => c.text).find(s => /^\d{2}-\d{2}-\d{4}$/.test(s));
      if (!date && !link) continue;
      orders.push({ no: row[iNo]?.text || null, date: date || null, judge: iJudge >= 0 ? row[iJudge]?.text || null : null,
        link: link ? link.replace(/&amp;/g, '&') : null });
    }
  }
  const seen = new Set();
  const unique = orders.filter(o => { const k = o.link || o.date + o.no; if (seen.has(k)) return false; seen.add(k); return true; });
  const toDate = d => { const m = String(d || '').match(/(\d{2})-(\d{2})-(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
  unique.sort((a, b) => toDate(b.date).localeCompare(toDate(a.date)));
  return { facts, petitioners, respondents, orders: unique, ordersTotal: unique.length };
}

// One order PDF, with the session that found it. Only eCourts' own display_pdf.php links are followed.
async function orderPdf(session, link) {
  if (!/^display_pdf\.php\?[\w%=&.\-/+]+$/i.test(link)) throw new Error('Not an eCourts order link.');
  const r = await request(BASE + 'cases/' + link, { headers: { ...UA, cookie: session.cookies.join('; '), Referer: BASE + 'cases/case_no.php' }, timeoutMs: 50000 });
  if (!r.ok) throw new Error(`eCourts: HTTP ${r.status}`);
  if (r.body.subarray(0, 5).toString() === '%PDF-') return r.body;
  // Some versions answer with a page that embeds the PDF: follow its one link.
  const inner = (r.body.toString().match(/(?:src|href|data)=['"]([^'"]+\.pdf[^'"]*)['"]/i) || [])[1];
  if (!inner) throw new Error('eCourts did not return the order PDF.');
  const r2 = await request(new URL(inner, BASE + 'cases/').href, { headers: { ...UA, cookie: session.cookies.join('; ') }, timeoutMs: 50000 });
  if (!r2.ok || r2.body.subarray(0, 5).toString() !== '%PDF-') throw new Error('eCourts did not return the order PDF.');
  return r2.body;
}

module.exports = { start, captcha, search, orderPdf, parseHistory, CaptchaError, COURT };

// SARTHAC (sarthac.gov.in): West Bengal's portal for cases where the State is a party. For such a case it
// has the petition as filed (PDF), when it was uploaded, the petitioner's advocate with contact details,
// and each State respondent's office with phone and email. Its search needs no captcha (only its login
// does), but every request needs the page's session cookie and token. Its server sends the wrong
// certificate chain, which is why it fails in many browsers; watcher/http.js carries the right one.
const { request } = require('../watcher/http.js');

const BASE = 'https://sarthac.gov.in';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; CauseListFinder/1.0)' };

async function session() {
  const g = await request(`${BASE}/case-details`, { headers: UA, timeoutMs: 25000 });
  if (!g.ok) throw new Error(`sarthac: HTTP ${g.status}`);
  const token = (g.body.toString().match(/name="_token" content="([^"]+)"/) || [])[1];
  if (!token) throw new Error('sarthac: no page token');
  const cookie = (g.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  return { cookie, headers: { ...UA, cookie, 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': token, Referer: `${BASE}/case-details` } };
}

const clean = s => s.replace(/<[^>]+>/g, ' ').replace(/&#10;/g, ', ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'")
  .replace(/\s+/g, ' ').replace(/\s*,\s*,\s*/g, ', ').trim();

// The details page is label/value pairs in this order: the petitioner's advocate, the references (court,
// side, group, article), the petitioners' names, the first petitioner's address, then "Respondent N" blocks.
function parseDetails(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const toks = [];
  const re = /<h(\d)[^>]*>([\s\S]*?)<\/h\1>|<label[^>]*>([\s\S]*?)<\/label>|<strong>([\s\S]*?)<\/strong>/g;
  for (let m; (m = re.exec(html));) {
    if (m[2] != null) toks.push({ h: clean(m[2]) });
    else if (m[3] != null) { const t = clean(m[3]); if (t !== ':') toks.push({ l: t }); }
    else toks.push({ v: clean(m[4]) });
  }
  const out = { advocate: {}, references: {}, petitioners: [], petitionerPlace: {}, respondents: [] };
  let part = 'advocate', label = null, resp = null;
  for (const t of toks) {
    if (t.h && /^Respondent\s*\d+/i.test(t.h)) { part = 'respondent'; resp = { phones: [], emails: [] }; out.respondents.push(resp); label = null; continue; }
    if (t.l) {
      if (/^Petitioner\(s\)/i.test(t.l)) { part = 'petitioners'; label = null; continue; }
      if (part === 'advocate' && t.l === 'Court') part = 'references';
      if (part === 'petitioners' && t.l === 'Name') part = 'petitioner';
      label = t.l; continue;
    }
    if (t.v == null) continue;
    if (!label) { if (part === 'references' || part === 'petitioners') { part = 'petitioners'; out.petitioners.push(t.v); } continue; }
    if (part === 'advocate') out.advocate[{ Name: 'name', Address: 'address' }[label] || (/Mobile/i.test(label) ? 'mobile' : label)] = t.v;
    else if (part === 'references') out.references[label.toLowerCase()] = t.v;
    else if (part === 'petitioner') out.petitionerPlace[label] = t.v;
    else if (part === 'respondent') {
      if (/Mobile/i.test(label)) resp.phones.push(t.v);
      else if (/Email/i.test(label)) resp.emails.push(t.v);
      else if (/Designation/i.test(label)) resp.designation = t.v;
      else if (/Office/i.test(label)) resp.office = t.v;
      else if (/Address/i.test(label)) resp.address = t.v;
    }
    label = null;
  }
  return out;
}

// "WPA/3212/2026" -> the case on SARTHAC, or null when SARTHAC doesn't have it.
async function lookup(type, no, year) {
  const s = await session();
  const q = new URLSearchParams({ manualsearch: 1, case_type: type, case_no: no, year, ia_year: '', ia_no: '', ia_type: '', petitioner: '', petitioner_adv: '',
    petitioner_dist: '', officeid: '', office: '', designation: '', add: '', group: '', to_date: '', from_date: '', draw: 1, start: 0, length: 10 });
  const r = await request(`${BASE}/ajax-casedetails?${q}`, { headers: s.headers, timeoutMs: 25000 });
  if (!r.ok) throw new Error(`sarthac search: HTTP ${r.status}`);
  const rows = (JSON.parse(r.body.toString()).case_details || [])
    .filter(x => x.casedetails && !x.casedetails.ia_no && String(x.casedetails.no) === String(no) && String(x.casedetails.year) === String(year) && x.casedetails.type.toUpperCase() === type.toUpperCase());
  if (!rows.length) return null;
  const row = rows[0], c = row.casedetails;
  const d = await request(`${BASE}/ajax-case-details-view?${new URLSearchParams({ case_no: c.no, year: c.year, case_type: c.type, ia_no: '', ia_year: '', ia_type: '' })}`, { headers: s.headers, timeoutMs: 25000 });
  const detail = d.ok ? parseDetails(JSON.parse(d.body.toString()).view || '') : null;
  const [dd, mm, yyyy] = String(row.data_entry_time || '').split('-');
  return {
    case: `${c.type}/${c.no}/${c.year}`,
    uploadedOn: yyyy ? `${yyyy}-${mm}-${dd}` : null,
    petitioner: row.name_of_petitioner || null, morePetitioners: row.no_of_petitioners || '',
    group: detail?.references.group || row.group_no || null,
    article: detail?.references.article || null, side: detail?.references.side || null,
    petitionerAdvocate: { name: detail?.advocate.name || row.advocate_of_petitioner || null, address: detail?.advocate.address || null, mobile: detail?.advocate.mobile || null },
    petitioners: detail?.petitioners || [],
    district: detail?.petitionerPlace.District || null,   // the petitioner's full address is left out on purpose
    respondents: detail?.respondents || [],
    petition: { id: c.id, year: c.schema },
  };
}

// The petition PDF, read through this server (browsers often can't open sarthac.gov.in themselves).
const petitionLink = (id, year) => `${BASE}/download-case-file?${new URLSearchParams({ page: 'view-case-file', id, year })}`;
async function petition(id, year) {
  const s = await session();
  const r = await request(petitionLink(id, year), { headers: { ...UA, cookie: s.cookie }, timeoutMs: 50000 });
  if (!r.ok || !r.body.subarray(0, 5).toString().startsWith('%PDF')) throw new Error('sarthac: the petition file is not available');
  return r.body;
}

module.exports = { lookup, petition, petitionLink, parseDetails };

// A case's file from SARTHAC (sarthac.gov.in): when the petition was uploaded, the petitioner's advocate
// with contact details, the State respondents' offices with phone and email, and a link to the petition.
//   GET /api/case?case=WPA/3212/2026
// SARTHAC only has cases where the State of West Bengal is a party: for others, { found: false }.
const { requireUser } = require('../lib/auth.js');
const { logActivity } = require('../lib/activity.js');
const sarthac = require('../lib/sarthac.js');
const { normaliseCase } = require('../src/parser.js');

const cache = new Map();   // case -> { at, data }, while this function instance stays warm

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await requireUser(req, res); if (!user) return;
  const n = normaliseCase(String(req.query?.case || ''));
  if (!n || !/^\d{1,7}$/.test(n.num) || !/^\d{4}$/.test(n.year)) return res.status(400).json({ error: 'Give a case number like WPA/3212/2026.' });
  const key = n.key;
  const t0 = Date.now();
  try {
    const hit = cache.get(key);
    const data = hit && Date.now() - hit.at < 3600e3 ? hit.data : await sarthac.lookup(n.type, n.num, n.year);
    cache.set(key, { at: Date.now(), data });
    await logActivity(req, 'case-file', user, { target: key, found: data ? 1 : 0, ms: Date.now() - t0 });
    if (!data) return res.status(200).json({ case: key, found: false });
    const { petition, ...rest } = data;
    res.status(200).json({ found: true, ...rest, petitionUrl: `/api/petition?id=${encodeURIComponent(petition.id)}&year=${encodeURIComponent(petition.year)}&case=${encodeURIComponent(key)}` });
  } catch (e) {
    await logActivity(req, 'case-file', user, { target: key, error: e.code || e.message });
    res.status(502).json({ error: `SARTHAC didn't answer (${e.code || e.message}). Try again in a minute.` });
  }
};

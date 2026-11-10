// A case's latest orders from eCourts, with the captcha typed by the person (see lib/ecourts.js).
//   GET  /api/orders?action=start&case=WPA/3212/2026&side=appellate  -> { ticket, captcha }   (captcha: an image)
//   GET  /api/orders?action=captcha&ticket=…                          -> { captcha }           (a fresh one)
//   POST /api/orders  { action: "search", ticket, captcha: "ab12c" }  -> status, advocates, last 5 orders
//   GET  /api/orders?action=pdf&ticket=…&i=0                          -> that order's PDF
// The eCourts session is kept for 30 minutes under a random ticket, tied to the person who started it.
const { refuseIfPaused } = require('../lib/pause.js');
const crypto = require('crypto');
const { requireUser } = require('../lib/auth.js');
const { logActivity } = require('../lib/activity.js');
const { pickStore } = require('../watcher/store.js');
const ecourts = require('../lib/ecourts.js');
const { normaliseCase } = require('../src/parser.js');

const LAST = 5;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = await requireUser(req, res); if (!user) return;
  if (refuseIfPaused(res)) return;
  const who = user.email || 'guest';
  const store = pickStore();
  const q = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const load = async () => {
    if (!/^[a-f0-9]{32}$/.test(q.ticket || '')) return null;
    const t = await store.tmpGet(`ec:${q.ticket}`);
    return t && t.who === who ? t : null;
  };
  try {
    if (q.action === 'start') {
      const n = normaliseCase(String(q.case || ''));
      if (!n) return res.status(400).json({ error: 'Give a case number like WPA/3212/2026.' });
      if (await store.hit(`orders:${who}`) > 60) return res.status(429).json({ error: 'Too many order look-ups this hour. Try again later.' });
      const { session, captcha } = await ecourts.start(q.side);
      const ticket = crypto.randomBytes(16).toString('hex');
      await store.tmpSet(`ec:${ticket}`, { who, session, case: { type: n.type, num: n.num, year: n.year, key: n.key } });
      return res.status(200).json({ ticket, captcha });
    }
    const t = await load();
    if (!t) return res.status(410).json({ error: 'This look-up has expired. Start again.', restart: true });

    if (q.action === 'captcha') {
      const captcha = await ecourts.captcha(t.session);
      await store.tmpSet(`ec:${q.ticket}`, t);
      return res.status(200).json({ captcha });
    }

    if (q.action === 'search' && req.method === 'POST') {
      const answer = String(q.captcha || '').trim();
      if (!/^[0-9a-zA-Z]{3,8}$/.test(answer)) return res.status(400).json({ error: 'Type the letters and numbers in the picture.' });
      const t0 = Date.now();
      let r;
      try { r = await ecourts.search(t.session, t.case, answer); } catch (e) {
        if (e instanceof ecourts.CaptchaError) {
          const captcha = await ecourts.captcha(t.session);
          await store.tmpSet(`ec:${q.ticket}`, t);
          return res.status(400).json({ error: e.message, captcha, retry: true });
        }
        throw e;
      }
      if (r.found && (!r.orders.length || !Object.keys(r.facts).length)) {
        // Part of the page wasn't understood: keep it 30 minutes for the owner to look at (/api/log?kind=ecourts).
        await store.tmpSet('ec-debug', { at: new Date().toISOString(), case: t.case.key, orders: r.orders.length, facts: Object.keys(r.facts), html: String(r.raw).slice(0, 400000) });
      }
      t.orders = (r.orders || []).slice(0, LAST).map(o => o.link);
      await store.tmpSet(`ec:${q.ticket}`, t);
      await logActivity(req, 'orders', user, { target: t.case.key, found: r.found ? r.ordersTotal : 0, ms: Date.now() - t0 });
      if (!r.found) return res.status(200).json({ case: t.case.key, found: false });
      return res.status(200).json({
        case: t.case.key, found: true, cino: r.cino, facts: r.facts, petitioners: r.petitioners, respondents: r.respondents, ordersTotal: r.ordersTotal,
        orders: r.orders.slice(0, LAST).map((o, i) => ({ no: o.no, date: o.date, judge: o.judge, pdf: o.link ? `/api/orders?action=pdf&ticket=${q.ticket}&i=${i}` : null })),
      });
    }

    if (q.action === 'pdf') {
      const link = (t.orders || [])[Number(q.i)];
      if (!link) return res.status(404).json({ error: 'No such order.' });
      const pdf = await ecourts.orderPdf(t.session, link);
      await logActivity(req, 'order-pdf', user, { target: `${t.case.key} #${Number(q.i) + 1}` });
      if (pdf.length > 4.2e6) return res.status(413).json({ error: 'This order is too large to pass through. Open it on eCourts.' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${t.case.key.replace(/\//g, '-')}-order-${Number(q.i) + 1}.pdf"`);
      res.setHeader('Cache-Control', 'private, max-age=1800');
      return res.status(200).send(pdf);
    }
    res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    res.status(502).json({ error: `eCourts didn't answer properly (${e.code || e.message}).` });
  }
};

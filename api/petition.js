// The petition PDF from SARTHAC, passed through this server so it opens on any network.
//   GET /api/petition?id=2589&year=2026&case=WPA/3212/2026   (id and year come from /api/case)
const { requireUser } = require('../lib/auth.js');
const { logActivity } = require('../lib/activity.js');
const sarthac = require('../lib/sarthac.js');

module.exports = async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const { id, year } = req.query || {};
  const name = String(req.query?.case || 'petition').replace(/[^A-Za-z0-9-]+/g, '-');
  if (!/^\d{1,9}$/.test(id || '') || !/^\d{4}$/.test(year || '')) return res.status(400).json({ error: 'Bad petition link.' });
  try {
    const pdf = await sarthac.petition(id, year);
    await logActivity(req, 'petition', user, { target: req.query?.case || id });
    // Vercel can't send more than about 4.5 MB from a function: send large petitions to SARTHAC itself.
    if (pdf.length > 4.2e6) { res.setHeader('Location', sarthac.petitionLink(id, year)); return res.status(302).end(); }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}-petition.pdf"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(200).send(pdf);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: e.message });
  }
};

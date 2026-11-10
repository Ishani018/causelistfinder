// One switch for every request this site makes to court websites (calcuttahighcourt.gov.in, sarthac.gov.in,
// hcservices.ecourts.gov.in): the watcher, day checks, case files and orders. While paused, nothing is fetched;
// uploading a cause list PDF still works, since that is read in the browser.
// Paused in code; to resume without a code change, set FETCH_PAUSED=0 in Vercel and redeploy.
const PAUSED_BY_DEFAULT = true;

const fetchPaused = () => process.env.FETCH_PAUSED != null ? !/^(0|false|no|off)$/i.test(process.env.FETCH_PAUSED) : PAUSED_BY_DEFAULT;
const PAUSED_MESSAGE = 'Live fetching from the court websites is paused for now. Upload the cause list PDF instead.';

// For API handlers: true (and a 503 already sent) when paused.
function refuseIfPaused(res) {
  if (!fetchPaused()) return false;
  res.setHeader('Cache-Control', 'no-store');
  res.status(503).json({ error: PAUSED_MESSAGE, paused: true });
  return true;
}

module.exports = { fetchPaused, refuseIfPaused, PAUSED_MESSAGE };

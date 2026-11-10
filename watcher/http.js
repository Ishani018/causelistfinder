// HTTPS requests to the court website and sarthac.gov.in. Neither server sends the right intermediate
// certificate, so the trusted roots plus those public intermediates (GlobalSign for the court, valid until
// May 2027; eMudhra's emSign chain for sarthac, from repository.emsign.com) are passed to every request.
// Certificate checking stays on.
const fs = require('fs');
const https = require('https');
const path = require('path');
const tls = require('tls');

const CA = [...tls.rootCertificates, ...['globalsign-alphassl-ca-2025.pem', 'emsign-dv-tls-ca-g2a1.pem'].map(f => fs.readFileSync(path.join(__dirname, f), 'utf8'))];

function request(url, { method = 'GET', headers = {}, body = null, timeoutMs = 60000, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, ca: CA, timeout: timeoutMs }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        // A redirect after a form POST is followed with GET, as browsers do.
        resolve(request(new URL(res.headers.location, url).href, { method: method === 'POST' ? 'GET' : method, headers, timeoutMs, redirects: redirects - 1 }));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error(`timed out after ${timeoutMs / 1000}s`), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}

module.exports = { request };

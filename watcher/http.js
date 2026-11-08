// HTTPS requests to the court website. Its server does not send the intermediate certificate, so the
// trusted roots plus that one public GlobalSign intermediate are passed to every request.
// Certificate checking stays on. The intermediate is valid until May 2027.
const fs = require('fs');
const https = require('https');
const path = require('path');
const tls = require('tls');

const CA = [...tls.rootCertificates, fs.readFileSync(path.join(__dirname, 'globalsign-alphassl-ca-2025.pem'), 'utf8')];

function request(url, { method = 'GET', headers = {}, timeoutMs = 60000, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, ca: CA, timeout: timeoutMs }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(request(new URL(res.headers.location, url).href, { method, headers, timeoutMs, redirects: redirects - 1 }));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error(`timed out after ${timeoutMs / 1000}s`), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

module.exports = { request };

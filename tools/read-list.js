// Reads a cause list PDF in Node with the same parser the page uses.
const fs = require('fs');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const { createParser, keyOf } = require('../src/parser.js');

async function readList(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const parser = createParser();
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    parser.addPage((await page.getTextContent()).items, p);
    page.cleanup();
  }
  const entries = parser.finish();
  const raw = parser.rawCases();
  return { entries, raw, pages: doc.numPages };
}

// Case numbers printed in the PDF that are neither a listing, a connected case nor an IA.
function unreadCaseNumbers({ entries, raw }) {
  const covered = new Set();
  for (const e of entries) {
    covered.add(keyOf(e.caseNo));
    e.linked.forEach(c => covered.add(keyOf(c)));
    (e.ia.match(/[A-Z][A-Z.]*\/\d+\/\d{4}/g) || []).forEach(c => covered.add(keyOf(c)));
  }
  return [...raw.keys()].filter(k => !covered.has(k));
}

module.exports = { readList, unreadCaseNumbers };

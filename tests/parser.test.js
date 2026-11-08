const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { normaliseCase, buildIndex, search } = require('../src/parser.js');
const { readList, unreadCaseNumbers } = require('../tools/read-list.js');

const fixture = name => path.join(__dirname, 'fixtures', name);

test('case numbers typed in different ways read the same', () => {
  const cases = {
    'MAT/1451/2026': 'MAT/1451/2026',
    'mat 1451 of 2026': 'MAT/1451/2026',
    'WPA (P) 156/25': 'WPA(P)/156/2025',
    'W.P.A. 10725/2024': 'WPA/10725/2024',
    'wpa-10725-2024': 'WPA/10725/2024',
    'R.V.W/62/2024': 'RVW/62/2024',
    'WP.ST/434/2013': 'WPST/434/2013',
    'CPAN. No. 2041 of 2024': 'CPAN/2041/2024',
    'CAN 2/2024 in WPST/71/2015': 'WPST/71/2015',
    'CAN 1 of 2025 in WPA/4521/2020 & 4 others': 'WPA/4521/2020',
    'MAT/812/2026, CAN No. 1 of 2026': 'MAT/812/2026',
    'WP 5120(W)/2019': 'WPA/5120/2019',
    'CRA (DB) 201/2026': 'CRA(DB)/201/2026',
    'AO-COM/27/2025': 'AO-COM/27/2025',
    'fmat-ipd 5 of 2026': 'FMAT-IPD/5/2026',
  };
  for (const [typed, key] of Object.entries(cases)) assert.strictEqual(normaliseCase(typed)?.key, key, typed);
  assert.strictEqual(normaliseCase('Sukanta Ghosh'), null);
});

test('daily list: main case, connected case, bench and court notes', async () => {
  const list = await readList(fixture('daily-vacation-2026-10-16.pdf'));
  assert.strictEqual(list.entries.length, 2);
  const [main, connected] = list.entries;
  assert.strictEqual(main.caseNo, 'MAT/1881/2026');
  assert.strictEqual(main.court, '8');
  assert.strictEqual(main.time, '11:15 AM');
  assert.strictEqual(main.judges.length, 2);
  assert.match(main.date, /16th October 2026/);
  assert.match(main.list, /DAILY/);
  assert.strictEqual(main.ia, 'CAN/1/2026');
  assert.match(main.benchNotes, /SHALL SIT AND TAKE UP ALL THE MATTERS/);
  assert.match(main.vc, /^https:\/\/calcuttahighcourt-gov-in\.zoom\.us\//);
  // "in WPA/29837/2026" rows are the main case under item 1; they must be searchable.
  assert.strictEqual(connected.caseNo, 'WPA/29837/2026');
  assert.strictEqual(connected.rel, 'in');
  assert.strictEqual(connected.serial, '1');
  assert.deepStrictEqual(unreadCaseNumbers(list), []);
});

test('supplementary list is recognised and remarks are kept', async () => {
  const list = await readList(fixture('supplementary-2026-08-27.pdf'));
  assert.strictEqual(list.entries.length, 1);
  const [e] = list.entries;
  assert.strictEqual(e.caseNo, 'WPA/24251/2023');
  assert.match(e.list, /SUPPLEMENTARY/);
  assert.strictEqual(e.court, '25');
  assert.strictEqual(e.section, 'TO BE MENTIONED');
  assert.match(e.remarks, /For Clarification/);
});

test('circuit bench list: every printed case number is readable and searchable', async () => {
  const list = await readList(fixture('jalpaiguri-daily-2026-11-09.pdf'));
  assert.strictEqual(list.entries.length, 128);
  assert.ok(list.entries.every(e => e.court && e.date && e.judges.length));
  assert.deepStrictEqual(unreadCaseNumbers(list), []);
  const index = buildIndex(list.entries, list.raw);
  const [hit, miss] = search(index, ['crm (ndps) 438 of 2026', 'WPA/1/1999']);
  assert.strictEqual(hit.hits.length, 1);
  assert.strictEqual(hit.hits[0].serial, '1');
  assert.strictEqual(miss.hits.length + miss.linked.length + miss.near.length + miss.raw.length, 0);
});

test('original side: rows that start with the application keep their main case and item', async () => {
  const list = await readList(fixture('original-side-vacation-2026-11-09.pdf'));
  assert.strictEqual(list.entries.length, 5);
  const [first, second, third] = list.entries;
  assert.strictEqual(first.serial, '1');
  assert.strictEqual(first.caseNo, 'WPO/329/2026');
  assert.strictEqual(first.ia, 'GA/1/2026');
  assert.strictEqual(first.advocate, 'ADITYA KANODIA');
  assert.match(first.respondent, /INDIAN BANK/);
  assert.strictEqual(second.caseNo, 'WPO/330/2026');
  assert.strictEqual(third.caseNo, 'WPO/520/2026');
  assert.match(first.list, /DAILY/);
  assert.deepStrictEqual(unreadCaseNumbers(list), []);
});

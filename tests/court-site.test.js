const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseNotices, describeTitle, archiveUrl, istStamp } = require('../watcher/court-site.js');

test('notices page: id, title and IST upload time for each notice', () => {
  const notices = parseNotices(fs.readFileSync(path.join(__dirname, 'fixtures', 'notices-page.html'), 'utf8'));
  assert.strictEqual(notices.length, 10);
  assert.deepStrictEqual(notices[0], {
    id: '18194',
    url: 'https://www.calcuttahighcourt.gov.in/Notice-Files/CL/18194',
    title: 'Supplementary Cause List dated 24.09.2026 of the Appellate Side (Court No. 34)',
    uploadedAt: '2026-09-24T10:52:43+05:30',
  });
});

test('notice titles say what kind of list it is', () => {
  assert.deepStrictEqual(describeTitle('Supplementary Cause List dated 23.09.2026 of the Appellate Side (Court No 9)'),
    { type: 'supplementary', side: 'appellate', hearingDate: '2026-09-23', court: '9', vacation: false });
  assert.deepStrictEqual(describeTitle('DAILY CAUSELIST DATED 24.09.2026 - CIRCUIT BENCH AT PORT BLAIR'),
    { type: 'daily', side: 'portblair', hearingDate: '2026-09-24', court: null, vacation: false });
  assert.strictEqual(describeTitle('Vacation Bench Cause List dated 09-11-2026 - Circuit Bench at Port Blair').hearingDate, '2026-11-09');
  assert.strictEqual(describeTitle('VACATION BENCH CAUSEIST DATED 06.11.2026 - CIRCUIT BENCH AT PORT BLAIR').type, 'daily');   // court's typo
  assert.strictEqual(describeTitle('Notice regarding mentioning of matters').type, 'notice');
});

test('archive addresses follow the court site pattern', () => {
  const d = new Date(Date.UTC(2026, 9, 13));
  assert.strictEqual(archiveUrl('appellate', 'daily', d), 'https://www.calcuttahighcourt.gov.in/downloads/old_cause_lists/AS/cla13102026.pdf');
  assert.strictEqual(archiveUrl('original', 'supplementary', d), 'https://www.calcuttahighcourt.gov.in/downloads/old_cause_lists/supplementary/OS/cl13102026.pdf');
  assert.strictEqual(istStamp('08-Nov-2026 10:21:03'), '2026-11-08T10:21:03+05:30');
});

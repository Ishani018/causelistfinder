// Summarises data/log.jsonl: what was published when, how fast we saw it, and every problem.
//   node watcher/report.js [--days 7]
const fs = require('fs');
const path = require('path');

const DATA = process.env.WATCH_DATA_DIR || path.join(__dirname, '..', 'data');
const days = +(process.argv[process.argv.indexOf('--days') + 1] || 7) || 7;
const since = Date.now() - days * 86400e3;

let lines = [];
try { lines = fs.readFileSync(path.join(DATA, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }
catch { console.log('No log yet. Run: node watcher/watch.js'); process.exit(0); }
const recs = lines.filter(r => Date.parse(r.foundAt) >= since);

const ist = iso => new Date(Date.parse(iso) + 5.5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const lists = recs.filter(r => r.source === 'notice' || r.source === 'archive');

console.log(`Last ${days} days: ${lists.length} lists or notices seen, ${recs.filter(r => r.problem).length} problems\n`);

console.log('Upload hour (IST) by list type:');
const byType = {};
for (const r of lists) if (r.uploadedAt) {
  const h = new Date(Date.parse(r.uploadedAt) + 5.5 * 3600e3).getUTCHours();
  ((byType[r.type] = byType[r.type] || {})[h] = (byType[r.type][h] || 0) + 1);
}
for (const [t, hours] of Object.entries(byType)) console.log(`  ${t.padEnd(14)} ${Object.keys(hours).sort((a, b) => a - b).map(h => `${String(h).padStart(2, '0')}h:${hours[h]}`).join(' ')}`);

const delays = lists.filter(r => r.source === 'notice' && !r.backfill && r.delayMin != null && r.delayMin >= 0).map(r => r.delayMin).sort((a, b) => a - b);
if (delays.length) console.log(`\nMinutes from upload to seen (notices): median ${delays[Math.floor(delays.length / 2)]}, worst ${delays[delays.length - 1]}`);

const read = lists.filter(r => r.result && typeof r.result === 'object');
const cases = read.reduce((n, r) => n + r.result.cases, 0);
const unread = read.reduce((n, r) => n + (r.result.unreadCount || 0), 0);
console.log(`\nRead ${read.length} PDFs, ${cases.toLocaleString('en-IN')} cases in total, ${unread} printed case numbers not read`);

console.log('\nBy hearing date:');
const byDate = {};
for (const r of lists) (byDate[r.hearingDate || 'no date'] = byDate[r.hearingDate || 'no date'] || []).push(r);
for (const d of Object.keys(byDate).sort()) {
  const rs = byDate[d];
  const count = t => rs.filter(r => r.type === t).length;
  console.log(`  ${d}: ${count('daily')} daily, ${count('supplementary')} supplementary, ${count('monthly')} monthly, ${count('notice')} other notices`);
}

const problems = recs.filter(r => r.problem);
if (problems.length) {
  console.log('\nProblems:');
  for (const r of problems) console.log(`  ${ist(r.foundAt)}  ${r.title || r.source}: ${r.problem}${r.url ? ' ' + r.url : ''}`);
}

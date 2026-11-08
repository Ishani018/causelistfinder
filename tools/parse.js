// Usage: npm run parse -- <list.pdf> [more.pdf ...] [--json out.json]
// Prints how many cases were read from each list and checks that every printed case number is covered.
const fs = require('fs');
const { readList, unreadCaseNumbers } = require('./read-list.js');

(async () => {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf('--json');
  const out = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
  const all = [];
  for (const file of args) {
    const t0 = Date.now();
    const list = await readList(file);
    const empty = k => list.entries.filter(e => !e[k] || (Array.isArray(e[k]) && !e[k].length)).length;
    const unread = unreadCaseNumbers(list);
    console.log(`${file}\n  ${list.pages} pages, ${list.entries.length} cases, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`  lists: ${[...new Set(list.entries.map(e => e.list))].join(' / ')}`);
    console.log(`  missing court: ${empty('court')} (warning list has none), missing date: ${empty('date')}`);
    console.log(`  case numbers printed but not read as a listing or IA: ${unread.length}${unread.length ? ' — ' + unread.slice(0, 10).join(', ') : ''}`);
    all.push(...list.entries);
  }
  if (out) { fs.writeFileSync(out, JSON.stringify(all)); console.log(`wrote ${out}`); }
})();

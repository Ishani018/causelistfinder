// Builds index.html: the page template with the parser and example results inlined.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const html = read('src/template.html')
  .replace('/*PARSER*/', () => read('src/parser.js'))
  .replace('/*EXAMPLE*/', () => read('src/example.json').trim().replace(/<\//g, '<\\/'));

fs.writeFileSync(path.join(root, 'index.html'), html);
console.log(`index.html written (${(html.length / 1024).toFixed(0)} KB)`);

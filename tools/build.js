// Builds the page: the template with the parser and example results inlined.
//   index.html          a complete HTML document (served by Vercel / GitHub)
//   dist/artifact.html  the same page without the document wrapper (for hosts that add their own)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const page = read('src/template.html')
  .replace('/*PARSER*/', () => read('src/parser.js'))
  .replace('/*EXAMPLE*/', () => read('src/example.json').trim().replace(/<\//g, '<\\/'));

const head = '<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';
fs.writeFileSync(path.join(root, 'index.html'), head + page + '\n</html>\n');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), page);
console.log(`index.html and dist/artifact.html written (${(page.length / 1024).toFixed(0)} KB)`);

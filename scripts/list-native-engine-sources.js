const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'native', 'cpp-engine', 'src');
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.cpp')) {
      files.push(path.relative(path.join(__dirname, '..'), full));
    }
  }
}

walk(root);
process.stdout.write(files.sort().join(' '));

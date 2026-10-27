const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true, force: true });
    console.log(`Copied ${src} -> ${dest}`);
  }
}

copyDir(
  path.resolve(__dirname, '../src/storage/migrations'),
  path.resolve(__dirname, '../dist/storage/migrations')
);

copyDir(
  path.resolve(__dirname, '../src/dashboard/public'),
  path.resolve(__dirname, '../dist/dashboard/public')
);

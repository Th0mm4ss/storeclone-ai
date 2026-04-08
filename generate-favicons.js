// Run once: node generate-favicons.js
// Requires: npm install sharp
const sharp = require('sharp');
const fs = require('fs');
const svg = fs.readFileSync('./favicon.svg');
Promise.all([
  sharp(svg).resize(32, 32).png().toFile('favicon-32.png'),
  sharp(svg).resize(16, 16).png().toFile('favicon-16.png'),
  sharp(svg).resize(180, 180).png().toFile('apple-touch-icon.png')
]).then(() => console.log('Favicons generated: favicon-32.png, favicon-16.png, apple-touch-icon.png'))
  .catch(e => console.error('Error:', e.message));
